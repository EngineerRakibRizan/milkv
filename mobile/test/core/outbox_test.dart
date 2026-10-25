import 'package:aura_dairy/core/api/api_client.dart';
import 'package:aura_dairy/core/offline/outbox.dart';
import 'package:aura_dairy/core/storage/local_store.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers.dart';

void main() {
  late FakeServer server;
  late MemoryStore store;
  late Outbox outbox;
  int? userId;
  int? farmId;

  Outbox build() => Outbox(store, ApiClient(credentials: () => const Credentials(token: 't'), baseUrl: 'https://farm.test/api')..dio.httpClientAdapter = server,
      currentUserId: () => userId, currentFarmId: () => farmId);

  setUp(() {
    server = FakeServer((o) => jsonBody({'id': 1}, 201));
    store = MemoryStore();
    userId = 7;
    farmId = 1;
    outbox = build();
  });

  test('online: sends immediately and returns the server response', () async {
    final r = await outbox.send('POST', '/payments', body: {'amount': '50'}, label: 'pay');
    expect(r.queued, isFalse);
    expect(r.data, {'id': 1});
    expect(outbox.items, isEmpty);
    expect(server.requests.single.headers['Idempotency-Key'], isNotEmpty);
  });

  test('offline: queues the write with its key, then replays it with the SAME key and farm', () async {
    server.offline = true;
    final r = await outbox.send('POST', '/milk/sheet', body: {'date': '2026-10-25', 'rows': []}, label: 'milk');
    expect(r.queued, isTrue);
    expect(outbox.items, hasLength(1));
    final firstKey = server.requests.single.headers['Idempotency-Key'];

    farmId = 2; // user switched farm in the meantime
    server.offline = false;
    await outbox.flush();

    expect(outbox.items, isEmpty);
    final replay = server.requests.last;
    expect(replay.headers['Idempotency-Key'], firstKey, reason: 'server deduplicates on this key');
    expect(replay.headers['X-Farm-Id'], '1', reason: 'replayed against the farm it was made in');
    expect(replay.data, {'date': '2026-10-25', 'rows': []});
  });

  test('the queue survives an app restart', () async {
    server.offline = true;
    await outbox.send('PATCH', '/deliveries/4', body: {'status': 'delivered'}, label: 'd');
    final restarted = build();
    expect(restarted.items.single.path, '/deliveries/4');
  });

  test('replays in order and stops at the first write that still cannot reach the server', () async {
    server.offline = true;
    await outbox.send('PATCH', '/deliveries/1', body: {'status': 'delivered'}, label: 'a');
    await outbox.send('PATCH', '/deliveries/2', body: {'status': 'delivered'}, label: 'b');
    await outbox.send('PATCH', '/deliveries/3', body: {'status': 'delivered'}, label: 'c');
    server.offline = false;

    var calls = 0;
    server.handler = (o) => ++calls == 2 ? jsonBody({'message': 'Server Error'}, 500) : jsonBody({});
    server.requests.clear();
    await outbox.flush();

    expect(server.requests.map((r) => r.path), ['/deliveries/1', '/deliveries/2'], reason: 'stops at the 500, keeps order');
    expect(outbox.items.map((i) => i.path), ['/deliveries/2', '/deliveries/3']);

    server.handler = (o) => jsonBody({});
    await outbox.flush();
    expect(outbox.items, isEmpty);
  });

  test('while older writes are queued, a new write queues behind them (never overtakes)', () async {
    server.offline = true;
    await outbox.send('POST', '/milk/sheet', body: {'v': 1}, label: 'old');
    server.offline = false;
    server.handler = (o) async {
      await Future<void>.delayed(const Duration(milliseconds: 5));
      return jsonBody({});
    };
    server.requests.clear();

    final r = await outbox.send('POST', '/milk/sheet', body: {'v': 2}, label: 'new');
    expect(r.queued, isTrue);
    await outbox.flush();
    expect(server.requests.map((o) => o.data), [{'v': 1}, {'v': 2}]);
  });

  test('a write the server rejects (4xx) is dropped from the queue and reported', () async {
    server.offline = true;
    await outbox.send('POST', '/payments', body: {'amount': '0'}, label: 'bad');
    await outbox.send('POST', '/payments', body: {'amount': '20'}, label: 'good');
    server.offline = false;
    server.handler = (o) => (o.data as Map)['amount'] == '0'
        ? jsonBody({'message': 'The amount field must be greater than 0.'}, 422)
        : jsonBody({}, 201);

    await outbox.flush();
    expect(outbox.items, isEmpty);
    expect(outbox.rejected.single.message, 'The amount field must be greater than 0.');
    expect(outbox.rejected.single.item.label, 'bad');

    await outbox.dismissRejected();
    expect(outbox.rejected, isEmpty);
  });

  test('a rejected direct write is not queued (the user sees the error instead)', () async {
    server.handler = (o) => jsonBody({'message': 'Invalid', 'errors': {'date': ['bad']}}, 422);
    await expectLater(outbox.send('POST', '/milk/out', body: {}, label: 'x'), throwsA(isA<ApiError>()));
    expect(outbox.items, isEmpty);
  });

  test('writes that must not be queued fail when offline', () async {
    server.offline = true;
    await expectLater(outbox.send('POST', '/leads/1/convert', body: {}, label: 'c', allowQueue: false), throwsA(isA<ApiError>()));
    expect(outbox.items, isEmpty);
  });

  test('a double tap still being processed (409) is retried with the same key', () async {
    var n = 0;
    server.handler = (o) => ++n == 1 ? jsonBody({'message': 'Duplicate request in progress.'}, 409) : jsonBody({'id': 5}, 201);
    final r = await outbox.send('POST', '/payments', body: {}, label: 'p');
    expect(r.data, {'id': 5});
    expect(server.requests.map((o) => o.headers['Idempotency-Key']).toSet(), hasLength(1));
  });

  test("another account's queued writes are never replayed under the current login", () async {
    server.offline = true;
    await outbox.send('POST', '/payments', body: {}, label: 'by user 7');
    server.offline = false;
    userId = 8;
    server.requests.clear();
    await outbox.flush();
    expect(server.requests, isEmpty);
    expect(outbox.items, hasLength(1));
  });

  test('a 401 during replay keeps the queue for after sign-in', () async {
    server.offline = true;
    await outbox.send('POST', '/payments', body: {}, label: 'p');
    server.offline = false;
    server.handler = (o) => jsonBody({'message': 'Unauthenticated.'}, 401);
    await outbox.flush();
    expect(outbox.items, hasLength(1));
    expect(outbox.rejected, isEmpty);
  });

  test('status stream reports pending count', () async {
    final seen = <int>[];
    final sub = outbox.changes.listen((s) => seen.add(s.pending));
    server.offline = true;
    await outbox.send('POST', '/payments', body: {}, label: 'p');
    server.offline = false;
    server.handler = (o) => jsonBody({});
    await outbox.flush();
    await Future<void>.delayed(Duration.zero);
    await sub.cancel();
    expect(seen.first, 1);
    expect(seen.last, 0);
  });
}
