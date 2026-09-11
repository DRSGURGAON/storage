import 'package:sqflite/sqflite.dart';

import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../../../core/tenant/tenant_scope.dart';
import '../models/consignment_model.dart';

class ConsignmentDao {
  ConsignmentDao._();

  static final ConsignmentDao instance = ConsignmentDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  Future<List<ConsignmentModel>> getAll() async {
    final rows = await _db.queryScoped(
      DatabaseConstants.consignmentTable,
      orderBy: 'lr_date DESC, created_at DESC',
    );
    if (rows.isEmpty) return const [];

    final itemRows = await _db.queryScoped(
      DatabaseConstants.consignmentItemTable,
      orderBy: 'sort_order ASC',
    );

    final itemsByConsignment = <String, List<ConsignmentItemModel>>{};
    for (final row in itemRows) {
      final item = ConsignmentItemModel.fromMap(row);
      itemsByConsignment.putIfAbsent(item.consignmentId, () => []).add(item);
    }

    return [
      for (final row in rows)
        ConsignmentModel.fromMap(
          row,
          items: itemsByConsignment[row['id'] as String] ?? const [],
        ),
    ];
  }

  Future<ConsignmentModel?> getById(String id) async {
    final rows = await _db.queryScoped(
      DatabaseConstants.consignmentTable,
      where: 'id = ?',
      whereArgs: [id],
      limit: 1,
    );
    if (rows.isEmpty) return null;

    final itemRows = await _db.queryScoped(
      DatabaseConstants.consignmentItemTable,
      where: 'consignment_id = ?',
      whereArgs: [id],
      orderBy: 'sort_order ASC',
    );

    return ConsignmentModel.fromMap(
      rows.first,
      items: itemRows.map(ConsignmentItemModel.fromMap).toList(),
    );
  }

  Future<List<ConsignmentModel>> getForBooking(String bookingId) async {
    final all = await getAll();
    return all.where((c) => c.bookingId == bookingId).toList();
  }

  /// Writes the consignment and replaces its item lines, inside the
  /// caller's transaction.
  Future<void> writeWithItems(
    DatabaseExecutor txn,
    ConsignmentModel consignment, {
    bool replaceExisting = false,
  }) async {
    final companyId = TenantScope.companyId;

    if (replaceExisting) {
      await txn.update(
        DatabaseConstants.consignmentTable,
        {
          ...consignment.toMap(),
          DatabaseConstants.companyIdColumn: companyId,
        },
        where: 'id = ? AND ${DatabaseConstants.companyIdColumn} = ?',
        whereArgs: [consignment.id, companyId],
      );
      await txn.delete(
        DatabaseConstants.consignmentItemTable,
        where: 'consignment_id = ? AND ${DatabaseConstants.companyIdColumn} = ?',
        whereArgs: [consignment.id, companyId],
      );
    } else {
      await txn.insert(DatabaseConstants.consignmentTable, {
        ...consignment.toMap(),
        DatabaseConstants.companyIdColumn: companyId,
      });
    }

    var order = 0;
    for (final item in consignment.items) {
      await txn.insert(DatabaseConstants.consignmentItemTable, {
        ...item
            .copyWith(consignmentId: consignment.id, sortOrder: order)
            .toMap(),
        DatabaseConstants.companyIdColumn: companyId,
      });
      order += 10;
    }
  }

  Future<void> update(ConsignmentModel consignment) => _db.updateScoped(
        DatabaseConstants.consignmentTable,
        consignment.toMap(),
        consignment.id,
      );

  Future<void> delete(String id) async {
    await _db.deleteWhereScoped(
      DatabaseConstants.consignmentItemTable,
      'consignment_id = ?',
      [id],
    );
    await _db.deleteScoped(DatabaseConstants.consignmentTable, id);
  }
}
