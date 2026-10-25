/// Build-time configuration. Override with
/// `flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8000/api`.
class AppConfig {
  static const apiBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'https://auradairy.com/api');

  /// Public website, used for links such as the order page.
  static String get webUrl => apiBaseUrl.replaceFirst(RegExp(r'/api/?$'), '');

  static const requestTimeout = Duration(seconds: 20);
}
