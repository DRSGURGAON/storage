import '../../billing/models/bill_model.dart';
import '../../billing/models/payment_model.dart';
import '../../billing/repositories/billing_repository.dart';
import '../../customers/models/customer_model.dart';
import '../../customers/repositories/customer_repository.dart';
import '../../quotation/models/quotation_model.dart';
import '../../quotation/repositories/quotation_repository.dart';
import '../../storage_booking/models/storage_booking_model.dart';
import '../../storage_booking/repositories/storage_booking_repository.dart';

/// Pure aggregation over data every screen already reads from the
/// existing, already-tenant-scoped repositories - no new storage, no
/// duplicated business calculation. Every number here is a direct
/// count, filter or sum over a repository's own result.
class DashboardStats {
  final List<CustomerModel> customers;
  final List<StorageBookingModel> bookings;
  final List<BillModel> bills;
  final List<PaymentModel> payments;
  final List<QuotationModel> quotations;

  const DashboardStats({
    required this.customers,
    required this.bookings,
    required this.bills,
    required this.payments,
    required this.quotations,
  });

  static bool _isToday(String iso) {
    final date = DateTime.tryParse(iso);
    if (date == null) return false;
    final now = DateTime.now();
    return date.year == now.year && date.month == now.month && date.day == now.day;
  }

  // ==========================
  // Today
  // ==========================

  int get newStorageToday => bookings.where((b) => _isToday(b.bookingDate)).length;

  int get quotationsToday => quotations.where((q) => _isToday(q.quotationDate)).length;

  double get collectedToday => payments
      .where((p) => _isToday(p.paymentDate))
      .fold(0.0, (sum, p) => sum + p.amount);

  // ==========================
  // Customers and storage
  // ==========================

  int get activeCustomers => customers.where((c) => c.isActive).length;

  /// Customers who have goods with us right now.
  int get customersStoring => bookings
      .where((b) => b.status.isOpen)
      .map((b) => b.customerId.isEmpty ? b.id : b.customerId)
      .toSet()
      .length;

  int get activeStorage => bookings.where((b) => b.status.isOpen).length;

  /// Items or boxes still inside the godown.
  double get itemsInStorage => bookings
      .where((b) => b.status.isOpen)
      .fold(0.0, (sum, b) => sum + (b.items.isEmpty
          ? b.totalPackages.toDouble()
          : b.remainingQuantity));

  // ==========================
  // Money
  // ==========================

  List<BillModel> get unpaidBills =>
      bills.where((b) => b.balanceDue > 0.004).toList();

  double get totalOutstanding =>
      unpaidBills.fold(0.0, (sum, b) => sum + b.balanceDue);

  List<BillModel> get overdueBills =>
      bills.where((b) => b.derivedStatus == BillStatus.overdue).toList();

  double get collectedThisMonth {
    final now = DateTime.now();
    return payments.where((p) {
      final date = DateTime.tryParse(p.paymentDate);
      return date != null && date.year == now.year && date.month == now.month;
    }).fold(0.0, (sum, p) => sum + p.amount);
  }

  // ==========================
  // Needs attention
  // ==========================

  /// Storage where rent has never been billed, or was last billed more
  /// than a month ago - the ones worth billing now.
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

  /// Storage whose expected end date has passed but whose goods are
  /// still with us - worth a call.
  List<StorageBookingModel> get pastExpectedEnd {
    final now = DateTime.now();
    return bookings.where((b) {
      if (!b.status.isOpen) return false;
      final end = DateTime.tryParse(b.expectedEndDate);
      return end != null && end.isBefore(now);
    }).toList();
  }

  /// Quotations sent and not yet answered.
  List<QuotationModel> get quotationsAwaitingReply =>
      quotations.where((q) => q.status == QuotationStatus.sent).toList();
}

class DashboardStatsService {
  DashboardStatsService._();

  /// Gathers everything the Dashboard needs in one call - each source
  /// list comes from its own existing, already-tenant-scoped
  /// repository, unchanged.
  static Future<DashboardStats> load() async {
    final customers = await CustomerRepository.instance.getAll();
    final bookings = await StorageBookingRepository.instance.getAll();
    final bills = await BillingRepository.instance.getAllBills();
    final payments = await BillingRepository.instance.getAllPayments();
    final quotations = await QuotationRepository.instance.getAll();

    return DashboardStats(
      customers: customers,
      bookings: bookings,
      bills: bills,
      payments: payments,
      quotations: quotations,
    );
  }
}
