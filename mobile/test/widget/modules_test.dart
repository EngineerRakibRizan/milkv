import 'package:aura_dairy/core/i18n/i18n.dart';
import 'package:aura_dairy/core/providers.dart';
import 'package:aura_dairy/core/storage/local_store.dart';
import 'package:aura_dairy/core/storage/secret_store.dart';
import 'package:aura_dairy/features/finance/bill_sheet.dart';
import 'package:aura_dairy/features/home/more_screen.dart';
import 'package:aura_dairy/features/inventory/inventory_screen.dart';
import 'package:aura_dairy/features/reports/reports_screen.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers.dart';

/// Minimal fake API for the operations and finance modules.
ResponseBody moduleServer(RequestOptions o) => switch ((o.method, o.path)) {
      ('GET', '/inventory') => jsonBody({
          'data': [
            {'id': 1, 'sku': 'COW-CON', 'name': 'Cow concentrate', 'category': 'concentrate', 'unit': 'kg', 'stock': '332.000', 'min_stock': '300.000',
              'stock_value': '17348.66', 'avg_cost': '52.25', 'low': false},
            {'id': 5, 'sku': 'LAYER', 'name': 'Layer feed', 'category': 'hen_feed', 'unit': 'kg', 'stock': '95.000', 'min_stock': '200.000',
              'stock_value': '5541.91', 'avg_cost': '58.33', 'low': true},
          ],
          'total_value': '22890.57',
        }),
      ('GET', '/accounts') => jsonBody([
          {'key': 'electricity', 'name': 'Electricity', 'type': 'expense'},
          {'key': 'feed_expense', 'name': 'Feed consumed', 'type': 'expense'},
          {'key': 'egg_sales', 'name': 'Egg sales', 'type': 'revenue'},
        ]),
      ('GET', '/reports/pnl') => jsonBody({
          'revenue': [{'key': 'milk_sales', 'name': 'Milk sales', 'amount': '144101.50'}],
          'expenses': [
            {'key': 'feed_expense', 'name': 'Feed consumed', 'section': 'direct', 'amount': '60000.00'},
            {'key': 'electricity', 'name': 'Electricity', 'section': 'operating', 'amount': '6800.00'},
          ],
          'total_revenue': '144101.50', 'direct_costs': '60000.00', 'gross_profit': '84101.50', 'operating_expenses': '6800.00', 'net_profit': '77301.50',
        }),
      ('GET', '/reports/ledger') => jsonBody({'account': o.queryParameters['account'], 'lines': [
          {'date': '2026-10-02', 'memo': 'Milk delivery', 'debit': '0.00', 'credit': '450.00'},
        ]}),
      ('POST', _) => jsonBody({'ok': true}, 201),
      _ => jsonBody({'data': [], 'meta': {'last_page': 1}}),
    };

void main() {
  late Map<String, Translations> tr;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    tr = await loadTranslations();
  });

  Future<(FakeServer, ProviderContainer)> pump(WidgetTester tester, Widget screen, {List<String> abilities = const ['*'], bool asSheet = false}) async {
    final store = MemoryStore();
    await store.write('pref.lang', 'en');
    await store.write('auth.me', meJson(farms: [farmJson(abilities: abilities)]));
    final secrets = MemorySecretStore()
      ..values['farmos.token'] = '1|abc'
      ..values['farmos.farm'] = '1';
    final server = FakeServer((o) => o.path == '/auth/me' ? jsonBody(meJson(farms: [farmJson(abilities: abilities)])) : moduleServer(o));
    final container = ProviderContainer(overrides: testOverrides(server: server, tr: tr, store: store, secrets: secrets));
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container: container, child: wrap(asSheet ? Scaffold(body: screen) : screen)));
    await tester.pumpAndSettle();
    return (server, container);
  }

  testWidgets('feed & inventory lists stock with the low-stock count', (tester) async {
    await pump(tester, const InventoryScreen());
    expect(find.text('Cow concentrate'), findsOneWidget);
    expect(find.text('Layer feed'), findsOneWidget);
    expect(find.text('Low'), findsOneWidget, reason: 'only the layer feed is below its minimum');
    expect(find.text('৳22,890.57'), findsOneWidget);
  });

  testWidgets('recording feed use posts one line with an Idempotency-Key', (tester) async {
    final (server, _) = await pump(tester, const FeedUseSheet(itemId: 1), asSheet: true);
    await tester.enterText(find.widgetWithText(TextField, 'Quantity'), '12.5');
    await tester.pump();
    await tester.tap(find.byKey(const Key('form-submit')));
    await tester.pumpAndSettle();

    final post = server.writes().single;
    expect(post.path, '/inventory-issues');
    expect(post.headers['Idempotency-Key'], isNotEmpty);
    expect(post.data, containsPair('type', 'consumption'));
    expect((post.data as Map)['lines'], [
      {'feed_item_id': 1, 'quantity': '12.5'},
    ]);
  });

  testWidgets('feed use made offline is queued for sync', (tester) async {
    final (server, container) = await pump(tester, const FeedUseSheet(itemId: 1), asSheet: true);
    server.offline = true;
    await tester.enterText(find.widgetWithText(TextField, 'Quantity'), '3');
    await tester.pump();
    await tester.tap(find.byKey(const Key('form-submit')));
    await tester.pumpAndSettle();
    expect(container.read(outboxProvider).items.single.path, '/inventory-issues');
  });

  testWidgets('an operating expense needs a category, then posts kind, category and payment', (tester) async {
    final (server, _) = await pump(tester, const BillSheet(), asSheet: true);
    final submit = find.byKey(const Key('form-submit'));
    await tester.enterText(find.widgetWithText(TextField, 'Description').last, 'October bill');
    await tester.enterText(find.widgetWithText(TextField, 'Unit price'), '6800');
    await tester.pump();
    expect(tester.widget<FilledButton>(submit).onPressed, isNull, reason: 'no category yet');

    await tester.tap(find.widgetWithText(InputDecorator, 'Category'));
    await tester.pumpAndSettle();
    expect(find.text('Feed consumed'), findsNothing, reason: 'feed is expensed when consumed, not bought');
    await tester.tap(find.text('Electricity'));
    await tester.pumpAndSettle();

    await tester.ensureVisible(submit);
    await tester.tap(submit);
    await tester.pumpAndSettle();
    final post = server.writes().single;
    expect(post.path, '/bills');
    expect(post.data, allOf(containsPair('kind', 'expense'), containsPair('category', 'electricity'), containsPair('paid', true), containsPair('method', 'cash')));
    expect((post.data as Map)['items'], [
      {'description': 'October bill', 'quantity': '1', 'unit_price': '6800'},
    ]);
  });

  testWidgets('profit & loss shows server figures and drills into the ledger', (tester) async {
    final (server, _) = await pump(tester, const ReportsScreen());
    expect(find.text('Net profit'), findsWidgets);
    expect(find.text('৳77,301.5'), findsWidgets);

    await tester.tap(find.text('Milk sales'));
    await tester.pumpAndSettle();
    final ledger = server.requests.lastWhere((r) => r.path == '/reports/ledger');
    expect(ledger.queryParameters['account'], 'milk_sales');
    expect(find.text('Milk delivery'), findsOneWidget);
  });

  testWidgets('More shows only the modules the role can open', (tester) async {
    await pump(tester, const MoreScreen(tabs: ['dashboard', 'milk']),
        abilities: ['dashboard.view', 'milk.view', 'inventory.view', 'inventory.consume', 'tasks.view', 'notifications.view']);
    expect(find.text('Feed & Inventory'), findsOneWidget);
    for (final hidden in ['Veterinary', 'Income', 'Expenses', 'Suppliers', 'Accounting & Reports']) {
      expect(find.text(hidden), findsNothing, reason: hidden);
    }
  });
}
