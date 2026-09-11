import 'package:sqflite/sqflite.dart';

import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../../../core/tenant/tenant_scope.dart';
import '../models/quotation_model.dart';

class QuotationDao {
  QuotationDao._();

  static final QuotationDao instance = QuotationDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  Future<List<QuotationModel>> getAll() async {
    final rows = await _db.queryScoped(
      DatabaseConstants.quotationTable,
      orderBy: 'quotation_date DESC, created_at DESC',
    );
    if (rows.isEmpty) return const [];

    final lineRows = await _db.queryScoped(
      DatabaseConstants.quotationLineTable,
      orderBy: 'sort_order ASC',
    );

    final linesByQuotation = <String, List<QuotationLineModel>>{};
    for (final row in lineRows) {
      final line = QuotationLineModel.fromMap(row);
      linesByQuotation.putIfAbsent(line.quotationId, () => []).add(line);
    }

    return [
      for (final row in rows)
        QuotationModel.fromMap(
          row,
          lines: linesByQuotation[row['id'] as String] ?? const [],
        ),
    ];
  }

  Future<QuotationModel?> getById(String id) async {
    final rows = await _db.queryScoped(
      DatabaseConstants.quotationTable,
      where: 'id = ?',
      whereArgs: [id],
      limit: 1,
    );
    if (rows.isEmpty) return null;

    final lineRows = await _db.queryScoped(
      DatabaseConstants.quotationLineTable,
      where: 'quotation_id = ?',
      whereArgs: [id],
      orderBy: 'sort_order ASC',
    );

    return QuotationModel.fromMap(
      rows.first,
      lines: lineRows.map(QuotationLineModel.fromMap).toList(),
    );
  }

  /// Writes the quotation row and replaces its lines inside [txn] - the
  /// caller owns the transaction so numbering and lines commit together.
  Future<void> writeWithLines(
    DatabaseExecutor txn,
    QuotationModel quotation, {
    required bool isNew,
  }) async {
    final companyId = TenantScope.companyId;

    if (isNew) {
      await txn.insert(DatabaseConstants.quotationTable, {
        ...quotation.toMap(),
        DatabaseConstants.companyIdColumn: companyId,
      });
    } else {
      await txn.update(
        DatabaseConstants.quotationTable,
        quotation.toMap(),
        where: 'id = ? AND ${DatabaseConstants.companyIdColumn} = ?',
        whereArgs: [quotation.id, companyId],
      );
      await txn.delete(
        DatabaseConstants.quotationLineTable,
        where: 'quotation_id = ? AND ${DatabaseConstants.companyIdColumn} = ?',
        whereArgs: [quotation.id, companyId],
      );
    }

    var order = 0;
    for (final line in quotation.lines) {
      await txn.insert(DatabaseConstants.quotationLineTable, {
        ...line.copyWith(quotationId: quotation.id, sortOrder: order).toMap(),
        DatabaseConstants.companyIdColumn: companyId,
      });
      order += 10;
    }
  }

  Future<void> updateRow(QuotationModel quotation) async {
    await _db.updateScoped(
      DatabaseConstants.quotationTable,
      quotation.toMap(),
      quotation.id,
    );
  }

  Future<void> delete(String id) async {
    await _db.deleteWhereScoped(
      DatabaseConstants.quotationLineTable,
      'quotation_id = ?',
      [id],
    );
    await _db.deleteScoped(DatabaseConstants.quotationTable, id);
  }
}
