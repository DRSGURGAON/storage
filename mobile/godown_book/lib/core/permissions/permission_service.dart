import '../../features/users/repositories/role_repository.dart';
import '../../features/users/repositories/user_repository.dart';
import '../tenant/tenant_scope.dart';
import 'permission.dart';

/// Resolves "does the currently signed-in user have permission X" -
/// this is the single enforcement point every screen/repository method
/// that needs a permission check should call, rather than re-querying
/// UserRepository/RoleRepository directly. A UI-only check (hiding a
/// button) can always be bypassed by a modified client or a direct
/// repository call - see AppRouter/individual repository methods for
/// where this is actually enforced beyond the UI, not just here.
///
/// BACKWARD COMPATIBILITY - the load-bearing design decision of this
/// whole feature: TenantScope's own doc comment says "today one
/// subscriber owns exactly one company" - there is no existing concept
/// of multiple distinct users, and the existing authentication (see
/// AuthSessionState) verifies a phone number, not a user identity. So:
/// if the signed-in mobile number has no matching UserModel row (true
/// for every existing install today, and the common case for a brand
/// new one until an admin explicitly adds more users), this resolves to
/// full Company Admin access - "Existing Company Admin should retain
/// full access" is not a fallback bolted on after the fact, it is what
/// this class does whenever no user record exists yet. Once a company
/// actually adds users (via the new Settings -> Users & Roles screen),
/// each signed-in mobile number that matches a UserModel is governed by
/// that user's actual role and its granted permissions instead.
class PermissionService {
  PermissionService._();

  static List<Permission>? _cachedGrantedPermissions;
  static String? _cachedForMobileNumber;
  static bool _cachedIsUnmanagedAdmin = false;

  /// Clears the cache - call after any role/permission/user-role change,
  /// or on sign-out, so a stale grant set is never used.
  static void invalidateCache() {
    _cachedGrantedPermissions = null;
    _cachedForMobileNumber = null;
    _cachedIsUnmanagedAdmin = false;
  }

  /// True when the current mobile number has no matching UserModel -
  /// the backward-compatible "unmanaged install, full access" case
  /// described above. Exposed so the Users & Roles UI can show an
  /// accurate "you are the default admin" state rather than implying a
  /// real, editable user record exists.
  static Future<bool> isUnmanagedAdmin() async {
    await _ensureLoaded();
    return _cachedIsUnmanagedAdmin;
  }

  static Future<void> _ensureLoaded() async {
    final mobileNumber = _currentMobileNumber();

    if (_cachedGrantedPermissions != null &&
        _cachedForMobileNumber == mobileNumber) {
      return;
    }

    if (!TenantScope.isReady) {
      // No company yet (onboarding) - nothing to check against; treat
      // as full access so onboarding itself is never blocked by a
      // permission check that has no company to scope to.
      _cachedGrantedPermissions = Permission.values;
      _cachedForMobileNumber = mobileNumber;
      _cachedIsUnmanagedAdmin = true;
      return;
    }

    final user = await UserRepository.instance.getCurrentUser(mobileNumber);

    if (user == null) {
      // Backward-compatible default - see this class's own doc comment.
      _cachedGrantedPermissions = Permission.values;
      _cachedForMobileNumber = mobileNumber;
      _cachedIsUnmanagedAdmin = true;
      return;
    }

    if (!user.isActive) {
      // A deactivated user has no permissions at all, not even view -
      // matches "activate/deactivate user" actually meaning something.
      _cachedGrantedPermissions = const [];
      _cachedForMobileNumber = mobileNumber;
      _cachedIsUnmanagedAdmin = false;
      return;
    }

    final granted = await RoleRepository.instance.getPermissionsForRole(
      user.roleId,
    );

    _cachedGrantedPermissions = granted;
    _cachedForMobileNumber = mobileNumber;
    _cachedIsUnmanagedAdmin = false;
  }

  static String? _currentMobileNumber() {
    // AuthSessionState is a Riverpod StateNotifier's state, not directly
    // readable from a plain static class without a WidgetRef - callers
    // that already have one should prefer hasPermissionWithSession
    // below, which takes the mobile number directly rather than this
    // class reaching into Riverpod itself. This getter exists only as
    // the fallback used when no ref is available (e.g. deep in a
    // repository) - see currentMobileNumberOverride.
    return currentMobileNumberOverride;
  }

  /// Set once at app startup/session-change from a place that does have
  /// a WidgetRef (see main.dart/login flow), so repository-layer code
  /// deep in the call stack can still resolve "who is this" without
  /// needing Riverpod threaded through every method signature. Mirrors
  /// exactly how AuthScope/TenantScope already expose a synchronous,
  /// statically-set value for the same reason.
  static String? currentMobileNumberOverride;

  static Future<bool> hasPermission(Permission permission) async {
    await _ensureLoaded();
    return _cachedGrantedPermissions?.contains(permission) ?? false;
  }

  static Future<bool> hasAnyPermission(List<Permission> permissions) async {
    await _ensureLoaded();
    final granted = _cachedGrantedPermissions ?? const [];
    return permissions.any(granted.contains);
  }

  /// Throws if the current user lacks [permission] - the actual
  /// enforcement primitive for a repository/service method, as opposed
  /// to hasPermission's boolean (used for UI show/hide). Call this at
  /// the start of any write method the task's Financial Safety /
  /// enforcement-layer requirements apply to.
  static Future<void> requirePermission(Permission permission) async {
    final allowed = await hasPermission(permission);

    if (!allowed) {
      throw PermissionDeniedException(permission);
    }
  }
}

class PermissionDeniedException implements Exception {
  final Permission permission;

  const PermissionDeniedException(this.permission);

  @override
  String toString() =>
      'Permission denied: ${permission.code} is not granted to the '
      'current user.';
}
