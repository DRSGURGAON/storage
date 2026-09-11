import '../../../core/permissions/permission.dart';
import '../../../core/permissions/permission_service.dart';
import '../../../core/utils/id_generator.dart';
import '../../audit/repositories/security_audit_repository.dart';
import '../data/user_dao.dart';
import '../models/role_model.dart';
import '../models/user_model.dart';

class UserRepository {
  UserRepository._();

  static final UserRepository instance = UserRepository._();

  final UserDao _dao = UserDao.instance;

  Future<List<UserModel>> getAll() async {
    return _dao.getAll();
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
