/// Shapes of `POST /auth/login` and `GET /auth/me` (AuthController::session).
class Farm {
  Farm({required this.id, required this.name, required this.role, required this.abilities, this.currency = 'BDT', this.locale, this.timezone, this.defaultMilkPrice});

  final int id;
  final String name;
  final String role;
  final List<String> abilities;
  final String currency;
  final String? locale;
  final String? timezone;
  final String? defaultMilkPrice;

  /// Same rule as the server (CurrentFarm::can) and the web app: '*', exact, or 'module.*'.
  bool can(String ability) =>
      abilities.contains('*') || abilities.contains(ability) || abilities.contains('${ability.split('.').first}.*');

  factory Farm.fromJson(Map<String, dynamic> j) => Farm(
        id: j['id'] as int,
        name: j['name'] as String? ?? '',
        role: j['role'] as String? ?? 'worker',
        abilities: [for (final a in (j['abilities'] as List? ?? const [])) '$a'],
        currency: j['currency'] as String? ?? 'BDT',
        locale: j['locale'] as String?,
        timezone: j['timezone'] as String?,
        defaultMilkPrice: j['default_milk_price'] as String?,
      );
}

class User {
  User({required this.id, required this.name, required this.email, this.locale});

  final int id;
  final String name;
  final String email;
  final String? locale;

  factory User.fromJson(Map<String, dynamic> j) =>
      User(id: j['id'] as int, name: j['name'] as String? ?? '', email: j['email'] as String? ?? '', locale: j['locale'] as String?);
}

class Me {
  Me(this.user, this.farms, this.raw);

  final User user;
  final List<Farm> farms;
  final Map<String, dynamic> raw;

  factory Me.fromJson(Map<String, dynamic> j) => Me(
        User.fromJson(Map<String, dynamic>.from(j['user'] as Map)),
        [for (final f in (j['farms'] as List? ?? const [])) Farm.fromJson(Map<String, dynamic>.from(f as Map))],
        {'user': j['user'], 'farms': j['farms']},
      );
}

enum AuthStatus { loading, signedOut, signedIn }

class AuthState {
  const AuthState({this.status = AuthStatus.loading, this.token, this.me, this.farmId});

  final AuthStatus status;
  final String? token;
  final Me? me;
  final int? farmId;

  Farm? get farm {
    for (final f in me?.farms ?? const <Farm>[]) {
      if (f.id == farmId) return f;
    }
    return null;
  }

  bool can(String ability) => farm?.can(ability) ?? false;

  /// Signed in, but belongs to several farms and has not picked one yet.
  bool get needsFarm => status == AuthStatus.signedIn && farm == null;

  AuthState copyWith({AuthStatus? status, String? token, Me? me, int? farmId, bool clearFarm = false}) => AuthState(
        status: status ?? this.status,
        token: token ?? this.token,
        me: me ?? this.me,
        farmId: clearFarm ? null : farmId ?? this.farmId,
      );
}
