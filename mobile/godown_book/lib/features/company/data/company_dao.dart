import '../../../core/database/database_helper.dart';
import '../models/company_model.dart';

class CompanyDao {
  CompanyDao._();

  static final CompanyDao instance = CompanyDao._();

  static const String table = 'company_settings';

  final DatabaseHelper _db = DatabaseHelper.instance;

  // ==========================
  // GET COMPANY
  // ==========================

  Future<CompanyModel?> getCompany() async {
    final result = await _db.query(table);

    if (result.isEmpty) {
      return null;
    }

    return CompanyModel.fromMap(result.first);
  }

  // ==========================
  // SAVE COMPANY
  // ==========================

  Future<void> saveCompany(CompanyModel company) async {
    final existing = await getCompany();

    final data = company.toMap();

    // Always keep a single company record
    data['id'] = 1;

    if (existing == null) {
      await _db.insert(table, data);
    } else {
      await _db.update(table, data, '1');
    }
  }

  // ==========================
  // DELETE COMPANY
  // ==========================

  Future<void> clearCompany() async {
    await _db.clearTable(table);
  }
}
