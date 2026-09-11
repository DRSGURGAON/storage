import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../models/customer_model.dart';

class CustomerDao {
  CustomerDao._();

  static final CustomerDao instance = CustomerDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  Future<void> insert(CustomerModel customer) async {
    await _db.insertScoped(DatabaseConstants.customerTable, customer.toMap());
  }

  Future<List<CustomerModel>> getAll() async {
    final rows = await _db.queryScoped(
      DatabaseConstants.customerTable,
      orderBy: 'customer_name COLLATE NOCASE ASC',
    );

    return rows.map(CustomerModel.fromMap).toList();
  }

  Future<CustomerModel?> getById(String id) async {
    final rows = await _db.queryScoped(
      DatabaseConstants.customerTable,
      where: 'id = ?',
      whereArgs: [id],
      limit: 1,
    );

    if (rows.isEmpty) return null;
    return CustomerModel.fromMap(rows.first);
  }

  Future<void> update(CustomerModel customer) async {
    await _db.updateScoped(
      DatabaseConstants.customerTable,
      customer.toMap(),
      customer.id,
    );
  }

  Future<void> delete(String id) async {
    await _db.deleteScoped(DatabaseConstants.customerTable, id);
  }
}
