import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/features/billing/models/bill_model.dart';
import 'package:godown_book/features/company/models/company_model.dart';
import 'package:godown_book/features/reports/services/aged_outstanding_pdf_service.dart';
import 'package:godown_book/features/reports/services/rent_roll_pdf_service.dart';
import 'package:godown_book/features/reports/services/report_builder.dart';
import 'package:godown_book/features/storage_booking/models/booking_item_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_booking_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_status.dart';

/// The month-end pages. Every figure on them is a sum an owner will
/// compare with their own notebook, so the arithmetic is checked here
/// without a database in the way.
void main() {
  const company = CompanyModel(
    companyId: 'company-test',
    companyName: 'Test Movers',
    address: 'GT Road',
    city: 'Karnal',
    state: 'Haryana',
    mobile1: '9999999999',
  );

  StorageBookingModel lot(
    String id, {
    StorageStatus status = StorageStatus.inStorage,
    RentBasis basis = RentBasis.monthly,
    double rate = 3000,
    int packages = 0,
    List<BookingItemModel> items = const [],
    String location = 'Hall A',
    String since = '2026-08-01',
  }) {
    return StorageBookingModel(
      id: id,
      bookingNo: 'SR/$id',
      bookingDate: '${since}T00:00:00',
      customerName: 'Customer $id',
      locationName: location,
      storageStartDate: '${since}T00:00:00',
      status: status,
      rentBasis: basis,
      rentRate: rate,
      totalPackages: packages,
      items: items,
      createdAt: '',
    );
  }

  BillModel bill(
    String id, {
    required String customer,
    required double amount,
    double paid = 0,
    String due = '',
    String date = '2026-08-01',
  }) {
    return BillModel(
      id: id,
      billNo: 'INV/$id',
      billDate: '${date}T00:00:00',
      customerId: customer,
      customerName: 'Customer $customer',
      dueDate: due,
      amountPaid: paid,
      createdAt: '',
      lines: [
        BillLineModel(id: 'l-$id', chargeName: 'Rent', rate: amount, amount: amount),
      ],
    );
  }

  group('rent roll', () {
    test('lists only what is still inside, and prices a month of each',
        () {
      final roll = ReportBuilder.rentRoll(
        [
          lot('a'),
          lot('b', basis: RentBasis.daily, rate: 100, location: 'Hall B'),
          lot('c', basis: RentBasis.perBoxMonthly, rate: 50, packages: 20),
          lot('d',
              basis: RentBasis.perBoxMonthly,
              rate: 50,
              items: const [
                BookingItemModel(
                    id: 'i', bookingId: 'd', itemName: 'Cartons',
                    quantity: 10, releasedQty: 4),
              ],
              status: StorageStatus.partiallyReleased),
          lot('gone', status: StorageStatus.released),
          lot('never', status: StorageStatus.cancelled),
        ],
        asOn: DateTime(2026, 8, 31),
      );

      expect(roll.rows.map((r) => r.bookingId), ['a', 'c', 'd', 'b']);
      expect(roll.count, 4);
      // 3000 + 100*30 + 50*20 + 50*6
      expect(roll.monthlyRent, 3000 + 3000 + 1000 + 300);
      expect(roll.packagesLeft, 20 + 6);
      expect(roll.rows.first.daysInside(roll.asOn), 30);
    });

    test('renders, with and without anything inside', () async {
      final full = await RentRollPdfService.instance
          .build(ReportBuilder.rentRoll([lot('a')]), company);
      final empty = await RentRollPdfService.instance
          .build(ReportBuilder.rentRoll(const []), company);
      expect(String.fromCharCodes(full.take(5)), '%PDF-');
      expect(String.fromCharCodes(empty.take(5)), '%PDF-');
    });
  });

  group('aged outstanding', () {
    test('buckets each unpaid balance by days past due, per customer', () {
      final report = ReportBuilder.agedOutstanding(
        [
          // Paid off: never appears.
          bill('paid', customer: 'x', amount: 1000, paid: 1000, due: '2026-01-01'),
          // Due 10 days ago: current.
          bill('r1', customer: 'ram', amount: 2000, due: '2026-10-21'),
          // Due 45 days ago, partly paid: 31-60 with the balance only.
          bill('r2', customer: 'ram', amount: 3000, paid: 1000, due: '2026-09-16'),
          // No due date: age runs from the bill date, 100 days ago.
          bill('s1', customer: 'sita', amount: 500, date: '2026-07-23'),
          // Not yet due: current.
          bill('s2', customer: 'sita', amount: 700, due: '2026-11-15'),
        ],
        asOn: DateTime(2026, 10, 31),
      );

      expect(report.customers, 2);
      // Oldest debt first.
      expect(report.rows.first.customerId, 'sita');
      expect(report.rows.first.oldestDays, 100);
      expect(report.rows.first.amountIn(AgeBucket.over90), 500);
      expect(report.rows.first.amountIn(AgeBucket.current), 700);

      final ram = report.rows.last;
      expect(ram.bills, 2);
      expect(ram.amountIn(AgeBucket.current), 2000);
      expect(ram.amountIn(AgeBucket.days31to60), 2000);
      expect(ram.total, 4000);

      expect(report.totalIn(AgeBucket.current), 2700);
      expect(report.totalIn(AgeBucket.days61to90), 0);
      expect(report.grandTotal, 5200);
    });

    test('groups by name when a bill has no customer id', () {
      final report = ReportBuilder.agedOutstanding([
        bill('1', customer: '', amount: 100).copyWith(customerName: 'Walk In'),
        bill('2', customer: '', amount: 200).copyWith(customerName: 'walk in'),
      ]);
      expect(report.customers, 1);
      expect(report.grandTotal, 300);
    });

    test('renders, with and without dues', () async {
      final full = await AgedOutstandingPdfService.instance.build(
        ReportBuilder.agedOutstanding([bill('r1', customer: 'ram', amount: 2000)]),
        company,
      );
      final empty = await AgedOutstandingPdfService.instance
          .build(ReportBuilder.agedOutstanding(const []), company);
      expect(String.fromCharCodes(full.take(5)), '%PDF-');
      expect(String.fromCharCodes(empty.take(5)), '%PDF-');
    });
  });
}
