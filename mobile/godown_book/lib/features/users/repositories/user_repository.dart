import '../../../core/permissions/permission.dart';
import '../../../core/permissions/permission_service.dart';
import '../../../core/subscription/subscription_access_service.dart';
import '../../../core/tenant/tenant_scope.dart';
import '../../../core/utils/id_generator.dart';
import '../../audit/repositories/security_audit_repository.dart';
import '../data/user_dao.dart';
import '../models/role_model.dart';
import '../models/user_model.dart';

/// Thrown by [UserRepository.createUser] when the company's team is
/// already at the size its subscription allows. [limit] is what the
/// company is currently entitled to, so the screen can tell the owner
/// exactly how many more a plan would buy them.
class TeamLimitExceededException implements Exception {
  const TeamLimitExceededException(this.limit, {required this.isSubscribed});

  final int limit;

  /// Whether this is the paid limit (still hit it) or the free one
  /// (subscribing would raise it) - changes what the screen suggests.
  final bool isSubscribed;
}

class UserRepository {
  UserRepository._();

  static final UserRepository instance = UserRepository._();

  final UserDao _dao = UserDao.instance;

  Future<List<UserModel>> getAll() async {
    return _dao.getAll();
  }

  /// The team size a subscription currently allows, owner included -
  /// so 1 means "just the owner, nobody else".
  Future<int> teamLimit() async {
    final state = await SubscriptionAccessService.instance.currentState();
    if (state == null) return 1;
    return state.isActive
        ? state.settings.teamUserLimitPaid
        : state.settings.teamUserLimitFree;
  }

  /// Active team size right now, owner included - every active
  /// [UserModel] row plus the owner themselves, who the app never
  /// stores a row for until Users & Roles is actually set up (see
  /// PermissionService.isUnmanagedAdmin).
  Future<int> activeTeamSize() async {
    final active = (await _dao.getAll()).where((u) => u.isActive).length;
    return 1 + active;
  }

  /// Deactivates the most recently added team members down to what
  /// the subscription currently allows - called after every
  /// subscription-state check (app start, Users & Roles opening), so
  /// a lapsed subscription corrects itself without a Super Admin
  /// having to do it by hand. Never touches the owner (no row to
  /// touch) and never deletes anyone's record - just isActive, exactly
  /// like the owner deactivating someone themselves, so a renewal
  /// brings them straight back.
  Future<void> enforceTeamLimit() async {
    if (!TenantScope.isReady) return;
    final limit = await teamLimit();
    // getAll() orders newest first, so dropping from the front removes
    // the most recently added members, keeping the ones who were set
    // up earliest.
    final active = (await _dao.getAll()).where((u) => u.isActive).toList();
    final allowed = limit - 1; // the owner takes one seat implicitly.
    if (allowed < 0 || active.length <= allowed) return;

    for (final user in active.take(active.length - allowed)) {
      await _dao.update(user.copyWith(isActive: false));
      await SecurityAuditRepository.instance.record(
        eventType: SecurityAuditType.userDeactivated,
        description: '${user.name} (${user.mobileNumber}) deactivated - '
            'the subscription no longer covers this many team members.',
        entityType: 'user',
        entityId: user.id,
      );
    }
    PermissionService.invalidateCache();
  }

  Future<UserModel?> getByMobileNumber(String mobileNumber) async {
    return _dao.getByMobileNumber(mobileNumber);
  }

  /// The user record for the currently signed-in mobile number, if one
  /// exists - see PermissionService for what happens when it doesn't
  /// (the backward-compatible Company-Admin default for an existing
  /// single-user install).
  Future<UserModel?> getCurrentUser(String? mobileNumber) async {
    if (mobileNumber == null || mobileNumber.isEmpty) return null;

    return _dao.getByMobileNumber(mobileNumber);
  }

  Future<UserModel> createUser({
    required String name,
    required String mobileNumber,
    required String roleId,
  }) async {
    await PermissionService.requirePermission(Permission.usersCreate);

    final state = await SubscriptionAccessService.instance.currentState();
    final limit = state == null
        ? 1
        : state.isActive
            ? state.settings.teamUserLimitPaid
            : state.settings.teamUserLimitFree;
    if (await activeTeamSize() >= limit) {
      throw TeamLimitExceededException(
        limit,
        isSubscribed: state?.isActive ?? false,
      );
    }

    final user = UserModel(
      id: IdGenerator.generateId(),
      name: name,
      mobileNumber: mobileNumber,
      roleId: roleId,
      isActive: true,
      createdAt: DateTime.now().toIso8601String(),
    );

    await _dao.insert(user);

    return user;
  }

  Future<void> update(UserModel user) async {
    await PermissionService.requirePermission(Permission.usersEdit);

    await _dao.update(user);
  }

  Future<void> setActive(UserModel user, bool isActive) async {
    await PermissionService.requirePermission(Permission.usersDeactivate);

    await _dao.update(user.copyWith(isActive: isActive));

    await SecurityAuditRepository.instance.record(
      eventType: isActive
          ? SecurityAuditType.userActivated
          : SecurityAuditType.userDeactivated,
      description: '${user.name} (${user.mobileNumber}) '
          '${isActive ? 'activated' : 'deactivated'}.',
      entityType: 'user',
      entityId: user.id,
    );

    // A deactivated user's currently-cached permission grants (if they
    // are the signed-in session right now) must not keep working until
    // their next app restart - invalidate immediately.
    PermissionService.invalidateCache();
  }

  Future<void> assignRole(UserModel user, RoleModel role) async {
    await PermissionService.requirePermission(
      Permission.usersManagePermissions,
    );

    await _dao.update(user.copyWith(roleId: role.id));

    await SecurityAuditRepository.instance.record(
      eventType: SecurityAuditType.roleChanged,
      description: '${user.name} (${user.mobileNumber}) role changed to '
          '${role.name}.',
      entityType: 'user',
      entityId: user.id,
    );

    PermissionService.invalidateCache();
  }
}
