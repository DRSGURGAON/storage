import 'package:sqflite/sqflite.dart';

import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../../../core/tenant/tenant_scope.dart';
import '../models/goods_release_model.dart';

class GoodsReleaseDao {
  GoodsReleaseDao._();

  static final GoodsReleaseDao instance = GoodsReleaseDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  Future<List<GoodsReleaseModel>> getAll() async {
    final rows = await _db.queryScoped(
      DatabaseConstants.goodsReleaseTable,
      orderBy: 'release_date DESC, created_at DESC',
    );
    if (rows.isEmpty) return const [];

    final itemRows = await _db.queryScoped(
      DatabaseConstants.releaseItemTable,
      orderBy: 'sort_order ASC',
    );

    final itemsByRelease = <String, List<ReleaseItemModel>>{};
    for (final row in itemRows) {
      final item = ReleaseItemModel.fromMap(row);
      itemsByRelease.putIfAbsent(item.releaseId, () => []).add(item);
    }

    return [
      for (final row in rows)
        GoodsReleaseModel.fromMap(
          row,
          items: itemsByRelease[row['id'] as String] ?? const [],
        ),
    ];
  }

  Future<GoodsReleaseModel?> getById(String id) async {
    final rows = await _db.queryScoped(
      DatabaseConstants.goodsReleaseTable,
      where: 'id = ?',
      whereArgs: [id],
      limit: 1,
    );
    if (rows.isEmpty) return null;

    final itemRows = await _db.queryScoped(
      DatabaseConstants.releaseItemTable,
      where: 'release_id = ?',
      whereArgs: [id],
      orderBy: 'sort_order ASC',
    );

    return GoodsReleaseModel.fromMap(
      rows.first,
      items: itemRows.map(ReleaseItemModel.fromMap).toList(),
    );
  }

  Future<void> writeWithItems(
    DatabaseExecutor txn,
    GoodsReleaseModel release,
  ) async {
    final companyId = TenantScope.companyId;

    await txn.insert(DatabaseConstants.goodsReleaseTable, {
      ...release.toMap(),
      DatabaseConstants.companyIdColumn: companyId,
    });

    var order = 0;
    for (final item in release.items) {
      await txn.insert(DatabaseConstants.releaseItemTable, {
        ...item.copyWith(releaseId: release.id, sortOrder: order).toMap(),
        DatabaseConstants.companyIdColumn: companyId,
      });
      order += 10;
    }
  }

  Future<void> delete(String id) async {
    await _db.deleteWhereScoped(
      DatabaseConstants.releaseItemTable,
      'release_id = ?',
      [id],
    );
    await _db.deleteScoped(DatabaseConstants.goodsReleaseTable, id);
  }
}
