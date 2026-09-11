import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../models/role_model.dart';
import '../models/role_permission_model.dart';

class RoleDao {
  RoleDao._();

  static final RoleDao instance = RoleDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  Future<List<RoleModel>> getAll({bool activeOnly = true}) async {
    final data = await _db.queryScoped(
      DatabaseConstants.roleTable,
      orderBy: 'sort_order ASC',
    );

    final roles = data.map((e) => RoleModel.fromMap(e)).toList();

    if (!activeOnly) return roles;

    return roles.where((r) => r.isActive).toList();
  }

  Future<void> insert(RoleModel role) async {
    await _db.insertScoped(DatabaseConstants.roleTable, role.toMap());
  }

  Future<void> update(RoleModel role) async {
    await _db.updateScoped(DatabaseConstants.roleTable, role.toMap(), role.id);
  }

  Future<List<RolePermissionModel>> getPermissionsForRole(
    String roleId,
  ) async {
    final data = await _db.queryScoped(
      DatabaseConstants.rolePermissionTable,
      where: 'role_id = ?',
      whereArgs: [roleId],
    );

    return data.map((e) => RolePermissionModel.fromMap(e)).toList();
  }

  /// All grants for the company in one query - used by
  /// PermissionService to build its in-memory lookup once rather than
  /// querying per-role.
  Future<List<RolePermissionModel>> getAllPermissionGrants() async {
    final data = await _db.queryScoped(DatabaseConstants.rolePermissionTable);

    return data.map((e) => RolePermissionModel.fromMap(e)).toList();
  }

  Future<void> grantPermission(RolePermissionModel grant) async {
    await _db.insertScoped(
      DatabaseConstants.rolePermissionTable,
      grant.toMap(),
    );
  }

  Future<void> revokePermission(String roleId, String permissionCode) async {
    await _db.deleteWhereScoped(
      DatabaseConstants.rolePermissionTable,
      'role_id = ? AND permission_code = ?',
      [roleId, permissionCode],
    );
  }
}
