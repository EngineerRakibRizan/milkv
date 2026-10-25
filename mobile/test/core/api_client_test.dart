import 'package:aura_dairy/core/api/api_client.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers.dart';

void main() {
  late FakeServer server;
  late ApiClient api;
  var credentials = const Credentials(token: 'tok-1', farmId: 3);
  var unauthorized = 0;

  setUp(() {
    server = FakeServer((o) => jsonBody({'ok': true}));
    credentials = const Credentials(token: 'tok-1', farmId: 3);
    unauthorized = 0;
    api = ApiClient(credentials: () => credentials, onUnauthorized: () => unauthorized++, baseUrl: 'https://farm.test/api')..dio.httpClientAdapter = server;
  });

  test('sends bearer token, farm and JSON accept headers', () async {
    await api.get('/dashboard');
    final h = server.requests.single.headers;
    expect(h['Authorization'], 'Bearer tok-1');
    expect(h['X-Farm-Id'], '3');
    expect(h['Accept'], 'application/json');
    expect(h.containsKey('Idempotency-Key'), isFalse, reason: 'reads are not keyed');
  });

  test('every write gets an Idempotency-Key; an explicit key is reused as-is', () async {
    await api.send('POST', '/payments', body: {'amount': '10'});
    await api.send('POST', '/payments', body: {'amount': '10'});
    await api.send('PATCH', '/deliveries/5', body: {'status': 'delivered'}, idempotencyKey: 'action-1');
    await api.send('PATCH', '/deliveries/5', body: {'status': 'delivered'}, idempotencyKey: 'action-1');

    final keys = server.requests.map((r) => r.headers['Idempotency-Key'] as String).toList();
    expect(keys[0], isNotEmpty);
    expect(keys[0], isNot(keys[1]), reason: 'two separate actions');
    expect(keys.sublist(2), ['action-1', 'action-1'], reason: 'a retry of one action replays the same key');
  });

  test('a queued write replays against the farm it was made in', () async {
    await api.send('POST', '/milk/sheet', body: {}, farmId: 9);
    expect(server.requests.single.headers['X-Farm-Id'], '9');
  });

  test('omits empty query values', () async {
    await api.get('/customers', query: {'search': '', 'page': 2, 'balance': null});
    expect(server.requests.single.queryParameters, {'page': 2});
  });

  test('maps validation errors', () async {
    server.handler = (o) => jsonBody({'message': 'The amount field is required.', 'errors': {'amount': ['The amount field is required.']}}, 422);
    final e = await api.send('POST', '/payments', body: {}).then<ApiError?>((_) => null, onError: (Object e) => e as ApiError);
    expect(e!.status, 422);
    expect(e.offline, isFalse);
    expect(e.retryable, isFalse);
    expect(e.field('amount'), 'The amount field is required.');
  });

  test('no connection becomes an offline, retryable error', () async {
    server.offline = true;
    final e = await api.get('/dashboard').then<ApiError?>((_) => null, onError: (Object e) => e as ApiError);
    expect(e!.offline, isTrue);
    expect(e.retryable, isTrue);
  });

  test('server errors and "duplicate in progress" are retryable, 4xx are not', () {
    expect(ApiError('x', status: 500).retryable, isTrue);
    expect(ApiError('x', status: 409).retryable, isTrue);
    expect(ApiError('x', status: 403).retryable, isFalse);
  });

  test('401 with a token signs the user out', () async {
    server.handler = (o) => jsonBody({'message': 'Unauthenticated.'}, 401);
    await expectLater(api.get('/auth/me'), throwsA(isA<ApiError>()));
    expect(unauthorized, 1);
  });
}
