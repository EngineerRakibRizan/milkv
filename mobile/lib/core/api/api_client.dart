import 'dart:async';

import 'package:dio/dio.dart';
import 'package:uuid/uuid.dart';

import '../config.dart';

/// A failed request, normalised. `status == 0` means the server was never
/// reached (offline, DNS, timeout) and the write may be queued for later.
class ApiError implements Exception {
  ApiError(this.message, {this.status = 0, this.errors = const {}});

  final String message;
  final int status;
  final Map<String, List<String>> errors;

  bool get offline => status == 0;

  /// Worth retrying later with the same Idempotency-Key: the server did not
  /// reject the request itself (offline, overloaded, or still busy with it).
  bool get retryable => offline || status >= 500 || status == 409 || status == 429 || status == 408;

  String? field(String name) => errors[name]?.first;

  factory ApiError.from(Object e) {
    if (e is ApiError) return e;
    if (e is DioException) {
      final res = e.response;
      if (res == null) {
        return ApiError('offline');
      }
      final data = res.data;
      var message = 'Something went wrong';
      final errors = <String, List<String>>{};
      if (data is Map) {
        if (data['message'] is String) message = data['message'] as String;
        final raw = data['errors'];
        if (raw is Map) {
          raw.forEach((k, v) => errors['$k'] = v is List ? v.map((x) => '$x').toList() : ['$v']);
        }
      }
      return ApiError(message, status: res.statusCode ?? 500, errors: errors);
    }
    return ApiError('$e', status: -1);
  }

  @override
  String toString() => 'ApiError($status, $message)';
}

/// Who is calling. Read on every request so a login or farm switch applies at once.
class Credentials {
  const Credentials({this.token, this.farmId});
  final String? token;
  final int? farmId;
}

/// The single HTTP client: base URL, auth and tenant headers, an
/// Idempotency-Key on every write, and error mapping to [ApiError].
class ApiClient {
  ApiClient({required this.credentials, Dio? dio, this.onUnauthorized, String? baseUrl})
      : dio = dio ??
            Dio(BaseOptions(
              baseUrl: baseUrl ?? AppConfig.apiBaseUrl,
              connectTimeout: AppConfig.requestTimeout,
              receiveTimeout: AppConfig.requestTimeout,
              sendTimeout: AppConfig.requestTimeout,
            )) {
    this.dio.interceptors.add(InterceptorsWrapper(onRequest: _onRequest, onError: _onError));
  }

  final Dio dio;
  final Credentials Function() credentials;
  final void Function()? onUnauthorized;

  static const _uuid = Uuid();
  static String newKey() => _uuid.v4();

  void _onRequest(RequestOptions o, RequestInterceptorHandler h) {
    final c = credentials();
    o.headers['Accept'] = 'application/json';
    if (c.token != null) o.headers['Authorization'] = 'Bearer ${c.token}';
    // A queued write replays against the farm it was made in, not the current one.
    final farmId = o.extra['farmId'] ?? c.farmId;
    if (farmId != null) o.headers['X-Farm-Id'] = '$farmId';
    if (o.method != 'GET' && o.headers['Idempotency-Key'] == null) {
      o.headers['Idempotency-Key'] = newKey();
    }
    h.next(o);
  }

  void _onError(DioException e, ErrorInterceptorHandler h) {
    if (e.response?.statusCode == 401 && credentials().token != null) onUnauthorized?.call();
    h.next(e);
  }

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async {
    try {
      final res = await dio.get<dynamic>(path, queryParameters: _clean(query));
      return res.data;
    } catch (e) {
      throw ApiError.from(e);
    }
  }

  /// A write. Pass the same [idempotencyKey] for every attempt of one user action.
  Future<dynamic> send(String method, String path, {Object? body, String? idempotencyKey, int? farmId}) async {
    try {
      final res = await dio.request<dynamic>(path,
          data: body,
          options: Options(
            method: method.toUpperCase(),
            headers: {'Idempotency-Key': ?idempotencyKey},
            extra: {'farmId': ?farmId},
          ));
      return res.data == '' ? null : res.data;
    } catch (e) {
      throw ApiError.from(e);
    }
  }

  static Map<String, dynamic>? _clean(Map<String, dynamic>? q) =>
      q == null ? null : (Map.of(q)..removeWhere((_, v) => v == null || v == ''));
}
