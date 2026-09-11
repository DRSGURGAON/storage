import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../models/user_model.dart';

class UserDao {
  UserDao._();

  static final UserDao instance = UserDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  Future<List<UserModel>> getAll() async {
    final data = await _db.queryScoped(
      DatabaseConstants.userTable,
      orderBy: 'created_at DESC',
    );

    return data.map((e) => UserModel.fromMap(e)).toList();
  }

  Future<UserModel?> getByMobileNumber(String mobileNumber) async {
    final data = await _db.queryScoped(
      DatabaseConstants.userTable,
      where: 'mobile_number = ?',
      whereArgs: [mobileNumber],
    );

    if (data.isEmpty) return null;

    return UserModel.fromMap(data.first);
  }

  Future<void> insert(UserModel user) async {
    await _db.insertScoped(DatabaseConstants.userTable, user.toMap());
  }

  Future<void> update(UserModel user) async {
    await _db.updateScoped(DatabaseConstants.userTable, user.toMap(), user.id);
  }
}
