import '../../../core/utils/id_generator.dart';
import '../data/storage_location_dao.dart';
import '../models/storage_location_model.dart';

class StorageLocationRepository {
  StorageLocationRepository._();

  static final StorageLocationRepository instance =
      StorageLocationRepository._();

  final StorageLocationDao _dao = StorageLocationDao.instance;

  Future<List<StorageLocationModel>> getAll({bool activeOnly = true}) =>
      _dao.getAll(activeOnly: activeOnly);

  Future<StorageLocationModel> create({
    required String name,
    String code = '',
    String description = '',
  }) async {
    final all = await _dao.getAll(activeOnly: false);

    var maxNumber = 0;
    var maxSort = 0;
    for (final l in all) {
      final match = RegExp(r'(\d+)$').firstMatch(l.code);
      final n = match != null ? int.tryParse(match.group(1)!) ?? 0 : 0;
      if (n > maxNumber) maxNumber = n;
      if (l.sortOrder > maxSort) maxSort = l.sortOrder;
    }

    final row = StorageLocationModel(
      id: IdGenerator.generateId(),
      code: code.trim().isEmpty
          ? 'LOC${(maxNumber + 1).toString().padLeft(3, '0')}'
          : code.trim().toUpperCase(),
      name: name.trim(),
      description: description.trim(),
      sortOrder: maxSort + 10,
    );

    await _dao.insert(row);
    return row;
  }

  Future<void> update(StorageLocationModel location) => _dao.update(location);

  Future<void> delete(String id) => _dao.delete(id);
}
