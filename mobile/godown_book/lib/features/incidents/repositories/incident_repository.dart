import 'package:sqflite/sqflite.dart';

import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../../../core/tenant/tenant_scope.dart';
import '../../../core/utils/financial_year.dart';
import '../../../core/utils/id_generator.dart';
import '../data/incident_dao.dart';
import '../models/incident_model.dart';

/// Damage and loss reports. A report can be edited - the operator often
/// learns more the next day - but it keeps its number and its date, so
/// the trail stays honest.
class IncidentRepository {
  IncidentRepository._();

  static final IncidentRepository instance = IncidentRepository._();

  final DatabaseHelper _db = DatabaseHelper.instance;
  final IncidentDao _dao = IncidentDao.instance;

  /// Reports are numbered `DR/<FY>/0001` and up.
  static const String prefix = 'DR';

  Future<List<IncidentModel>> getAll() => _dao.getAll();

  Future<IncidentModel?> getById(String id) => _dao.getById(id);

  Future<List<IncidentModel>> getForBooking(String bookingId) =>
      _dao.getForBooking(bookingId);

  Future<int> _maxSerialInFinancialYear(
    DatabaseExecutor executor,
    int fyStart,
  ) async {
    final rows = await executor.query(
      DatabaseConstants.incidentTable,
      columns: ['report_no'],
      where: 'company_id = ? AND report_no LIKE ?',
      whereArgs: [TenantScope.companyId, '%/$fyStart/%'],
    );

    var maxNumber = 0;
    for (final row in rows) {
      final no = row['report_no'] as String? ?? '';
      final match = RegExp(r'(\d+)$').firstMatch(no);
      final number = match != null ? int.tryParse(match.group(1)!) ?? 0 : 0;
      if (number > maxNumber) maxNumber = number;
    }
    return maxNumber;
  }

  Future<IncidentModel> save(IncidentModel incident) async {
    final now = DateTime.now();
    final nowIso = now.toIso8601String();

    // An existing report is updated in place, number and all.
    if (incident.id.isNotEmpty && await _dao.getById(incident.id) != null) {
      await _dao.update(incident);
      return incident;
    }

    const maxAttempts = 5;
    final fyStart = FinancialYear.startYear(now);
    var idToUse = incident.id.isEmpty ? IdGenerator.generateId() : incident.id;

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await _db.transaction((txn) async {
          final serial = await _maxSerialInFinancialYear(txn, fyStart) + attempt;
          final reportNo =
              '$prefix/${FinancialYear.documentNumber(date: now, serial: serial)}';

          final withNumber = incident.copyWith(
            id: idToUse,
            reportNo: reportNo,
            createdAt: incident.createdAt.isEmpty ? nowIso : incident.createdAt,
          );

          await _dao.insert(txn, withNumber);
          return withNumber;
        });
      } on DatabaseException catch (error) {
        final message = error.toString();
        final isUnique = message.contains('UNIQUE constraint failed');
        if (isUnique && message.contains('incidents.id') && attempt < maxAttempts) {
          idToUse = IdGenerator.generateId();
          continue;
        }
        if (attempt == maxAttempts) rethrow;
      }
    }

    throw StateError('Could not allocate a report number.');
  }

  Future<void> delete(String id) => _dao.delete(id);
}
