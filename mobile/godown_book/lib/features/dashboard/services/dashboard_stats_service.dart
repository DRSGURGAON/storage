import '../../customers/models/customer_model.dart';
import '../../customers/repositories/customer_repository.dart';
import '../../storage_booking/models/storage_booking_model.dart';
import '../../storage_booking/models/storage_status.dart';
import '../../storage_booking/repositories/storage_booking_repository.dart';

/// Pure aggregation over data every screen already reads from the
/// existing, already-tenant-scoped repositories - no new storage, no
/// duplicated business calculation. Every number here is a direct
/// count/filter over a repository's getAll() result.
class DashboardStats {
  final List<CustomerModel> customers;
  final List<StorageBookingModel> bookings;

  const DashboardStats({required this.customers, required this.bookings});

  bool _isToday(String iso) {
    final d = DateTime.tryParse(iso);
    if (d == null) return false;
    final now = DateTime.now();
    return d.year == now.year && d.month == now.month && d.day == now.day;
  }

  int get activeCustomers => customers.where((c) => c.isActive).length;

  int get totalBookings => bookings.length;
  int get inStorage => bookings.where((b) => b.status.isOpen).length;
  int get partlyReleased =>
      bookings.where((b) => b.status == StorageStatus.partiallyReleased).length;
  int get releasedCount =>
      bookings.where((b) => b.status == StorageStatus.released).length;
  int get receiptsToday => bookings.where((b) => _isToday(b.bookingDate)).length;

  /// Units (packages) still inside the godown across open receipts.
  double get unitsInStock => bookings
      .where((b) => b.status.isOpen)
      .fold(0.0, (sum, b) => sum + (b.items.isEmpty ? b.totalPackages.toDouble() : b.remainingQuantity));

  /// Open receipts whose rent has never been billed, or was last billed
  /// more than a month ago - the ones worth billing now.
  List<StorageBookingModel> get rentDue {
    final cutoff = DateTime.now().subtract(const Duration(days: 30));
    return bookings.where((b) {
      if (!b.status.isOpen || b.rentRate <= 0) return false;
      final upto = DateTime.tryParse(b.rentBilledUpto);
      if (upto == null) {
        final start = DateTime.tryParse(b.storageStartDate);
        return start != null && start.isBefore(DateTime.now());
      }
      return upto.isBefore(cutoff);
    }).toList();
  }
}

class DashboardStatsService {
  DashboardStatsService._();

  /// Gathers everything the Dashboard needs in one call - each source
  /// list comes from its own existing, already-tenant-scoped
  /// repository's getAll(), unchanged.
  static Future<DashboardStats> load() async {
    final customers = await CustomerRepository.instance.getAll();
    final bookings = await StorageBookingRepository.instance.getAll();

    return DashboardStats(customers: customers, bookings: bookings);
  }
}
