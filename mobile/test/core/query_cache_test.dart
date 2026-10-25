import 'package:aura_dairy/core/api/api_client.dart';
import 'package:aura_dairy/core/i18n/format.dart';
import 'package:aura_dairy/core/i18n/i18n.dart';
import 'package:aura_dairy/core/offline/query_cache.dart';
import 'package:aura_dairy/core/storage/local_store.dart';
import 'package:aura_dairy/shared/inputs.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';

import '../helpers.dart';

void main() {
  late FakeServer server;
  late MemoryStore store;
  var scope = 'u7:f1';
  late QueryCache cache;

  setUp(() {
    var n = 0;
    server = FakeServer((o) => jsonBody({'n': ++n}));
    store = MemoryStore();
    scope = 'u7:f1';
    cache = QueryCache(store, ApiClient(credentials: () => const Credentials(), baseUrl: 'https://farm.test/api')..dio.httpClientAdapter = server, scope: () => scope);
  });

  Future<List<Cached<Map>>> collect() => cache.watch<Map>('/dashboard', (j) => j as Map).toList();

  test('first open: fetches from the server', () async {
    final out = await collect();
    expect(out.map((c) => c.data['n']), [1]);
    expect(out.single.stale, isFalse);
  });

  test('next open: the saved copy first (instant), then the fresh one', () async {
    await collect();
    final out = await collect();
    expect(out.map((c) => c.data['n']), [1, 2]);
    expect(out.map((c) => c.stale), [true, false]);
  });

  test('offline with a saved copy: shows it, flagged offline', () async {
    await collect();
    server.offline = true;
    final out = await collect();
    expect(out.last.data['n'], 1);
    expect(out.last.offline, isTrue);
    expect(out.last.savedAt, isNotNull);
  });

  test('offline with nothing saved: an error', () async {
    server.offline = true;
    expect(collect(), throwsA(isA<ApiError>()));
  });

  test('saved copies are kept per user and farm', () async {
    await collect();
    scope = 'u7:f2';
    server.offline = true;
    expect(collect(), throwsA(isA<ApiError>()));
  });

  test('query parameters are part of the key, in a stable order', () {
    expect(cache.keyFor('/deliveries', {'date': '2026-10-25', 'a': 1}), cache.keyFor('/deliveries', {'a': 1, 'date': '2026-10-25', 'x': ''}));
    expect(cache.keyFor('/deliveries', {'date': '2026-10-25'}), isNot(cache.keyFor('/deliveries', {'date': '2026-10-24'})));
  });

  test('patch edits the saved copy for an optimistic update', () async {
    await collect();
    await cache.patch('/dashboard', (d) => {...(d as Map), 'n': 99});
    expect(cache.peek('/dashboard'), {'n': 99});
  });

  group('formatting', () {
    setUpAll(() async {
      await initializeDateFormatting('bn');
      await initializeDateFormatting('en');
    });

    test('Bangla mode uses Bangla digits and lakh grouping', () {
      final bn = Fmt('bn');
      expect(bn.money('125000.50'), '৳১,২৫,০০০.৫');
      expect(bn.litres('12.500'), '১২.৫ লি.');
      expect(toBanglaDigits('2026'), '২০২৬');
    });

    test('English mode', () {
      final en = Fmt('en');
      expect(en.money('1250.00'), '৳1,250');
      expect(en.money('-40'), '-৳40');
      expect(en.litres('3'), '3 L');
    });

    test('dates shift by calendar day', () {
      expect(shiftDate('2026-10-25', 1), '2026-10-26');
      expect(shiftDate('2026-03-01', -1), '2026-02-28');
    });

    test('decimal input accepts Bangla digits', () {
      expect(DecimalInputFormatter.normalise('১২.৫'), '12.5');
      expect(DecimalInputFormatter.normalise('3,5'), '3.5');
      expect(trimZero('12.500'), '12.5');
      expect(trimZero('0.000'), '');
      expect(trimZero('8.000'), '8');
    });
  });
}
