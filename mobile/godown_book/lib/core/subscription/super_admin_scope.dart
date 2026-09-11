import 'package:firebase_auth/firebase_auth.dart';

import '../../features/subscription/services/super_admin_firestore_service.dart';

/// Resolves whether the currently signed-in Firebase user is a
/// platform-level Super Admin.
///
/// SOURCE OF TRUTH IS FIRESTORE (superAdmins/{uid}), not local SQLite -
/// this is the fix for a critical gap the project's own production-
/// readiness audit identified: a Firestore Security Rule has no way
/// to check a value that only exists in a phone's local database, so
/// as long as Super Admin status lived only in SQLite, the
/// subscriptions collection's write rule could never safely trust
/// "the caller says they're a Super Admin" - it had to deny every
/// write, genuine admins included. Checking Firestore here means the
/// exact same authorization Security Rules enforce server-side is
/// what this class reports client-side, instead of a second, weaker,
/// locally-editable source that could disagree with it.
///
/// Deliberately synchronous-after-load, same pattern as
/// AuthScope/TenantScope: call refresh() once when the session is
/// known (mirrors how those two are populated at startup/login - see
/// main.dart's _loadPermissionSession and
/// AuthSessionNotifier.markAuthenticated), then isSuperAdmin reads the
/// cached result instantly for UI checks (e.g. "show the Super Admin
/// Dashboard menu item") without an async gap on every rebuild.
class SuperAdminScope {
  SuperAdminScope._();

  static bool _isSuperAdmin = false;
  static String? _loadedForUid;

  static bool get isSuperAdmin => _isSuperAdmin;

  /// Re-checks against the current session's Firebase uid - call after
  /// login/logout (same trigger points as
  /// PermissionService.invalidateCache) and once at startup.
  static Future<void> refresh() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;

    if (uid == null || uid.isEmpty) {
      _isSuperAdmin = false;
      _loadedForUid = null;
      return;
    }

    if (_loadedForUid == uid) return;

    _isSuperAdmin =
        await SuperAdminFirestoreService.instance.isCurrentUserSuperAdmin();
    _loadedForUid = uid;
  }

  /// Used on sign-out and in tests.
  static void clear() {
    _isSuperAdmin = false;
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
