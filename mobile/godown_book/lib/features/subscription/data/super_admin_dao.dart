import '../../../core/database/database_helper.dart';
import '../models/super_admin_model.dart';

class SuperAdminDao {
  SuperAdminDao._();

  static final SuperAdminDao instance = SuperAdminDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  Future<SuperAdminModel?> getByMobileNumber(String mobileNumber) async {
    final db = await _db.database;

    final data = await db.query(
      'super_admins',
      where: 'mobile_number = ?',
      whereArgs: [mobileNumber],
    );

    if (data.isEmpty) return null;

    return SuperAdminModel.fromMap(data.first);
  }

  Future<List<SuperAdminModel>> getAll() async {
    final db = await _db.database;

    final data = await db.query('super_admins', orderBy: 'created_at DESC');

    return data.map((e) => SuperAdminModel.fromMap(e)).toList();
  }

  Future<void> insert(SuperAdminModel admin) async {
    final db = await _db.database;

    await db.insert('super_admins', admin.toMap());
  }
}
