import 'package:aura_dairy/app.dart';
import 'package:aura_dairy/core/i18n/i18n.dart';
import 'package:aura_dairy/core/storage/secret_store.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers.dart';

/// Minimal answers for the screens the home shell opens.
ResponseBody appServer(RequestOptions o) => switch (o.path) {
      '/auth/login' => (o.data as Map)['password'] == 'secret123'
          ? jsonBody({'token': '1|abc', ...meJson()})
          : jsonBody({'message': 'These credentials do not match our records.', 'errors': {'email': ['These credentials do not match our records.']}}, 422),
      '/dashboard' => jsonBody({
          'date': '2026-10-25',
          'counts': {'cows': 12, 'lactating': 8},
          'milk': {'produced_today': '96.500', 'delivered_today': '40.000', 'stock': '56.500', 'trend': []},
          'deliveries_today': [],
          'tasks': [],
          'alerts': [],
          'low_stock': [],
        }),
      '/milk/sheet' => jsonBody({'date': o.queryParameters['date'], 'rows': [], 'summary': {}}),
      '/deliveries' => jsonBody({'data': [], 'summary': {}}),
      '/notifications' => jsonBody({'data': [], 'unread': 0, 'meta': {}}),
      _ => jsonBody({'data': [], 'meta': {'last_page': 1, 'total': 0}}),
    };

void main() {
  late Map<String, Translations> tr;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    tr = await loadTranslations();
  });

  Future<(FakeServer, MemorySecretStore)> pumpApp(WidgetTester tester) async {
    final server = FakeServer(appServer);
    final secrets = MemorySecretStore();
    await tester.pumpWidget(ProviderScope(overrides: testOverrides(server: server, tr: tr, secrets: secrets), child: const AuraDairyApp()));
    await tester.pumpAndSettle();
    return (server, secrets);
  }

  testWidgets('signs in, stores the token securely and opens the role-aware home', (tester) async {
    final (server, secrets) = await pumpApp(tester);

    // Bangla is the default language.
    expect(find.text('সাইন ইন'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('login-email')), ' rahim@example.com ');
    await tester.enterText(find.byKey(const Key('login-password')), 'secret123');
    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pumpAndSettle();

    final login = server.requests.firstWhere((r) => r.path == '/auth/login');
    expect(login.data, {'email': 'rahim@example.com', 'password': 'secret123'});
    expect(secrets.values['farmos.token'], '1|abc');
    expect(secrets.values['farmos.farm'], '1', reason: 'the only farm is chosen automatically');

    // Owner ('*'): dashboard, milk, deliveries, customers + more.
    expect(find.byType(NavigationBar), findsOneWidget);
    for (final label in ['ড্যাশবোর্ড', 'দুধ উৎপাদন', 'দুধ সরবরাহ', 'গ্রাহক', 'আরও']) {
      expect(find.descendant(of: find.byType(NavigationBar), matching: find.text(label)), findsOneWidget, reason: label);
    }
    // Later requests carry the token and farm.
    final dash = server.requests.firstWhere((r) => r.path == '/dashboard');
    expect(dash.headers['Authorization'], 'Bearer 1|abc');
    expect(dash.headers['X-Farm-Id'], '1');
  });

  testWidgets('shows the server message for wrong credentials', (tester) async {
    await pumpApp(tester);
    await tester.enterText(find.byKey(const Key('login-email')), 'rahim@example.com');
    await tester.enterText(find.byKey(const Key('login-password')), 'wrong');
    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pumpAndSettle();
    expect(find.text('These credentials do not match our records.'), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
  });

  testWidgets('switches to English', (tester) async {
    await pumpApp(tester);
    await tester.tap(find.byKey(const Key('lang-toggle')));
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsOneWidget);
  });

  testWidgets('a delivery worker gets only the screens their role allows', (tester) async {
    final server = FakeServer((o) => o.path == '/auth/login'
        ? jsonBody({'token': '2|x', ...meJson(farms: [farmJson(role: 'delivery', abilities: ['deliveries.view', 'deliveries.update', 'customers.view', 'payments.create', 'tasks.view', 'tasks.update', 'notifications.view'])])})
        : appServer(o));
    await tester.pumpWidget(ProviderScope(overrides: testOverrides(server: server, tr: tr), child: const AuraDairyApp()));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('login-email')), 'driver@example.com');
    await tester.enterText(find.byKey(const Key('login-password')), 'pw');
    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pumpAndSettle();

    final nav = find.byType(NavigationBar);
    expect(find.descendant(of: nav, matching: find.text('দুধ সরবরাহ')), findsOneWidget);
    expect(find.descendant(of: nav, matching: find.text('খামারের কাজ')), findsOneWidget);
    expect(find.descendant(of: nav, matching: find.text('ড্যাশবোর্ড')), findsNothing);
    expect(find.descendant(of: nav, matching: find.text('দুধ উৎপাদন')), findsNothing);
    expect(server.requests.where((r) => r.path == '/dashboard'), isEmpty);
  });
}
