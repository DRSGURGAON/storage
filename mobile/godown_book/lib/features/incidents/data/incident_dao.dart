import 'package:sqflite/sqflite.dart';

import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../../../core/tenant/tenant_scope.dart';
import '../models/incident_model.dart';

class IncidentDao {
  IncidentDao._();

  static final IncidentDao instance = IncidentDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  Future<List<IncidentModel>> getAll() async {
    final rows = await _db.queryScoped(
      DatabaseConstants.incidentTable,
      orderBy: 'report_date DESC, created_at DESC',
    );
    return rows.map(IncidentModel.fromMap).toList();
  }

  Future<IncidentModel?> getById(String id) async {
    final rows = await _db.queryScoped(
      DatabaseConstants.incidentTable,
      where: 'id = ?',
      whereArgs: [id],
      limit: 1,
    );
    return rows.isEmpty ? null : IncidentModel.fromMap(rows.first);
  }

  Future<List<IncidentModel>> getForBooking(String bookingId) async {
    final rows = await _db.queryScoped(
      DatabaseConstants.incidentTable,
      where: 'booking_id = ?',
      whereArgs: [bookingId],
      orderBy: 'report_date DESC',
    );
    return rows.map(IncidentModel.fromMap).toList();
  }

  Future<void> insert(DatabaseExecutor txn, IncidentModel incident) async {
    await txn.insert(DatabaseConstants.incidentTable, {
      ...incident.toMap(),
      DatabaseConstants.companyIdColumn: TenantScope.companyId,
    });
  }

  Future<void> update(IncidentModel incident) => _db.updateScoped(
        DatabaseConstants.incidentTable,
        incident.toMap(),
        incident.id,
      );

  Future<void> delete(String id) =>
      _db.deleteScoped(DatabaseConstants.incidentTable, id);
}
