import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../permissions/permission_service.dart';
import '../subscription/super_admin_scope.dart';
import '../tenant/tenant_scope.dart';
import 'auth_scope.dart';
import 'auth_session.dart';

/// What to do when Firebase reports its current user.
enum AuthStateAction { nothing, clearLocalSession }

/// Keeps the local "signed in" flag honest while the app is running.
///
/// FirebaseAuth's session is the source of truth. If it ends while the
/// app is open - the account deleted from the console, the token
/// revoked, a sign-out from another path - Firebase reports a null
/// user on authStateChanges(). Until now nothing listened, so the app
/// kept its local flag until the next restart. This watcher clears the
/// local session the moment that happens, and the router (which
/// listens to AuthScope) lands on Login.
///
/// A deliberate Logout is not "unexpected": signOut() sets the explicit
/// sign-out key first and clears the local session itself, and this
/// watcher leaves that alone. A null user while nothing was signed in
/// locally is not news either.
class AuthStateWatcher {
  AuthStateWatcher._();

  static StreamSubscription<User?>? _subscription;

  /// The decision, on its own so it can be tested without Firebase.
  @visibleForTesting
  static AuthStateAction decide({
    required bool firebaseUserPresent,
    required bool locallyAuthenticated,
    required bool explicitlySignedOut,
  }) {
    if (firebaseUserPresent) return AuthStateAction.nothing;
    if (!locallyAuthenticated) return AuthStateAction.nothing;
    if (explicitlySignedOut) return AuthStateAction.nothing;
    return AuthStateAction.clearLocalSession;
  }

  /// Subscribes to Firebase. Safe to call once after Firebase is up;
  /// a build without Firebase simply does not watch.
  static void start() {
    if (_subscription != null) return;
    try {
      _subscription = FirebaseAuth.instance
          .authStateChanges()
          .listen((user) => unawaited(onUserChanged(user != null)));
    } catch (error) {
      debugPrint('Auth state watcher not started: $error');
    }
  }

  static Future<void> stop() async {
    await _subscription?.cancel();
    _subscription = null;
  }

  /// Handles one report from Firebase. Public (and Firebase-free) so a
  /// test can feed it "the user is gone" directly.
  static Future<void> onUserChanged(bool firebaseUserPresent) async {
    var explicitlySignedOut = false;
    try {
      final prefs = await SharedPreferences.getInstance();
      explicitlySignedOut =
          prefs.getBool(AuthSessionNotifier.explicitSignOutKey) ?? false;
    } catch (_) {}

    final action = decide(
      firebaseUserPresent: firebaseUserPresent,
      locallyAuthenticated: AuthScope.isAuthenticated,
      explicitlySignedOut: explicitlySignedOut,
    );
    if (action != AuthStateAction.clearLocalSession) return;

    debugPrint('Firebase session ended; clearing the local session.');
    AuthScope.clear();
    // The active tenant belongs to the account that just ended; the
    // next sign-in establishes its own (see TenantBootstrap).
    TenantScope.clear();
    PermissionService.currentMobileNumberOverride = null;
    PermissionService.invalidateCache();
    SuperAdminScope.clear();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(AuthSessionNotifier.authenticatedKey);
      await prefs.remove(AuthSessionNotifier.mobileKey);
      await prefs.remove(AuthSessionNotifier.uidKey);
    } catch (error) {
      debugPrint('Could not clear the local session: $error');
    }
  }
}
