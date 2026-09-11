import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../controllers/company_controller.dart';
import '../models/company_model.dart';

final companyProvider = FutureProvider<CompanyModel?>((ref) async {
  return CompanyController.instance.getCompany();
});
