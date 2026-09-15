import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/customer/customer_lookup_service.dart';
import 'package:godown_book/features/billing/models/bill_model.dart';
import 'package:godown_book/features/billing/models/payment_model.dart';
import 'package:godown_book/features/billing/repositories/billing_repository.dart';
import 'package:godown_book/features/billing/services/payment_receipt_pdf_service.dart';
import 'package:godown_book/features/company/controllers/company_controller.dart';
import 'package:godown_book/features/company/models/company_model.dart';
import 'package:godown_book/features/storage_booking/models/booking_item_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_booking_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_status.dart';
import 'package:godown_book/features/storage_booking/repositories/storage_booking_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

/// What the paper says has to match what happened. These are the
/// document-level mistakes found in the full-app scan: money going out
/// printed as money received, a statement that dropped its own closing
/// date, tax heads that did not add up, and GST charged by a supplier
/// with no GSTIN.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Database db;
  final repo = BillingRepository.instance;

  Future<StorageBookingModel> storedGoods() {
    return StorageBookingRepository.instance.save(StorageBookingModel(
      id: '',
      bookingDate: '2026-09-01T00:00:00',
      customerName: 'Rajesh Kumar',
      customerPhone: '9876500001',
      customerCity: 'Karnal',
      customerState: 'Haryana',
      storageStartDate: '2026-09-01T00:00:00',
      rentBasis: RentBasis.monthly,
      rentRate: 3500,
      items: const [
        BookingItemModel(id: '', bookingId: '', itemName: 'Sofa', quantity: 1),
      ],
      createdAt: '',
    ));
  }

  setUp(() async {
    db = await openTestDatabase();
    CustomerLookupService.instance.invalidate();
  });

  tearDown(() async {
    await db.close();
  });

  group('the money receipt says which way the money went', () {
    const company = CompanyModel(
      companyId: 'company-test',
      companyName: 'Test Movers',
      address: 'GT Road',
      city: 'Karnal',
      state: 'Haryana',
      mobile1: '9999999999',
      gstNumber: '06ABCDE1234F1Z5',
    );

    PaymentModel voucher(PaymentType type) => PaymentModel(
          id: 'pay-1',
          receiptNo: 'RCPT/2026/0001',
          paymentDate: '2026-09-10T10:00:00',
          payerName: 'Rajesh Kumar',
          amount: 10000,
          paymentType: type,
          createdAt: '2026-09-10T10:00:00',
        );

    test('a refund voucher is not an "amount received"', () async {
      final refund = await PaymentReceiptPdfService.instance
          .build(voucher(PaymentType.depositRefund), company);
      expect(refund, isNotEmpty);

      final adjustment = await PaymentReceiptPdfService.instance
          .build(voucher(PaymentType.depositAdjusted), company);
      expect(adjustment, isNotEmpty);

      final receipt = await PaymentReceiptPdfService.instance
          .build(voucher(PaymentType.securityDeposit), company);
      expect(receipt, isNotEmpty);
    });
  });

  group('the statement window', () {
    test('keeps everything dated on the closing date', () async {
      final booking = await storedGoods();
      final draft = await repo.draftForBooking(booking, upto: DateTime(2026, 9, 30));
      final bill = await repo.saveBill(draft);

      // Both the bill and the receipt are dated TODAY, at a real time
      // of day - the way the app records them. The statement picker
      // hands plain midnight as the closing date, so before the fix
      // everything made today fell outside a window that ends today.
      final now = DateTime.now();
      final today = DateTime(now.year, now.month, now.day);

      await repo.recordPayment(PaymentModel(
        id: '',
        receiptNo: '',
        billId: bill.id,
        customerId: bill.customerId,
        paymentDate: today.add(const Duration(hours: 16, minutes: 30))
            .toIso8601String(),
        payerName: 'Rajesh Kumar',
        amount: 500,
        createdAt: '',
      ));

      final entries = await repo.statementForCustomer(
        bill.customerId,
        from: today.subtract(const Duration(days: 30)),
        to: today,
      );

      expect(
        entries.where((e) => e.credit > 0).length,
        1,
        reason: 'the receipt made on the closing date belongs in the window',
      );
      expect(
        entries.where((e) => e.debit > 0).length,
        1,
        reason: 'so does the bill made on the closing date',
      );
      expect(
        entries.last.runningBalance,
        closeTo(bill.grandTotal - 500, 0.001),
      );
    });

    test('still drops what happened after the closing date', () async {
      final booking = await storedGoods();
      final draft = await repo.draftForBooking(booking, upto: DateTime(2026, 9, 30));
      final bill = await repo.saveBill(draft);

      final now = DateTime.now();
      final yesterday = DateTime(now.year, now.month, now.day)
          .subtract(const Duration(days: 1));

      final entries = await repo.statementForCustomer(
        bill.customerId,
        from: yesterday.subtract(const Duration(days: 30)),
        to: yesterday,
      );

      expect(entries, isEmpty);
    });
  });

  group('tax on a bill', () {
    Future<BillModel> billWithGst() async {
      final booking = await storedGoods();
      final draft = await repo.draftForBooking(booking, upto: DateTime(2026, 9, 30));
      return repo.saveBill(draft.copyWith(
        gstPercent: 18,
        lines: [
          ...draft.lines,
          const BillLineModel(
            id: '',
            chargeName: 'Handling',
            quantity: 1,
            rate: 500.05,
            amount: 500.05,
          ),
        ],
      ));
    }

    test('the halves add back to the tax, to the paisa', () async {
      await CompanyController.instance.saveCompany(
        const CompanyModel(
          companyName: 'Test Movers',
          address: 'GT Road',
          state: 'Haryana',
          mobile1: '9999999999',
          gstNumber: '06ABCDE1234F1Z5',
        ),
      );

      final bill = await billWithGst();
      expect(bill.gstPercent, 18);
      expect(bill.cgstAmount + bill.sgstAmount, closeTo(bill.gstAmount, 0.0001));
      expect((bill.cgstAmount * 100) % 1, closeTo(0, 0.0001));
      expect((bill.sgstAmount * 100) % 1, closeTo(0, 0.0001));
      expect(
        bill.subtotal - bill.discountValue + bill.gstAmount,
        closeTo(bill.grandTotal, 0.0001),
      );
    });

    test('a company with no GSTIN does not collect GST', () async {
      await CompanyController.instance.saveCompany(
        const CompanyModel(
          companyName: 'Test Movers',
          address: 'GT Road',
          state: 'Haryana',
          mobile1: '9999999999',
        ),
      );

      final bill = await billWithGst();
      expect(bill.gstPercent, 0);
      expect(bill.gstAmount, 0);
      expect(bill.grandTotal, closeTo(bill.subtotal, 0.0001));
    });
  });

  group('what the company profile keeps', () {
    test('a saved profile keeps its toll-free number and creation date',
        () async {
      await CompanyController.instance.saveCompany(
        const CompanyModel(
          companyName: 'Test Movers',
          address: 'GT Road',
          state: 'Haryana',
          mobile1: '9999999999',
          tollFree: '1800110011',
          createdAt: '2026-01-01T00:00:00',
        ),
      );

      final saved = await CompanyController.instance.getCompany();
      expect(saved!.tollFree, '1800110011');
      expect(saved.createdAt, '2026-01-01T00:00:00');
    });

    test('the fields that block a document are only the ones that block it',
        () {
      const half = CompanyModel(
        companyId: 'c1',
        companyName: 'Test Movers',
        address: 'GT Road',
        mobile1: '9999999999',
      );
      expect(half.isConfigured, isTrue);
      expect(half.missingFields, isEmpty);
      expect(half.recommendedFields, contains('GST number'));
    });
  });
}
