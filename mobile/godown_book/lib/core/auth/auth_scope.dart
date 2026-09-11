import 'package:shared_preferences/shared_preferences.dart';

/// Synchronous, app-wide read of whether this device has a completed
/// mobile+OTP sign-in - the auth equivalent of TenantScope.
///
/// GoRouter's redirect callback is easiest to reason about as a plain
/// synchronous function (the existing TenantScope-based tenant redirect
/// already relies on this), so - exactly like TenantScope - the actual
/// SharedPreferences read happens once at startup in main(), and this
/// class just holds the resulting in-memory flag for the redirect to
/// check instantly on every navigation.
class AuthScope {
  AuthScope._();

  static bool _isAuthenticated = false;

  static bool get isAuthenticated => _isAuthenticated;

  static void set(bool value) => _isAuthenticated = value;

  /// Used on sign-out.
  static void clear() => _isAuthenticated = false;

  static const _authenticatedKey = 'auth_is_authenticated';

  /// Reads the persisted flag once at app startup, before the first route
  /// resolves - mirrors _loadTenant() in main.dart.
  static Future<void> loadFromDisk() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      _isAuthenticated = prefs.getBool(_authenticatedKey) ?? false;
    } catch (_) {
      // First run, or preferences unavailable - default to signed-out.
      _isAuthenticated = false;
    }
  }
}
