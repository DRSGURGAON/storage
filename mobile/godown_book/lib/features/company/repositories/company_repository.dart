import '../data/company_dao.dart';
import '../models/company_model.dart';

class CompanyRepository {
  CompanyRepository._();

  static final CompanyRepository instance = CompanyRepository._();

  final CompanyDao _dao = CompanyDao.instance;

  // ==========================
  // GET COMPANY
  // ==========================

  Future<CompanyModel?> getCompany() {
    return _dao.getCompany();
  }

  // ==========================
  // SAVE COMPANY
  // ==========================

  Future<void> saveCompany(CompanyModel company) {
    return _dao.saveCompany(company);
  }

  // ==========================
  // CLEAR COMPANY
  // ==========================

  Future<void> clearCompany() {
    return _dao.clearCompany();
  }
}
