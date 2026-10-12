import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

/// Resolves whether the currently signed-in Firebase user is a
/// platform-level Super Admin.
///
/// SOURCE OF TRUTH IS THE ID TOKEN: the custom claim `role ==
/// "superadmin"`, set only by the Admin SDK (tool/admin/
/// set-superadmin.js) and never by anything in this app. The Firestore
/// Security Rules check the very same claim server-side, so what this
/// class reports client-side and what the rules enforce can never
/// disagree - and there is no document a client could write to grant
/// itself access.
///
/// Deliberately synchronous-after-load, same pattern as
/// AuthScope/TenantScope: call refresh() once when the session is
/// known (see main.dart and AuthSessionNotifier.markAuthenticated),
/// then isSuperAdmin reads the cached result instantly for UI checks
/// without an async gap on every rebuild.
class SuperAdminScope {
  SuperAdminScope._();

  static const String claimKey = 'role';
  static const String claimValue = 'superadmin';

  static bool _isSuperAdmin = false;
  static String? _loadedForUid;
  static Future<void>? _inFlight;
  static String? _inFlightUid;

  /// Same value as [isSuperAdmin], for screens that must update the
  /// moment a check finishes (Settings shows the Super Admin menu).
  static final ValueNotifier<bool> listenable = ValueNotifier<bool>(false);

  static bool get isSuperAdmin => _isSuperAdmin;

  static void _set(bool value) {
    _isSuperAdmin = value;
    listenable.value = value;
  }

  /// Tests: the claims the "token" carries, instead of Firebase.
  @visibleForTesting
  static Future<Map<String, dynamic>?> Function()? claimsOverride;

  /// The decision on its own, so it can be tested without Firebase.
  @visibleForTesting
  static bool grantsSuperAdmin(Map<String, dynamic>? claims) {
    return claims != null && claims[claimKey] == claimValue;
  }

  /// Re-checks against the current session's Firebase uid - call after
  /// login/logout (same trigger points as
  /// PermissionService.invalidateCache) and once at startup.
  ///
  /// A freshly granted or revoked claim reaches the device with the
  /// next token refresh; refresh() asks Firebase for a fresh token so a
  /// grant made a moment ago is seen at the next sign-in, and falls
  /// back to the cached token when offline. A failed check denies
  /// access - never grants it.
  ///
  /// Only an answer from a fresh token is remembered. One read from the
  /// cached token (offline, slow network at launch) is used for now
  /// but checked again on the next call - before, a failed check at
  /// launch was kept until logout and the Super Admin menu stayed
  /// hidden. Concurrent calls share one check.
  static Future<void> refresh() {
    if (_testOverride != null) {
      _set(_testOverride!);
      return Future.value();
    }

    String? uid;
    try {
      uid = FirebaseAuth.instance.currentUser?.uid;
    } catch (_) {
      uid = null;
    }
    final running = _inFlight;
    if (running != null && _inFlightUid == uid) return running;

    _inFlightUid = uid;
    late final Future<void> call;
    call = _refresh().whenComplete(() {
      if (identical(_inFlight, call)) _inFlight = null;
    });
    return _inFlight = call;
  }

  static Future<void> _refresh() async {
    final override = claimsOverride;
    if (override != null) {
      _set(grantsSuperAdmin(await override()));
      return;
    }

    final User? user;
    try {
      user = FirebaseAuth.instance.currentUser;
    } catch (_) {
      // Firebase not initialised (a build still on the placeholder
      // options, or a unit test). Nobody is a Super Admin then, which
      // is the safe answer - never a crash.
      _set(false);
      _loadedForUid = null;
      return;
    }

    if (user == null || user.uid.isEmpty) {
      _set(false);
      _loadedForUid = null;
      return;
    }

    if (_loadedForUid == user.uid) return;

    final (claims, definite) = await _claimsFor(user);

    // Signed out or switched while the check was out.
    if (FirebaseAuth.instance.currentUser?.uid != user.uid) return;

    _set(grantsSuperAdmin(claims));
    if (definite) _loadedForUid = user.uid;
  }

  /// The token's claims, and whether they came from a fresh token (a
  /// definite answer) rather than the cached one.
  static Future<(Map<String, dynamic>?, bool)> _claimsFor(User user) async {
    try {
      final fresh = await user
          .getIdTokenResult(true)
          .timeout(const Duration(seconds: 8));
      return (fresh.claims, true);
    } catch (_) {
      // Offline: the last token Firebase cached still carries the
      // claims it was issued with - used for now, checked again later.
      try {
        return ((await user.getIdTokenResult()).claims, false);
      } catch (error) {
        debugPrint('Super Admin claim check failed: $error');
        return (null, false);
      }
    }
  }

  /// Used on sign-out and in tests.
  static void clear() {
    _set(false);
    _loadedForUid = null;
  }

  /// Test seam: forces the answer without Firebase, so a test can
  /// exercise the Super Admin paths (authorising a payment, activating
  /// a subscription). Production code never sets it; pass null to go
  /// back to the real check.
  static bool? _testOverride;

  static void overrideForTesting(bool? isSuperAdmin) {
    _testOverride = isSuperAdmin;
    _set(isSuperAdmin ?? false);
    _loadedForUid = null;
  }
}

/// Thrown by repository-layer writes that require Super Admin - the
/// platform-level equivalent of PermissionDeniedException (which is
/// specifically for company-scoped Role/Permission checks and would be
/// a misleading message for this genuinely different authorization
/// tier).
class SuperAdminRequiredException implements Exception {
  @override
  String toString() =>
      'This action requires Super Admin access, which the current '
      'signed-in number does not have.';
}
