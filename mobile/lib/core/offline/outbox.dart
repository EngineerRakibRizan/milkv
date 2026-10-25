import 'dart:async';

import '../api/api_client.dart';
import '../storage/local_store.dart';

/// One user action waiting to reach the server. [key] is its Idempotency-Key,
/// created once when the user acted and reused on every replay.
class OutboxItem {
  OutboxItem({
    required this.key,
    required this.method,
    required this.path,
    required this.label,
    required this.createdAt,
    this.body,
    this.farmId,
    this.userId,
  });

  final String key;
  final String method;
  final String path;
  final Object? body;
  final int? farmId;
  final int? userId;
  final String label;
  final DateTime createdAt;

  Map<String, dynamic> toJson() => {
        'key': key, 'method': method, 'path': path, 'body': body, 'farmId': farmId, 'userId': userId,
        'label': label, 'createdAt': createdAt.toIso8601String(),
      };

  factory OutboxItem.fromJson(Map<String, dynamic> j) => OutboxItem(
        key: j['key'] as String,
        method: j['method'] as String,
        path: j['path'] as String,
        body: j['body'],
        farmId: j['farmId'] as int?,
        userId: j['userId'] as int?,
        label: j['label'] as String? ?? '',
        createdAt: DateTime.tryParse(j['createdAt'] as String? ?? '') ?? DateTime.now(),
      );
}

/// A queued write the server refused (validation, permissions). It will never
/// succeed by retrying, so it leaves the queue and is shown to the user.
class RejectedWrite {
  RejectedWrite(this.item, this.message, this.status);

  final OutboxItem item;
  final String message;
  final int status;

  Map<String, dynamic> toJson() => {'item': item.toJson(), 'message': message, 'status': status};

  factory RejectedWrite.fromJson(Map<String, dynamic> j) =>
      RejectedWrite(OutboxItem.fromJson(Map<String, dynamic>.from(j['item'] as Map)), j['message'] as String? ?? '', j['status'] as int? ?? 0);
}

class OutboxStatus {
  const OutboxStatus({this.pending = 0, this.rejected = const [], this.syncing = false});

  final int pending;
  final List<RejectedWrite> rejected;
  final bool syncing;
}

/// What happened to a write: sent now ([data] is the server response) or
/// queued to be sent when the connection returns.
class WriteResult {
  const WriteResult.sent(this.data) : queued = false;
  const WriteResult.queued()
      : data = null,
        queued = true;

  final dynamic data;
  final bool queued;
}

/// Offline-first writes. Every write carries an Idempotency-Key; if the server
/// cannot be reached it is stored and replayed in order later. While anything
/// is queued, new writes queue behind it so the server sees them in the order
/// they were made (an older milk sheet can never overwrite a newer one).
class Outbox {
  Outbox(this._store, this._api, {required this.currentUserId, required this.currentFarmId});

  static const _queueKey = 'outbox.items';
  static const _rejectedKey = 'outbox.rejected';

  final LocalStore _store;
  final ApiClient _api;
  final int? Function() currentUserId;
  final int? Function() currentFarmId;
  final _changes = StreamController<OutboxStatus>.broadcast();
  bool _syncing = false;
  Future<void>? _flushing;

  Stream<OutboxStatus> get changes => _changes.stream;

  List<OutboxItem> get items => [
        for (final j in (_store.read(_queueKey) as List?) ?? const []) OutboxItem.fromJson(Map<String, dynamic>.from(j as Map)),
      ];

  List<RejectedWrite> get rejected => [
        for (final j in (_store.read(_rejectedKey) as List?) ?? const []) RejectedWrite.fromJson(Map<String, dynamic>.from(j as Map)),
      ];

  OutboxStatus get status => OutboxStatus(pending: items.length, rejected: rejected, syncing: _syncing);

  /// Sends a write now, or queues it when offline (or when older writes are still queued).
  Future<WriteResult> send(String method, String path, {Object? body, required String label, bool allowQueue = true}) async {
    final item = OutboxItem(
      key: ApiClient.newKey(), method: method, path: path, body: body, label: label,
      farmId: currentFarmId(), userId: currentUserId(), createdAt: DateTime.now(),
    );
    if (allowQueue && _mine(items).isNotEmpty) {
      await _enqueue(item);
      unawaited(flush());
      return const WriteResult.queued();
    }
    try {
      return WriteResult.sent(await _sendWithRetry(item));
    } on ApiError catch (e) {
      if (allowQueue && e.retryable) {
        await _enqueue(item);
        return const WriteResult.queued();
      }
      rethrow;
    }
  }

  /// Replays queued writes in order. Stops at the first one that still cannot
  /// reach the server; drops (and reports) ones the server rejects.
  Future<void> flush() => _flushing ??= _flush().whenComplete(() => _flushing = null);

  Future<void> _flush() async {
    if (_mine(items).isEmpty) return;
    _setSyncing(true);
    try {
      while (true) {
        final queue = items;
        final mine = _mine(queue);
        if (mine.isEmpty) break;
        final item = mine.first;
        try {
          await _api.send(item.method, item.path, body: item.body, idempotencyKey: item.key, farmId: item.farmId);
        } on ApiError catch (e) {
          if (e.retryable || e.status == 401) break; // try again later, keep order
          await _store.write(_rejectedKey, [...rejected.map((r) => r.toJson()), RejectedWrite(item, e.message, e.status).toJson()]);
        }
        await _store.write(_queueKey, [for (final i in items) if (i.key != item.key) i.toJson()]);
        _emit();
      }
    } finally {
      _setSyncing(false);
    }
  }

  Future<void> dismissRejected() async {
    await _store.delete(_rejectedKey);
    _emit();
  }

  /// Drops everything queued (used when signing out of the account that made them).
  Future<void> clear() async {
    await _store.delete(_queueKey);
    await _store.delete(_rejectedKey);
    _emit();
  }

  // Queued writes belong to the account that made them; another login never replays them.
  List<OutboxItem> _mine(List<OutboxItem> all) => all.where((i) => i.userId == currentUserId()).toList();

  Future<dynamic> _sendWithRetry(OutboxItem item) async {
    for (var attempt = 0;; attempt++) {
      try {
        return await _api.send(item.method, item.path, body: item.body, idempotencyKey: item.key, farmId: item.farmId);
      } on ApiError catch (e) {
        // 409 = the same key is still being processed (double tap); the replay will answer.
        if (e.status != 409 || attempt >= 3) rethrow;
        await Future<void>.delayed(Duration(milliseconds: 400 * (attempt + 1)));
      }
    }
  }

  Future<void> _enqueue(OutboxItem item) async {
    await _store.write(_queueKey, [...items.map((i) => i.toJson()), item.toJson()]);
    _emit();
  }

  void _setSyncing(bool v) {
    _syncing = v;
    _emit();
  }

  void _emit() {
    if (!_changes.isClosed) _changes.add(status);
  }

  void dispose() => _changes.close();
}
