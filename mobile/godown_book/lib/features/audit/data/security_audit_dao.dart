import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../models/security_audit_model.dart';

class SecurityAuditDao {
  SecurityAuditDao._();

  static final SecurityAuditDao instance = SecurityAuditDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  Future<void> insert(SecurityAuditModel event) async {
    await _db.insertScoped(DatabaseConstants.securityAuditTable, event.toMap());
  }

  Future<List<SecurityAuditModel>> getAll({int limit = 100}) async {
    final data = await _db.queryScoped(
      DatabaseConstants.securityAuditTable,
      orderBy: 'created_at DESC',
      limit: limit,
    );

    return data.map((e) => SecurityAuditModel.fromMap(e)).toList();
  }
}
