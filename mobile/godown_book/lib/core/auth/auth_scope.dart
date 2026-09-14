import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Synchronous, app-wide read of whether this device has a completed
/// mobile+OTP sign-in - the auth equivalent of TenantScope.
///
/// GoRouter's redirect callback is a plain synchronous function, so -
/// exactly like TenantScope - the SharedPreferences read happens once
/// at startup in main(), and this class holds the resulting in-memory
/// flag for the redirect to check instantly on every navigation.
///
/// [listenable] is the router's refreshListenable: when the flag flips
/// (a sign-in, a logout, or Firebase ending the session while the app
/// is open) the router re-runs its redirect and lands on the right
/// screen without anyone having to navigate.
class AuthScope {
  AuthScope._();

  static final ValueNotifier<bool> listenable = ValueNotifier<bool>(false);

  static bool get isAuthenticated => listenable.value;

  static void set(bool value) => listenable.value = value;

  /// Used on sign-out.
  static void clear() => listenable.value = false;

  static const _authenticatedKey = 'auth_is_authenticated';

  /// Reads the persisted flag once at app startup, before the first route
  /// resolves - mirrors _loadTenant() in main.dart.
  static Future<void> loadFromDisk() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      listenable.value = prefs.getBool(_authenticatedKey) ?? false;
    } catch (_) {
      // First run, or preferences unavailable - default to signed-out.
      listenable.value = false;
    }
  }
}
