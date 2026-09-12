import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/features/billing/models/bill_model.dart';
import 'package:godown_book/features/dashboard/services/dashboard_stats_service.dart';
import 'package:godown_book/features/storage_booking/models/storage_booking_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_status.dart';

/// The godown map on the dashboard paints one square per lot. Whether
/// a square is green, amber or red is decided here, and it has to be
/// right: an owner glances at this to decide who to call.
void main() {
  StorageBookingModel lot(String id,
      {StorageStatus status = StorageStatus.inStorage,
      double rent = 3000,
      String billedUpto = ''}) {
    return StorageBookingModel(
      id: id,
      bookingDate: DateTime(2026, 1, 1).toIso8601String(),
      customerName: id,
      storageStartDate: DateTime(2026, 1, 1).toIso8601String(),
      status: status,
      rentRate: rent,
      rentBilledUpto: billedUpto,
      createdAt: '',
    );
  }

  BillModel bill(String bookingId,
      {required DateTime due, double paid = 0, double amount = 3000}) {
    return BillModel(
      id: 'bill-$bookingId',
      billDate: DateTime(2026, 8, 1).toIso8601String(),
      bookingId: bookingId,
      customerName: bookingId,
      dueDate: due.toIso8601String(),
      amountPaid: paid,
      createdAt: '',
      lines: [
        BillLineModel(
          id: 'l-$bookingId',
          chargeName: 'Storage Charge',
          quantity: 1,
          rate: amount,
          amount: amount,
        ),
      ],
    );
  }

  final recent = DateTime.now().subtract(const Duration(days: 3)).toIso8601String();

  test('paid up, waiting on a bill, and overdue come out as three colours', () {
    final stats = DashboardStats(
      customers: const [],
      bookings: [
        lot('paid', billedUpto: recent),
        lot('unbilled'),
        lot('late', billedUpto: recent),
      ],
      bills: [
        bill('paid', due: DateTime.now().add(const Duration(days: 20)), paid: 3000),
        bill('late', due: DateTime.now().subtract(const Duration(days: 40))),
      ],
      payments: const [],
      quotations: const [],
    );

    expect(stats.slotStates, [
      SlotState.overdue,
      SlotState.billDue,
      SlotState.paidUp,
    ]);
  });

  test('goods already released are not on the map', () {
    final stats = DashboardStats(
      customers: const [],
      bookings: [
        lot('gone', status: StorageStatus.released, billedUpto: recent),
        lot('here', billedUpto: recent),
      ],
      bills: const [],
      payments: const [],
      quotations: const [],
    );
    expect(stats.slotStates, [SlotState.paidUp]);
  });

  test('an unpaid bill that is not yet late is amber, not red', () {
    final stats = DashboardStats(
      customers: const [],
      bookings: [lot('soon', billedUpto: recent)],
      bills: [bill('soon', due: DateTime.now().add(const Duration(days: 5)))],
      payments: const [],
      quotations: const [],
    );
    expect(stats.slotStates, [SlotState.billDue]);
  });
}
