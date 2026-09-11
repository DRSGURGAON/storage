import '../../../core/permissions/permission.dart';
import '../../../core/permissions/permission_service.dart';
import '../../../core/utils/id_generator.dart';
import '../../audit/repositories/security_audit_repository.dart';
import '../data/role_dao.dart';
import '../models/role_model.dart';
import '../models/role_permission_model.dart';

class RoleRepository {
  RoleRepository._();

  static final RoleRepository instance = RoleRepository._();

  final RoleDao _dao = RoleDao.instance;

  Future<List<RoleModel>> getAll({bool activeOnly = true}) async {
    return _dao.getAll(activeOnly: activeOnly);
  }

  Future<List<RolePermissionModel>> getAllPermissionGrants() async {
    return _dao.getAllPermissionGrants();
  }

  Future<List<Permission>> getPermissionsForRole(String roleId) async {
    final grants = await _dao.getPermissionsForRole(roleId);

    return grants
        .map((g) => Permission.fromCode(g.permissionCode))
        .whereType<Permission>()
        .toList();
  }

  /// Creates a custom role (Section: "manage custom roles if
  /// architecture supports it") - a plain insert, since RoleModel is
  /// data-driven, not a fixed enum. isSystem is always false here: the 6
  /// default roles are seeded once at install/upgrade time
  /// (_seedDefaultRoles), never created through this path.
  Future<RoleModel> createCustomRole({
    required String name,
    required int sortOrder,
  }) async {
    await PermissionService.requirePermission(
      Permission.usersManagePermissions,
    );

    final role = RoleModel(
      id: IdGenerator.generateId(),
      code: 'ROLE_${IdGenerator.generateId().substring(0, 8).toUpperCase()}',
      name: name,
      isSystem: false,
      isActive: true,
      sortOrder: sortOrder,
    );

    await _dao.insert(role);

    return role;
  }

  Future<void> update(RoleModel role) async {
    await PermissionService.requirePermission(
      Permission.usersManagePermissions,
    );

    await _dao.update(role);
  }

  Future<void> grantPermission(String roleId, Permission permission) async {
    await PermissionService.requirePermission(
      Permission.usersManagePermissions,
    );

    await _dao.grantPermission(
      RolePermissionModel(
        id: IdGenerator.generateId(),
        roleId: roleId,
        permissionCode: permission.code,
      ),
    );

    await SecurityAuditRepository.instance.record(
      eventType: SecurityAuditType.permissionChanged,
      description: '${permission.code} granted to role $roleId.',
      entityType: 'role',
      entityId: roleId,
    );

    PermissionService.invalidateCache();
  }

  Future<void> revokePermission(String roleId, Permission permission) async {
    await PermissionService.requirePermission(
      Permission.usersManagePermissions,
    );

    await _dao.revokePermission(roleId, permission.code);

    await SecurityAuditRepository.instance.record(
      eventType: SecurityAuditType.permissionChanged,
      description: '${permission.code} revoked from role $roleId.',
      entityType: 'role',
      entityId: roleId,
    );

    PermissionService.invalidateCache();
  }
}
