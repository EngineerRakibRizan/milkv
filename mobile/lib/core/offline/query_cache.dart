import 'dart:async';

import '../api/api_client.dart';
import '../storage/local_store.dart';

/// Data for a screen: what we have, whether it may be out of date, and the
/// error from the last refresh if it failed (e.g. offline).
class Cached<T> {
  const Cached(this.data, {this.stale = false, this.error, this.savedAt});

  final T data;
  final bool stale;
  final ApiError? error;
  final DateTime? savedAt;

  bool get offline => error?.offline ?? false;
}

/// Read-through cache of GET responses, scoped to user + farm. A screen gets
/// the last saved response instantly, then the fresh one from the server.
/// The server stays the source of truth: the cache is only ever replaced by
/// its responses, or patched locally for a write that is queued offline.
class QueryCache {
  QueryCache(this._store, this._api, {required this.scope});

  final LocalStore _store;
  final ApiClient _api;
  final String Function() scope;

  String keyFor(String path, [Map<String, dynamic>? query]) {
    final q = (query?.entries.where((e) => e.value != null && e.value != '').toList() ?? [])
      ..sort((a, b) => a.key.compareTo(b.key));
    return 'q:${scope()}:$path${q.isEmpty ? '' : '?${q.map((e) => '${e.key}=${e.value}').join('&')}'}';
  }

  Map<String, dynamic>? _entry(String key) {
    final e = _store.read(key);
    return e is Map ? Map<String, dynamic>.from(e) : null;
  }

  dynamic peek(String path, [Map<String, dynamic>? query]) => _entry(keyFor(path, query))?['data'];

  Stream<Cached<T>> watch<T>(String path, T Function(dynamic json) parse, {Map<String, dynamic>? query}) async* {
    final key = keyFor(path, query);
    final hit = _entry(key);
    final savedAt = DateTime.tryParse('${hit?['at']}');
    if (hit != null) yield Cached(parse(hit['data']), stale: true, savedAt: savedAt);
    try {
      final data = await _api.get(path, query: query);
      await _store.write(key, {'at': DateTime.now().toIso8601String(), 'data': data});
      yield Cached(parse(data), savedAt: DateTime.now());
    } on ApiError catch (e) {
      if (hit == null) rethrow;
      yield Cached(parse(hit['data']), stale: true, error: e, savedAt: savedAt);
    }
  }

  Future<T> fetch<T>(String path, T Function(dynamic json) parse, {Map<String, dynamic>? query}) =>
      watch(path, parse, query: query).last.then((c) => c.data);

  /// Optimistic local edit of a cached response (used when a write is queued).
  Future<void> patch(String path, dynamic Function(dynamic data) update, {Map<String, dynamic>? query}) async {
    final key = keyFor(path, query);
    final hit = _entry(key);
    if (hit == null) return;
    await _store.write(key, {...hit, 'data': update(hit['data'])});
  }

  /// Saves a fresh server response (e.g. one returned by a write) as the cached copy.
  Future<void> put(String path, dynamic data, {Map<String, dynamic>? query}) =>
      _store.write(keyFor(path, query), {'at': DateTime.now().toIso8601String(), 'data': data});

  Future<void> clearAll() => _store.deleteWhere((k) => k.startsWith('q:'));
}
