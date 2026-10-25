import 'package:aura_dairy/core/i18n/format.dart';
import 'package:aura_dairy/core/i18n/i18n.dart';
import 'package:aura_dairy/core/offline/outbox.dart';
import 'package:aura_dairy/core/providers.dart';
import 'package:aura_dairy/core/storage/local_store.dart';
import 'package:aura_dairy/core/storage/secret_store.dart';
import 'package:aura_dairy/features/milk/milk_sheet_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers.dart';

Map<String, dynamic> sheet(String date, {String morning1 = '0.000'}) => {
      'date': date,
      'rows': [
        {'animal_id': 1, 'tag': 'C-01', 'name': 'Lali', 'morning': morning1, 'evening': '0.000', 'other': '0.000', 'total': morning1, 'notes': null, 'recorded': morning1 != '0.000'},
        {'animal_id': 2, 'tag': 'C-02', 'name': null, 'morning': '6.000', 'evening': '5.500', 'other': '0.000', 'total': '11.500', 'notes': null, 'recorded': true},
      ],
      'summary': {'produced': '11.500', 'delivered': '0.000', 'internal_use': '0.000', 'spoilage': '0.000', 'stock': '11.500'},
    };

void main() {
  late Map<String, Translations> tr;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    tr = await loadTranslations();
  });

  Future<(FakeServer, ProviderContainer)> pumpSheet(WidgetTester tester, {List<String> abilities = const ['*']}) async {
    final store = MemoryStore();
    final secrets = MemorySecretStore()
      ..values['farmos.token'] = '1|abc'
      ..values['farmos.farm'] = '1';
    await store.write('auth.me', meJson(farms: [farmJson(abilities: abilities)]));

    var morning1 = '0.000'; // what the server has stored for cow 1
    final server = FakeServer((o) => switch ((o.method, o.path)) {
          ('GET', '/milk/sheet') => jsonBody(sheet(o.queryParameters['date'] as String, morning1: morning1)),
          ('POST', '/milk/sheet') => jsonBody(sheet((o.data as Map)['date'] as String, morning1: morning1 = '${((o.data as Map)['rows'] as List)[0]['morning']}')),
          ('GET', '/auth/me') => jsonBody(meJson(farms: [farmJson(abilities: abilities)])),
          _ => jsonBody({}, 404),
        });
    final container = ProviderContainer(overrides: testOverrides(server: server, tr: tr, store: store, secrets: secrets));
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container: container, child: wrap(const MilkSheetScreen())));
    await tester.pumpAndSettle();
    return (server, container);
  }

  testWidgets('lists lactating cows with what is already recorded', (tester) async {
    await pumpSheet(tester);
    expect(find.text('Lali'), findsOneWidget);
    expect(find.text('C-02'), findsWidgets);
    final evening2 = tester.widget<TextField>(find.byKey(const Key('milk-2-evening')));
    expect(evening2.controller!.text, '5.5');
    final morning1 = tester.widget<TextField>(find.byKey(const Key('milk-1-morning')));
    expect(morning1.controller!.text, '', reason: 'zero shows as an empty field');
    // Nothing changed yet: Save is disabled.
    expect(tester.widget<FilledButton>(find.byKey(const Key('milk-save'))).onPressed, isNull);
  });

  testWidgets('entering a value and saving posts the whole day once, with an Idempotency-Key', (tester) async {
    final (server, _) = await pumpSheet(tester);

    await tester.enterText(find.byKey(const Key('milk-1-morning')), '১২.৫'); // typed on a Bangla keyboard
    await tester.pump();
    expect(find.text('সংরক্ষণ বাকি'), findsOneWidget, reason: 'unsaved changes');

    await tester.tap(find.byKey(const Key('milk-save')));
    await tester.pumpAndSettle();

    final post = server.writes().single;
    expect(post.path, '/milk/sheet');
    expect(post.headers['Idempotency-Key'], isNotEmpty);
    expect(post.data, {
      'date': today(),
      'rows': [
        {'animal_id': 1, 'morning': '12.5', 'evening': 0, 'other': '0.000'},
        {'animal_id': 2, 'morning': '6', 'evening': '5.5', 'other': '0.000'},
      ],
    });
    expect(find.text('দুধের হিসাব সংরক্ষিত'), findsOneWidget);
    expect(find.text('সব সংরক্ষিত'), findsOneWidget);
  });

  testWidgets('offline: the save is kept on the phone and queued for sync', (tester) async {
    final (server, container) = await pumpSheet(tester);
    server.offline = true;

    await tester.enterText(find.byKey(const Key('milk-1-evening')), '7');
    await tester.pump();
    await tester.tap(find.byKey(const Key('milk-save')));
    await tester.pumpAndSettle();

    expect(find.textContaining('ফোনে সংরক্ষিত হয়েছে'), findsOneWidget);
    final Outbox outbox = container.read(outboxProvider);
    expect(outbox.items.single.path, '/milk/sheet');
    expect((outbox.items.single.body as Map)['rows'][0], {'animal_id': 1, 'morning': 0, 'evening': '7', 'other': '0.000'});
    // The entered value stays visible from the patched local copy.
    expect(tester.widget<TextField>(find.byKey(const Key('milk-1-evening'))).controller!.text, '7');

    // Back online: the replay reuses the key from the original attempt.
    final firstKey = server.writes().first.headers['Idempotency-Key'];
    server.offline = false;
    await tester.runAsync(() => outbox.flush());
    await tester.pumpAndSettle();
    expect(outbox.items, isEmpty);
    expect(server.writes().last.headers['Idempotency-Key'], firstKey);
  });

  testWidgets('read-only roles cannot edit', (tester) async {
    await pumpSheet(tester, abilities: ['milk.view']);
    expect(tester.widget<TextField>(find.byKey(const Key('milk-1-morning'))).enabled, isFalse);
    expect(find.byKey(const Key('milk-save')), findsNothing);
  });
}
