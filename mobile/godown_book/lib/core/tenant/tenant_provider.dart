import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/company/controllers/company_controller.dart';
import '../../features/company/models/company_model.dart';
import 'tenant_scope.dart';

/// Loads the company on startup and installs it into [TenantScope].
///
/// The router waits on this before letting any data screen render.
final currentCompanyProvider = FutureProvider<CompanyModel?>((ref) async {
  final company = await CompanyController.instance.getCompany();

  if (company != null && company.companyId.isNotEmpty) {
    TenantScope.set(company.companyId);
  } else {
    TenantScope.clear();
  }

  return company;
});

/// True once a company exists and carries the minimum details a printed
/// document needs.
final companyConfiguredProvider = Provider<bool>((ref) {
  final company = ref.watch(currentCompanyProvider).value;

  return company?.isConfigured ?? false;
});
