/// One (roleId, permission) grant - a role's full permission set is the
/// collection of these rows for that role, not a fixed field on
/// RoleModel. This is what makes "manage custom roles" and "manage
/// permissions" (Users/Roles category) actually work: granting/
/// revoking a permission is inserting/deleting one row, not editing a
/// hardcoded switch statement.
class RolePermissionModel {
  final String id;
  final String roleId;
  final String permissionCode;

  const RolePermissionModel({
    required this.id,
    required this.roleId,
    required this.permissionCode,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'role_id': roleId,
      'permission_code': permissionCode,
    };
  }

  factory RolePermissionModel.fromMap(Map<String, dynamic> map) {
    return RolePermissionModel(
      id: map['id'] as String,
      roleId: map['role_id'] as String,
      permissionCode: map['permission_code'] as String,
    );
  }
}
