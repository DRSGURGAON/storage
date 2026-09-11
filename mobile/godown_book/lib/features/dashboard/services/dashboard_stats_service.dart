import '../../customers/models/customer_model.dart';
import '../../customers/repositories/customer_repository.dart';

/// Pure aggregation over data every screen already reads from the
/// existing, already-tenant-scoped repositories - no new storage, no
/// duplicated business calculation. Every number here is a direct
/// count/filter over a repository's getAll() result.
class DashboardStats {
  final List<CustomerModel> customers;

  const DashboardStats({required this.customers});

  int get activeCustomers => customers.where((c) => c.isActive).length;
}

class DashboardStatsService {
  DashboardStatsService._();

  /// Gathers everything the Dashboard needs in one call - each source
  /// list comes from its own existing, already-tenant-scoped
  /// repository's getAll(), unchanged.
  static Future<DashboardStats> load() async {
    final customers = await CustomerRepository.instance.getAll();

    return DashboardStats(customers: customers);
  }
}
