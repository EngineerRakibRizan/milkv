import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/offline/outbox.dart';
import '../../core/offline/query_cache.dart';
import '../../core/providers.dart';

/// Present::delivery.
class Delivery {
  Delivery(this.json);

  final Map<String, dynamic> json;

  int get id => json['id'] as int;
  String get date => '${json['date']}';
  Map<String, dynamic> get customer => Map<String, dynamic>.from(json['customer'] as Map? ?? const {});
  int? get customerId => json['customer_id'] as int?;
  String get customerName => '${customer['name'] ?? ''}';
  String? get phone => customer['phone'] as String?;
  String? get area => customer['area'] as String?;
  String? get address => customer['address'] as String?;
  String get balance => '${customer['balance'] ?? '0'}';
  String get ordered => '${json['ordered'] ?? '0'}';
  String get delivered => '${json['delivered'] ?? '0'}';
  String get unitPrice => '${json['unit_price'] ?? '0'}';
  String get amount => '${json['amount'] ?? '0'}';
  String get status => '${json['status']}';
  String? get employee => json['employee'] as String?;
  String? get notes => json['notes'] as String?;

  bool get done => status == 'delivered' || status == 'partial';
  bool get open => !done && status != 'cancelled';
}

class DeliveryDay {
  DeliveryDay(this.items, this.summary);

  final List<Delivery> items;
  final Map<String, dynamic> summary;

  factory DeliveryDay.fromJson(dynamic j) => DeliveryDay(
        [for (final d in j['data'] as List) Delivery(Map<String, dynamic>.from(d as Map))],
        Map<String, dynamic>.from(j['summary'] as Map? ?? const {}),
      );
}

class DeliveriesRepository {
  DeliveriesRepository(this._cache, this._outbox);

  final QueryCache _cache;
  final Outbox _outbox;

  Stream<Cached<DeliveryDay>> day(String date) => _cache.watch('/deliveries', DeliveryDay.fromJson, query: {'date': date});

  /// One-tap status change (`PATCH /deliveries/{id}`). Delivered/partial posts
  /// stock and the invoice on the server; [collected] records cash taken now.
  Future<WriteResult> update(Delivery d, {required String status, String? delivered, String? collected, String method = 'cash'}) async {
    final body = <String, dynamic>{
      'status': status,
      'delivered': ?delivered,
      if (collected != null && collected.isNotEmpty) ...{'collected': collected, 'method': method},
    };
    final r = await _outbox.send('PATCH', '/deliveries/${d.id}', body: body, label: 'delivery:${d.id}:$status');
    await _cache.patch('/deliveries', query: {'date': d.date}, (data) {
      final m = Map<String, dynamic>.from(data as Map);
      m['data'] = [
        for (final raw in m['data'] as List)
          (raw as Map)['id'] == d.id
              ? (r.queued ? {...raw, 'status': status, 'delivered': delivered ?? (status == 'delivered' ? d.ordered : raw['delivered'])} : r.data)
              : raw,
      ];
      return m;
    });
    return r;
  }

  /// Builds the day's list from customer schedules (`POST /deliveries/generate`). Needs a connection.
  Future<int> generate(String date) async {
    final r = await _outbox.send('POST', '/deliveries/generate', body: {'date': date}, label: 'generate:$date', allowQueue: false);
    return (r.data as Map?)?['created'] as int? ?? 0;
  }
}

final deliveriesRepositoryProvider = Provider((ref) => DeliveriesRepository(ref.watch(queryCacheProvider), ref.watch(outboxProvider)));

final deliveryDayProvider = StreamProvider.autoDispose.family<Cached<DeliveryDay>, String>((ref, date) {
  ref.watch(syncEpochProvider);
  ref.watch(authProvider.select((s) => s.farmId));
  return ref.watch(deliveriesRepositoryProvider).day(date);
});
