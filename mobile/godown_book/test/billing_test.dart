import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/customer/customer_lookup_service.dart';
import 'package:godown_book/core/utils/financial_year.dart';
import 'package:godown_book/features/billing/models/bill_model.dart';
import 'package:godown_book/features/billing/models/payment_model.dart';
import 'package:godown_book/features/billing/repositories/billing_repository.dart';
import 'package:godown_book/features/billing/services/bill_pdf_service.dart';
import 'package:godown_book/features/billing/services/payment_receipt_pdf_service.dart';
import 'package:godown_book/features/billing/services/statement_pdf_service.dart';
import 'package:godown_book/features/billing/services/storage_charge_calculator.dart';
import 'package:godown_book/features/company/models/company_model.dart';
import 'package:godown_book/features/customers/repositories/customer_repository.dart';
import 'package:godown_book/features/dashboard/services/dashboard_stats_service.dart';
import 'package:godown_book/features/storage_booking/models/booking_item_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_booking_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_status.dart';
import 'package:godown_book/features/storage_booking/repositories/storage_booking_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

const _company = CompanyModel(
  companyId: 'company-test',
  companyName: 'Test Movers',
  address: 'GT Road',
  city: 'Karnal',
  state: 'Haryana',
  mobile1: '9999999999',
  upiId1: 'testmovers@upi',
);

Future<StorageBookingModel> storedGoods({
  RentBasis basis = RentBasis.monthly,
  double rate = 3500,
  String start = '2026-09-01',
  int packages = 0,
}) {
  return StorageBookingRepository.instance.save(StorageBookingModel(
    id: '',
    bookingDate: '${start}T00:00:00',
    customerName: 'Rajesh Kumar',
    customerPhone: '9876500001',
    customerCity: 'Karnal',
    customerState: 'Haryana',
    storageStartDate: '${start}T00:00:00',
    rentBasis: basis,
    rentRate: rate,
    totalPackages: packages,
    items: const [
      BookingItemModel(id: '', bookingId: '', itemName: 'Sofa', quantity: 1),
    ],
    createdAt: '',
  ));
}

void main() {
  late Database db;
  final repo = BillingRepository.instance;

  setUp(() async {
    db = await openTestDatabase();
    CustomerLookupService.instance.invalidate();
  });

  tearDown(() async {
    await db.close();
  });

  group('storage charge', () {
    test('counts started months, so part of a month is a full month', () {
      expect(
        StorageChargeCalculator.startedMonths(DateTime(2026, 9, 1), DateTime(2026, 9, 30)),
        1,
      );
      expect(
        StorageChargeCalculator.startedMonths(DateTime(2026, 9, 1), DateTime(2026, 10, 1)),
        2,
      );
      expect(
        StorageChargeCalculator.startedMonths(DateTime(2026, 9, 1), DateTime(2026, 11, 30)),
        3,
      );
      // 31 Jan plus a month lands on the last day of February.
      expect(
        StorageChargeCalculator.startedMonths(DateTime(2026, 1, 31), DateTime(2026, 2, 28)),
        2,
      );
    });

    test('counts days inclusively', () {
      expect(StorageChargeCalculator.days(DateTime(2026, 9, 1), DateTime(2026, 9, 1)), 1);
      expect(StorageChargeCalculator.days(DateTime(2026, 9, 1), DateTime(2026, 9, 30)), 30);
    });

    test('works out each of the four charge models', () async {
      final monthly = await storedGoods();
      final monthlyCharge = StorageChargeCalculator.compute(
        monthly,
        from: DateTime(2026, 9, 1),
        to: DateTime(2026, 10, 15),
      );
      expect(monthlyCharge.amount, 7000);
      expect(monthlyCharge.description, contains('2 months at Rs. 3500.00 per month'));

      final daily = await storedGoods(basis: RentBasis.daily, rate: 150);
      final dailyCharge = StorageChargeCalculator.compute(
        daily,
        from: DateTime(2026, 9, 1),
        to: DateTime(2026, 9, 10),
      );
      expect(dailyCharge.amount, 1500);
      expect(dailyCharge.description, contains('10 days'));

      final perBox = await storedGoods(
        basis: RentBasis.perBoxMonthly,
        rate: 90,
        packages: 42,
      );
      final perBoxCharge = StorageChargeCalculator.compute(
        perBox,
        from: DateTime(2026, 9, 1),
        to: DateTime(2026, 9, 20),
      );
      expect(perBoxCharge.amount, 3780);
      expect(perBoxCharge.description, contains('42 boxes'));

      final fixed = await storedGoods(basis: RentBasis.custom, rate: 5000);
      final fixedCharge = StorageChargeCalculator.compute(
        fixed,
        from: DateTime(2026, 9, 1),
        to: DateTime(2027, 3, 31),
      );
      expect(fixedCharge.amount, 5000);
      expect(fixedCharge.description, contains('agreed storage charge'));
    });
  });

  test('a draft bill picks up where the last one stopped', () async {
    final booking = await storedGoods();

    final first = await repo.draftForBooking(booking, upto: DateTime(2026, 9, 30));
    expect(first.periodFrom, '2026-09-01');
    expect(first.lines.single.amount, 3500);

    final savedFirst = await repo.saveBill(first);
    expect(savedFirst.billNo, 'INV/${FinancialYear.startYear(DateTime.now())}/0001');

    // The storage record now knows rent is billed to 30 September.
    final reloaded = await StorageBookingRepository.instance.getById(booking.id);
    expect(reloaded!.rentBilledUpto, '2026-09-30');

    final second = await repo.draftForBooking(reloaded, upto: DateTime(2026, 10, 31));
    expect(second.periodFrom, '2026-10-01');
    expect(second.lines.single.amount, 3500);
  });

  test('bill totals, tax split and customer creation', () async {
    final booking = await storedGoods();
    final draft = await repo.draftForBooking(booking, upto: DateTime(2026, 9, 30));

    final bill = await repo.saveBill(draft.copyWith(
      gstPercent: 18,
      lines: [
        ...draft.lines,
        const BillLineModel(
          id: '',
          chargeName: 'Handling',
          quantity: 1,
          rate: 500,
          amount: 500,
        ),
      ],
    ));

    expect(bill.subtotal, 4000);
    expect(bill.grandTotal, closeTo(4720, 0.001));
    // No company profile saved, so no state to compare - tax stays split.
    expect(bill.gstAmount, closeTo(720, 0.001));
    expect(bill.customerId, isNotEmpty);
    expect((await CustomerRepository.instance.getAll()).single.customerName, 'Rajesh Kumar');
  });

  test('payments settle a bill and move its status', () async {
    final booking = await storedGoods();
    final bill = await repo.saveBill(
      await repo.draftForBooking(booking, upto: DateTime(2026, 9, 30)),
    );
    expect(bill.derivedStatus, BillStatus.draft);

    final part = await repo.recordPayment(PaymentModel(
      id: '',
      billId: bill.id,
      customerId: bill.customerId,
      payerName: bill.customerName,
      amount: 1500,
      mode: PaymentMode.upi,
      paymentType: PaymentType.partPayment,
      paymentDate: DateTime(2026, 10, 2).toIso8601String(),
      createdAt: '',
    ));
    expect(part.receiptNo, 'MR/${FinancialYear.startYear(DateTime.now())}/0001');

    var reloaded = (await repo.getBillById(bill.id))!;
    expect(reloaded.amountPaid, 1500);
    expect(reloaded.balanceDue, 2000);
    expect(reloaded.derivedStatus, BillStatus.partlyPaid);

    await repo.recordPayment(PaymentModel(
      id: '',
      billId: bill.id,
      customerId: bill.customerId,
      payerName: bill.customerName,
      amount: 2000,
      paymentDate: DateTime(2026, 10, 5).toIso8601String(),
      createdAt: '',
    ));

    reloaded = (await repo.getBillById(bill.id))!;
    expect(reloaded.balanceDue, 0);
    expect(reloaded.derivedStatus, BillStatus.paid);

    // Deleting a receipt puts the money back on the bill.
    final payments = await repo.getPaymentsForBill(bill.id);
    await repo.deletePayment(payments.first.id);
    reloaded = (await repo.getBillById(bill.id))!;
    expect(reloaded.amountPaid, 2000);
    expect(reloaded.derivedStatus, BillStatus.partlyPaid);
  });

  test('a credit note lowers the bill without counting as money received',
      () async {
    final booking = await storedGoods();
    final bill = await repo.saveBill(
      await repo.draftForBooking(booking, upto: DateTime(2026, 9, 30)),
    );
    final fy = FinancialYear.startYear(DateTime.now());

    final receipt = await repo.recordPayment(PaymentModel(
      id: '',
      billId: bill.id,
      customerId: bill.customerId,
      payerName: bill.customerName,
      amount: 2000,
      paymentType: PaymentType.partPayment,
      paymentDate: DateTime(2026, 10, 2).toIso8601String(),
      createdAt: '',
    ));
    final note = await repo.recordPayment(PaymentModel(
      id: '',
      billId: bill.id,
      customerId: bill.customerId,
      payerName: bill.customerName,
      amount: 500,
      paymentType: PaymentType.creditNote,
      paymentDate: DateTime(2026, 10, 4).toIso8601String(),
      notes: 'Handling charge waived',
      createdAt: '',
    ));

    // Its own book: the receipt series is untouched by the credit note.
    expect(receipt.receiptNo, 'MR/$fy/0001');
    expect(note.receiptNo, 'CN/$fy/0001');
    final second = await repo.recordPayment(PaymentModel(
      id: '',
      billId: bill.id,
      customerId: bill.customerId,
      payerName: bill.customerName,
      amount: 100,
      paymentDate: DateTime(2026, 10, 6).toIso8601String(),
      createdAt: '',
    ));
    expect(second.receiptNo, 'MR/$fy/0002');

    // The bill comes down by the credit, like a payment would.
    final reloaded = (await repo.getBillById(bill.id))!;
    expect(reloaded.amountPaid, 2600);
    expect(reloaded.balanceDue, 900);

    // But the customer account keeps the two apart, and the credit is
    // never money in the till.
    final balance = await repo.balanceForCustomer(bill.customerId);
    expect(balance.received, 2100);
    expect(balance.credited, 500);
    expect(balance.outstanding, 900);

    final stats = DashboardStats(
      customers: const [],
      bookings: const [],
      bills: const [],
      payments: [
        receipt.copyWith(paymentDate: DateTime.now().toIso8601String()),
        note.copyWith(paymentDate: DateTime.now().toIso8601String()),
      ],
      quotations: const [],
    );
    expect(stats.collectedToday, 2000);
    expect(stats.collectedThisMonth, 2000);

    // The statement shows it as a credit with its reason.
    final statement = await repo.statementForCustomer(bill.customerId);
    final line = statement.firstWhere((e) => e.reference == note.receiptNo);
    expect(line.credit, 500);
    expect(line.particulars, contains('Credit note'));
    expect(line.particulars, contains('Handling charge waived'));

    // The paper says CREDIT NOTE, and the advance voucher says what it is.
    final noteBytes = await PaymentReceiptPdfService.instance.build(
      note,
      _company,
      bill: reloaded,
      balanceAfter: 900,
    );
    expect(String.fromCharCodes(noteBytes.take(5)), '%PDF-');
    final advance = await repo.recordPayment(PaymentModel(
      id: '',
      customerId: bill.customerId,
      payerName: bill.customerName,
      amount: 1000,
      paymentType: PaymentType.advance,
      paymentDate: DateTime(2026, 10, 7).toIso8601String(),
      createdAt: '',
    ));
    final advanceBytes =
        await PaymentReceiptPdfService.instance.build(advance, _company);
    expect(String.fromCharCodes(advanceBytes.take(5)), '%PDF-');

    // Deleting the note puts the amount back on the bill.
    await repo.deletePayment(note.id);
    expect((await repo.getBillById(bill.id))!.balanceDue, 1400);
  });

  test('deleting a bill keeps the money on the customer account', () async {
    final booking = await storedGoods();
    final bill = await repo.saveBill(
      await repo.draftForBooking(booking, upto: DateTime(2026, 9, 30)),
    );
    await repo.recordPayment(PaymentModel(
      id: '',
      billId: bill.id,
      customerId: bill.customerId,
      payerName: bill.customerName,
      amount: 3500,
      paymentDate: DateTime(2026, 10, 2).toIso8601String(),
      createdAt: '',
    ));

    await repo.deleteBill(bill.id);

    expect(await repo.getAllBills(), isEmpty);
    final payment = (await repo.getAllPayments()).single;
    expect(payment.billId, isEmpty);
    expect(payment.amount, 3500);

    final balance = await repo.balanceForCustomer(bill.customerId);
    expect(balance.billed, 0);
    expect(balance.received, 3500);
    expect(balance.advance, 3500);

    // The storage record's billed-upto date goes back with it.
    final reloaded = await StorageBookingRepository.instance.getById(booking.id);
    expect(reloaded!.rentBilledUpto, isEmpty);
  });

  test('statement runs in date order with a running balance', () async {
    final booking = await storedGoods();
    final bill = await repo.saveBill(
      (await repo.draftForBooking(booking, upto: DateTime(2026, 9, 30)))
          .copyWith(billDate: DateTime(2026, 10, 1).toIso8601String()),
    );
    await repo.recordPayment(PaymentModel(
      id: '',
      billId: bill.id,
      customerId: bill.customerId,
      payerName: bill.customerName,
      amount: 2000,
      paymentDate: DateTime(2026, 10, 5).toIso8601String(),
      createdAt: '',
    ));

    final entries = await repo.statementForCustomer(bill.customerId);
    expect(entries.length, 2);
    expect(entries.first.debit, 3500);
    expect(entries.first.runningBalance, 3500);
    expect(entries.last.credit, 2000);
    expect(entries.last.runningBalance, 1500);

    // A window carries what came before it into the opening balance.
    final opening =
        await repo.openingBalance(bill.customerId, DateTime(2026, 10, 3));
    expect(opening, 3500);
    final windowed = await repo.statementForCustomer(
      bill.customerId,
      from: DateTime(2026, 10, 3),
    );
    expect(windowed.single.credit, 2000);
    expect(windowed.single.runningBalance, 1500);
  });

  test('bill, receipt and statement render as PDFs', () async {
    final booking = await storedGoods();
    final bill = await repo.saveBill(
      (await repo.draftForBooking(booking, upto: DateTime(2026, 9, 30)))
          .copyWith(gstPercent: 18),
    );
    final payment = await repo.recordPayment(PaymentModel(
      id: '',
      billId: bill.id,
      customerId: bill.customerId,
      payerName: bill.customerName,
      amount: 1000,
      paymentDate: DateTime(2026, 10, 5).toIso8601String(),
      createdAt: '',
    ));

    final billBytes = await BillPdfService.instance.build(
      (await repo.getBillById(bill.id))!,
      _company,
      showWatermark: true,
      previousBalance: 1200,
    );
    final receiptBytes = await PaymentReceiptPdfService.instance.build(
      payment,
      _company,
      bill: await repo.getBillById(bill.id),
      balanceAfter: 3130,
    );
    final customer = (await CustomerRepository.instance.getAll()).single;
    final statementBytes = await StatementPdfService.instance.build(
      customer: customer,
      entries: await repo.statementForCustomer(bill.customerId),
      openingBalance: 0,
      company: _company,
    );

    for (final bytes in [billBytes, receiptBytes, statementBytes]) {
      expect(bytes.length, greaterThan(1000));
      expect(String.fromCharCodes(bytes.take(5)), '%PDF-');
    }
  });
}
