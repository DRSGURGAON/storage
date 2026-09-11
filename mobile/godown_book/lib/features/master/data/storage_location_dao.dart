import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../models/storage_location_model.dart';

class StorageLocationDao {
  StorageLocationDao._();

  static final StorageLocationDao instance = StorageLocationDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  Future<void> insert(StorageLocationModel location) async {
    await _db.insertScoped(
      DatabaseConstants.storageLocationTable,
      location.toMap(),
    );
  }

  Future<List<StorageLocationModel>> getAll({bool activeOnly = true}) async {
    final rows = await _db.queryScoped(
      DatabaseConstants.storageLocationTable,
      orderBy: 'sort_order ASC, name COLLATE NOCASE ASC',
    );

    final all = rows.map(StorageLocationModel.fromMap).toList();
    return activeOnly ? all.where((e) => e.isActive).toList() : all;
  }

  Future<void> update(StorageLocationModel location) async {
    await _db.updateScoped(
      DatabaseConstants.storageLocationTable,
      location.toMap(),
      location.id,
    );
  }

  /// Soft delete - bookings already saved still name this location.
  Future<void> delete(String id) async {
    await _db.updateWhereScoped(
      DatabaseConstants.storageLocationTable,
      {'is_active': 0},
      'id = ?',
      [id],
    );
  }
}
