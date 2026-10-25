import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:aura_dairy/core/i18n/i18n.dart';
import 'package:aura_dairy/core/providers.dart';
import 'package:aura_dairy/core/storage/local_store.dart';
import 'package:aura_dairy/core/storage/secret_store.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:intl/date_symbol_data_local.dart';

/// A fake server: records every request and answers from [handler].
class FakeServer implements HttpClientAdapter {
  FakeServer([this.handler]);

  FutureOr<ResponseBody> Function(RequestOptions o)? handler;
  final requests = <RequestOptions>[];
  bool offline = false;

  List<RequestOptions> writes() => requests.where((r) => r.method != 'GET').toList();

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(o);
    if (offline) throw DioException(requestOptions: o, type: DioExceptionType.connectionError, error: 'offline');
    return handler!(o);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody jsonBody(Object? body, [int status = 200]) =>
    ResponseBody.fromString(jsonEncode(body), status, headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});

Map<String, dynamic> farmJson({int id = 1, String role = 'owner', List<String> abilities = const ['*']}) =>
    {'id': id, 'name': 'Aura Dairy & Agro', 'role': role, 'currency': 'BDT', 'locale': 'bn', 'timezone': 'Asia/Dhaka', 'default_milk_price': '90.00', 'abilities': abilities};

Map<String, dynamic> meJson({List<Map<String, dynamic>>? farms}) => {
      'user': {'id': 7, 'name': 'Rahim', 'email': 'rahim@example.com', 'locale': 'bn'},
      'farms': farms ?? [farmJson()],
    };

Future<Map<String, Translations>> loadTranslations() async {
  await initializeDateFormatting('bn');
  await initializeDateFormatting('en');
  return Translations.load();
}

/// Provider overrides wiring the app to in-memory storage and [server].
List<Override> testOverrides({required FakeServer server, required Map<String, Translations> tr, LocalStore? store, SecretStore? secrets}) => [
      localStoreProvider.overrideWithValue(store ?? MemoryStore()),
      secretStoreProvider.overrideWithValue(secrets ?? MemorySecretStore()),
      translationsProvider.overrideWithValue(tr),
      connectivityProvider.overrideWithValue(const Stream<bool>.empty()),
      apiClientProvider.overrideWith((ref) => buildApiClient(ref, baseUrl: 'https://farm.test/api')..dio.httpClientAdapter = server),
    ];

Widget wrap(Widget child) => MaterialApp(home: child);
