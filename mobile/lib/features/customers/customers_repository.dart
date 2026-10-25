import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/i18n/format.dart';
import '../../core/offline/outbox.dart';
import '../../core/offline/query_cache.dart';
import '../../core/providers.dart';

/// Present::customer.
class Customer {
  Customer(this.json);

  final Map<String, dynamic> json;

  int get id => json['id'] as int;
  String get name => '${json['name'] ?? ''}';
  String? get code => json['code'] as String?;
  String? get phone => json['phone'] as String?;
  String? get area => json['area'] as String?;
  String? get address => json['address'] as String?;
  String get balance => '${json['balance'] ?? '0'}';
  String get defaultQty => '${json['default_qty'] ?? '0'}';
  String? get price => json['price'] as String?;
  String? get schedule => json['schedule'] as String?;
  String get status => '${json['status'] ?? 'active'}';
}

class CustomerPage {
  CustomerPage(this.items, this.lastPage, this.total, this.totalDue);

  final List<Customer> items;
  final int lastPage;
  final int total;
  final String totalDue;

  factory CustomerPage.fromJson(dynamic j) => CustomerPage(
        [for (final c in j['data'] as List) Customer(Map<String, dynamic>.from(c as Map))],
        (j['meta'] as Map?)?['last_page'] as int? ?? 1,
        (j['meta'] as Map?)?['total'] as int? ?? 0,
        '${j['total_due'] ?? '0'}',
      );
}

class CustomerDetail {
  CustomerDetail(this.json);

  final Map<String, dynamic> json;

  Customer get customer => Customer(Map<String, dynamic>.from(json['customer'] as Map));
  Map<String, dynamic> get stats => Map<String, dynamic>.from(json['stats'] as Map? ?? const {});
  List<Map<String, dynamic>> _list(String k) => [for (final x in json[k] as List? ?? const []) Map<String, dynamic>.from(x as Map)];
  List<Map<String, dynamic>> get deliveries => _list('deliveries');
  List<Map<String, dynamic>> get payments => _list('payments');
  List<Map<String, dynamic>> get openInvoices => _list('open_invoices');
}

typedef CustomerQuery = ({String search, String balance, int page});

class CustomersRepository {
  CustomersRepository(this._cache, this._outbox);

  final QueryCache _cache;
  final Outbox _outbox;

  Stream<Cached<CustomerPage>> list(CustomerQuery q) => _cache.watch('/customers', CustomerPage.fromJson,
      query: {'search': q.search, 'balance': q.balance, 'page': q.page, 'per_page': 50});

  Stream<Cached<CustomerDetail>> detail(int id) => _cache.watch('/customers/$id', (j) => CustomerDetail(Map<String, dynamic>.from(j as Map)));

  /// `POST /payments`: settles the oldest unpaid invoices first on the server.
  Future<WriteResult> recordPayment({required int customerId, required String amount, required String method, required String date, String? reference, String? notes}) async {
    final r = await _outbox.send('POST', '/payments',
        body: {'customer_id': customerId, 'amount': amount, 'method': method, 'date': date, 'reference': reference, 'notes': notes},
        label: 'payment:$customerId:$amount');
    if (r.queued) {
      // Show the lower balance until the server's own figure arrives.
      await _cache.patch('/customers/$customerId', (data) {
        final m = Map<String, dynamic>.from(data as Map);
        final c = Map<String, dynamic>.from(m['customer'] as Map);
        c['balance'] = (Fmt.parse(c['balance']) - Fmt.parse(amount)).toStringAsFixed(2);
        m['customer'] = c;
        m['payments'] = [
          {'id': -1, 'date': date, 'amount': amount, 'method': method, 'reference': reference, 'pending': true},
          ...m['payments'] as List,
        ];
        return m;
      });
    }
    return r;
  }
}

final customersRepositoryProvider = Provider((ref) => CustomersRepository(ref.watch(queryCacheProvider), ref.watch(outboxProvider)));

final customerListProvider = StreamProvider.autoDispose.family<Cached<CustomerPage>, CustomerQuery>((ref, q) {
  ref.watch(syncEpochProvider);
  ref.watch(authProvider.select((s) => s.farmId));
  return ref.watch(customersRepositoryProvider).list(q);
});

final customerDetailProvider = StreamProvider.autoDispose.family<Cached<CustomerDetail>, int>((ref, id) {
  ref.watch(syncEpochProvider);
  return ref.watch(customersRepositoryProvider).detail(id);
});
