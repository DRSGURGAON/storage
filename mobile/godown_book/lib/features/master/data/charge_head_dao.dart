import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../models/charge_head_model.dart';

class ChargeHeadDao {
  ChargeHeadDao._();

  static final ChargeHeadDao instance = ChargeHeadDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  Future<void> insert(ChargeHeadModel head) async {
    await _db.insertScoped(DatabaseConstants.chargeHeadTable, head.toMap());
  }

  Future<List<ChargeHeadModel>> getAll({bool activeOnly = true}) async {
    final data = await _db.queryScoped(
      DatabaseConstants.chargeHeadTable,
      orderBy: 'sort_order ASC',
    );

    final heads = data.map((e) => ChargeHeadModel.fromMap(e)).toList();

    return activeOnly ? heads.where((e) => e.isActive).toList() : heads;
  }

  Future<void> update(ChargeHeadModel head) async {
    await _db.updateScoped(
      DatabaseConstants.chargeHeadTable,
      head.toMap(),
      head.id,
    );
  }

  /// Soft delete - bills already saved still reference this head.
  Future<void> delete(String id) async {
    await _db.updateWhereScoped(
      DatabaseConstants.chargeHeadTable,
      {'is_active': 0},
      'id = ? AND is_system = 0',
      [id],
    );
  }
}
