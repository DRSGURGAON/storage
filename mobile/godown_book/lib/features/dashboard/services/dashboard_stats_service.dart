import '../../billing/models/bill_model.dart';
import '../../billing/models/payment_model.dart';
import '../../billing/repositories/billing_repository.dart';
import '../../consignment/repositories/consignment_repository.dart';
import '../../customers/models/customer_model.dart';
import '../../customers/repositories/customer_repository.dart';
import '../../master/models/storage_location_model.dart';
import '../../master/repositories/storage_location_repository.dart';
import '../../quotation/models/quotation_model.dart';
import '../../quotation/repositories/quotation_repository.dart';
import '../../release/repositories/goods_release_repository.dart';
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
  final List<StorageLocationModel> locations;

  /// Counted, not loaded in full - the dashboard's document tiles only
  /// need how many of each, not every record.
  final int consignmentCount;
  final int releaseCount;

  const DashboardStats({
    required this.customers,
    required this.bookings,
    required this.bills,
    required this.payments,
    required this.quotations,
    this.locations = const [],
    this.consignmentCount = 0,
    this.releaseCount = 0,
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

  /// Cash that actually came in today. A credit note or a deposit
  /// adjustment settles a bill without any money arriving, so neither
  /// counts here.
  double get collectedToday => payments
      .where((p) => p.paymentType.isCashIn && _isToday(p.paymentDate))
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
      if (!p.paymentType.isCashIn) return false;
      final date = DateTime.tryParse(p.paymentDate);
      return date != null && date.year == now.year && date.month == now.month;
    }).fold(0.0, (sum, p) => sum + p.amount);
  }

  /// What has come in this month against what is still owed right now
  /// - how far through collecting the current outstanding the owner
  /// is, for the progress bar on the dashboard. 1.0 when nothing is
  /// outstanding at all.
  double get monthCollectionProgress {
    final total = collectedThisMonth + totalOutstanding;
    if (total <= 0.004) return 1;
    return (collectedThisMonth / total).clamp(0, 1);
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

  // ==========================
  // The godown map
  // ==========================

  /// One entry per lot still in storage, in the colour the dashboard
  /// paints it: red when a bill on it is overdue, amber when it is
  /// waiting on a bill (unpaid, or rent not yet raised), green when it
  /// is paid up. Worst first, so what needs a call is at the top.
  List<SlotState> get slotStates {
    final overdue = overdueBills.map((b) => b.bookingId).toSet();
    final unpaid = unpaidBills.map((b) => b.bookingId).toSet();
    final waiting = rentDue.map((b) => b.id).toSet();

    final states = [
      for (final b in bookings.where((b) => b.status.isOpen))
        overdue.contains(b.id)
            ? SlotState.overdue
            : (unpaid.contains(b.id) || waiting.contains(b.id))
                ? SlotState.billDue
                : SlotState.paidUp,
    ];
    states.sort((a, b) => b.index.compareTo(a.index));

    // Whatever the locations say they hold beyond what is in them is
    // empty space - shown, so a full godown looks full.
    final free = capacity - states.length;
    if (free > 0) states.addAll(List.filled(free, SlotState.empty));
    return states;
  }

  /// How many lots the godown holds, as the storage locations declare
  /// it. Zero when nobody has set a capacity yet.
  int get capacity =>
      locations.where((l) => l.isActive).fold(0, (sum, l) => sum + l.capacity);
}

/// How one lot in the godown is doing, for the map on the dashboard.
/// The order matters: the map sorts worst first, and empty last.
enum SlotState { empty, paidUp, billDue, overdue }

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
    final locations = await StorageLocationRepository.instance.getAll();
    final consignments = await ConsignmentRepository.instance.getAll();
    final releases = await GoodsReleaseRepository.instance.getAll();

    return DashboardStats(
      customers: customers,
      bookings: bookings,
      bills: bills,
      payments: payments,
      quotations: quotations,
      locations: locations,
      consignmentCount: consignments.length,
      releaseCount: releases.length,
    );
  }
}
