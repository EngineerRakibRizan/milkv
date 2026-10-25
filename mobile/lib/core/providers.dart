import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api/api_client.dart';
import 'auth/session.dart';
import 'i18n/format.dart';
import 'i18n/i18n.dart';
import 'offline/outbox.dart';
import 'offline/query_cache.dart';
import 'storage/local_store.dart';
import 'storage/secret_store.dart';

// Overridden in main() (and in tests) once storage is open and strings are loaded.
final localStoreProvider = Provider<LocalStore>((ref) => throw UnimplementedError('localStoreProvider'));
final secretStoreProvider = Provider<SecretStore>((ref) => SecureSecretStore());
final translationsProvider = Provider<Map<String, Translations>>((ref) => throw UnimplementedError('translationsProvider'));

final apiClientProvider = Provider<ApiClient>(buildApiClient);

/// The app's client: credentials come from the auth state at request time.
ApiClient buildApiClient(Ref ref, {String? baseUrl}) => ApiClient(
      baseUrl: baseUrl,
      credentials: () {
        final s = ref.read(authProvider);
        return Credentials(token: s.token, farmId: s.farmId);
      },
      onUnauthorized: () => ref.read(authProvider.notifier).expired(),
    );

/// Emits when the device regains a network connection.
final connectivityProvider = Provider<Stream<bool>>(
    (ref) => Connectivity().onConnectivityChanged.map((r) => r.any((x) => x != ConnectivityResult.none)));

final queryCacheProvider = Provider<QueryCache>((ref) => QueryCache(
      ref.watch(localStoreProvider),
      ref.watch(apiClientProvider),
      scope: () {
        final s = ref.read(authProvider);
        return 'u${s.me?.user.id}:f${s.farmId}';
      },
    ));

final outboxProvider = Provider<Outbox>((ref) {
  final o = Outbox(
    ref.watch(localStoreProvider),
    ref.watch(apiClientProvider),
    currentUserId: () => ref.read(authProvider).me?.user.id,
    currentFarmId: () => ref.read(authProvider).farmId,
  );
  ref.onDispose(o.dispose);
  return o;
});

final outboxStatusProvider = StreamProvider<OutboxStatus>((ref) async* {
  final o = ref.watch(outboxProvider);
  yield o.status;
  yield* o.changes;
});

/// Bumped when queued writes finish syncing (or on pull-to-refresh across the
/// app); every screen's data provider watches it and reloads from the server.
class SyncEpoch extends Notifier<int> {
  @override
  int build() => 0;
  void bump() => state++;
}

final syncEpochProvider = NotifierProvider<SyncEpoch, int>(SyncEpoch.new);

// ---- Language ---------------------------------------------------------------

class LangController extends Notifier<String> {
  static const _key = 'pref.lang';

  @override
  String build() => (ref.read(localStoreProvider).read(_key) as String?) ?? 'bn'; // Bangla first, like the web app

  Future<void> set(String lang) async {
    state = lang;
    await ref.read(localStoreProvider).write(_key, lang);
  }
}

final langProvider = NotifierProvider<LangController, String>(LangController.new);
final trProvider = Provider<Translations>((ref) => ref.watch(translationsProvider)[ref.watch(langProvider)]!);
final fmtProvider = Provider<Fmt>((ref) => Fmt(ref.watch(langProvider)));

// ---- Auth ---------------------------------------------------------------------

class AuthController extends Notifier<AuthState> {
  static const _tokenKey = 'farmos.token';
  static const _farmKey = 'farmos.farm';
  static const _meKey = 'auth.me';

  @override
  AuthState build() {
    Future.microtask(_restore);
    return const AuthState();
  }

  /// Opens straight into the app from the saved session (works offline),
  /// then refreshes the profile and abilities from the server.
  Future<void> _restore() async {
    final secrets = ref.read(secretStoreProvider);
    final token = await secrets.read(_tokenKey);
    if (token == null) {
      state = const AuthState(status: AuthStatus.signedOut);
      return;
    }
    final saved = ref.read(localStoreProvider).read(_meKey);
    final farmId = int.tryParse(await secrets.read(_farmKey) ?? '');
    if (saved is Map) {
      state = AuthState(status: AuthStatus.signedIn, token: token, me: Me.fromJson(Map<String, dynamic>.from(saved)), farmId: farmId);
      unawaited(refresh());
      return;
    }
    state = AuthState(status: AuthStatus.loading, token: token, farmId: farmId);
    try {
      await refresh();
    } on ApiError {
      state = const AuthState(status: AuthStatus.signedOut);
    }
  }

  Future<void> login(String email, String password) async {
    final res = await ref.read(apiClientProvider).send('POST', '/auth/login', body: {'email': email.trim(), 'password': password});
    final json = Map<String, dynamic>.from(res as Map);
    final token = json['token'] as String;
    await ref.read(secretStoreProvider).write(_tokenKey, token);
    final saved = int.tryParse(await ref.read(secretStoreProvider).read(_farmKey) ?? '');
    await _apply(Me.fromJson(json), token: token, preferredFarm: saved);
  }

  Future<void> refresh() async {
    final res = await ref.read(apiClientProvider).get('/auth/me');
    await _apply(Me.fromJson(Map<String, dynamic>.from(res as Map)), token: state.token, preferredFarm: state.farmId);
  }

  Future<void> _apply(Me me, {String? token, int? preferredFarm}) async {
    await ref.read(localStoreProvider).write(_meKey, me.raw);
    final farmIds = me.farms.map((f) => f.id).toSet();
    final farmId = farmIds.contains(preferredFarm) ? preferredFarm : (me.farms.length == 1 ? me.farms.first.id : null);
    await ref.read(secretStoreProvider).write(_farmKey, farmId?.toString());
    state = AuthState(status: AuthStatus.signedIn, token: token, me: me, farmId: farmId);
    unawaited(ref.read(outboxProvider).flush());
  }

  Future<void> selectFarm(int id) async {
    await ref.read(secretStoreProvider).write(_farmKey, '$id');
    state = state.copyWith(farmId: id);
    ref.read(syncEpochProvider.notifier).bump();
  }

  void chooseAnotherFarm() => state = state.copyWith(clearFarm: true);

  /// Server said the token is no longer valid (revoked or password changed).
  void expired() {
    if (state.status != AuthStatus.signedIn) return;
    unawaited(_clear());
  }

  Future<void> logout() async {
    try {
      await ref.read(apiClientProvider).send('POST', '/auth/logout');
    } on ApiError {
      // Offline: the token is dropped locally either way.
    }
    await ref.read(outboxProvider).clear();
    await _clear();
  }

  Future<void> _clear() async {
    await ref.read(secretStoreProvider).write(_tokenKey, null);
    await ref.read(localStoreProvider).delete(_meKey);
    await ref.read(queryCacheProvider).clearAll();
    state = const AuthState(status: AuthStatus.signedOut);
  }
}

final authProvider = NotifierProvider<AuthController, AuthState>(AuthController.new);
