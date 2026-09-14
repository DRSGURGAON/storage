import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/constants/default_terms.dart';
import 'package:godown_book/core/constants/id_proof_types.dart';
import 'package:godown_book/core/constants/sac_codes.dart';
import 'package:godown_book/core/document_theme/pdf_page_kit.dart';
import 'package:godown_book/features/billing/models/bill_model.dart';
import 'package:godown_book/features/billing/models/payment_model.dart';
import 'package:godown_book/features/billing/services/bill_pdf_service.dart';
import 'package:godown_book/features/billing/services/payment_receipt_pdf_service.dart';
import 'package:godown_book/features/company/models/company_model.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

/// The parts of every paper that the law, not the operator, decides:
/// the GST particulars on a tax invoice, the revenue stamp on a cash
/// receipt, the masked ID number, and the terms that say what a
/// bailment and a carriage actually are.
void main() {
  late Database db;

  setUp(() async {
    db = await openTestDatabase();
  });

  tearDown(() async {
    await db.close();
  });

  const registered = CompanyModel(
    companyId: 'company-test',
    companyName: 'Test Movers',
    address: 'GT Road',
    city: 'Karnal',
    state: 'Haryana',
    mobile1: '9999999999',
    gstNumber: '06ABCDE1234F1Z5',
    panNumber: 'ABCDE1234F',
  );

  BillModel bill({double gst = 18, String customerGst = ''}) => BillModel(
        id: 'b1',
        billNo: 'INV/2026/0001',
        billDate: '2026-09-30T00:00:00',
        customerId: 'c1',
        customerName: 'Rajesh Kumar',
        customerPhone: '9876500001',
        customerGst: customerGst,
        customerState: 'Haryana',
        dueDate: '2026-10-07',
        gstPercent: gst,
        cgstAmount: gst > 0 ? 360 : 0,
        sgstAmount: gst > 0 ? 360 : 0,
        createdAt: '',
        lines: const [
          BillLineModel(id: 'l1', chargeName: 'Storage Rent', rate: 3500, amount: 3500),
          BillLineModel(id: 'l2', chargeName: 'Loading Charge', rate: 500, amount: 500),
        ],
      );

  group('SAC codes', () {
    test('follow from the charge name', () {
      expect(SacCodes.forCharge('Storage Rent'), '996729');
      expect(SacCodes.forCharge('Loading Charge'), '996719');
      expect(SacCodes.forCharge('Unloading'), '996719');
      expect(SacCodes.forCharge('Packing Material'), '998540');
      expect(SacCodes.forCharge('Transportation'), '996511');
      expect(SacCodes.forCharge('Transit Insurance'), '997139');
      expect(SacCodes.forCharge('Something else'), '996729');
    });

    test('the state code is the first two digits of a GSTIN', () {
      expect(SacCodes.stateCodeOf('06ABCDE1234F1Z5'), '06');
      expect(SacCodes.stateCodeOf('ABCDE1234F'), '');
      expect(SacCodes.stateCodeOf(''), '');
    });
  });

  group('ID proof on paper', () {
    test('shows only the last four characters', () {
      expect(IdProofTypes.masked('Aadhaar Card 1234 5678 9012'),
          'Aadhaar Card XXXX XXXX 9012');
      expect(IdProofTypes.masked('PAN Card ABCDE1234F'), 'PAN Card XXXXXX234F');
      expect(IdProofTypes.masked('Aadhaar Card 3078'), 'Aadhaar Card 3078');
      expect(IdProofTypes.masked(''), '');
    });
  });

  group('revenue stamp', () {
    PaymentModel pay(PaymentMode mode, double amount,
            {PaymentType type = PaymentType.fullPayment}) =>
        PaymentModel(
          id: 'p',
          payerName: 'x',
          amount: amount,
          mode: mode,
          paymentType: type,
          paymentDate: '2026-10-01',
          createdAt: '',
        );

    test('is needed on cash above five thousand only', () {
      expect(pay(PaymentMode.cash, 5001).needsRevenueStamp, isTrue);
      expect(pay(PaymentMode.cash, 5000).needsRevenueStamp, isFalse);
      expect(pay(PaymentMode.upi, 50000).needsRevenueStamp, isFalse);
      expect(pay(PaymentMode.cash, 9000, type: PaymentType.creditNote)
          .needsRevenueStamp, isFalse);
      expect(pay(PaymentMode.cash, 9000, type: PaymentType.depositRefund)
          .needsRevenueStamp, isFalse);
    });
  });

  group('default terms', () {
    test('say what the law needs said', () {
      final storage = DefaultStorageTerms.terms.join(' ');
      expect(storage, contains('Indian Contract Act, 1872'));
      expect(storage, contains('lien'));
      expect(storage, contains('Consumer Protection Act, 2019'));
      expect(storage, contains('not a negotiable warehouse receipt'));
      expect(storage, contains('18% per annum'));

      final quotation = DefaultStorageTerms.quotationTerms.join(' ');
      expect(quotation, contains('not a tax invoice'));
      expect(quotation, contains('996729'));

      final bill = DefaultStorageTerms.billTerms.join(' ');
      expect(bill, contains('reverse charge'));

      final receipt = DefaultStorageTerms.receiptTerms.join(' ');
      expect(receipt, contains('revenue stamp'));

      final lr = DefaultStorageTerms.lorryReceiptTerms(ownersRisk: true).join(' ');
      expect(lr, contains('Carriage by Road Act, 2007'));
      expect(lr, contains('180 days'));
      expect(lr, contains("owner's risk"));
      expect(DefaultStorageTerms.lorryReceiptTerms(ownersRisk: false).join(' '),
          contains("carrier's risk"));
    });
  });

  group('scan-to-pay on the bill', () {
    test('the QR carries the amount due and the bill number', () {
      final company = registered.copyWith(upiId1: 'testmovers@upi');
      expect(
        PdfPageKit.upiLink(company, amount: 4720, reference: 'Bill INV/2026/0001'),
        'upi://pay?pa=testmovers@upi&pn=Test%20Movers&cu=INR&am=4720.00'
        '&tn=Bill%20INV%2F2026%2F0001',
      );
      // A paid bill carries no amount, and a company without UPI no link.
      expect(PdfPageKit.upiLink(company, amount: 0), isNot(contains('am=')));
      expect(PdfPageKit.upiLink(registered), isNull);
    });
  });

  group('papers with GST particulars render', () {
    test('tax invoice, bill of supply and plain bill', () async {
      for (final (company, gst) in [
        (registered, 18.0),
        (registered, 0.0),
        (registered.copyWith(gstNumber: ''), 0.0),
      ]) {
        final bytes = await BillPdfService.instance.build(
          bill(gst: gst, customerGst: '06XYZDE1234F1Z5'),
          company,
          previousBalance: 0,
        );
        expect(String.fromCharCodes(bytes.take(5)), '%PDF-');
        expect(bytes.length, greaterThan(1000));
      }
    });

    test('cash receipt with a stamp box, advance voucher, credit note',
        () async {
      final taxed = bill();
      for (final payment in [
        PaymentModel(
          id: 'p1',
          billId: 'b1',
          payerName: 'Rajesh Kumar',
          amount: 6000,
          mode: PaymentMode.cash,
          paymentDate: '2026-10-01',
          createdAt: '',
        ),
        PaymentModel(
          id: 'p2',
          payerName: 'Rajesh Kumar',
          amount: 2000,
          paymentType: PaymentType.advance,
          paymentDate: '2026-10-01',
          createdAt: '',
        ),
        PaymentModel(
          id: 'p3',
          billId: 'b1',
          payerName: 'Rajesh Kumar',
          amount: 1180,
          paymentType: PaymentType.creditNote,
          paymentDate: '2026-10-01',
          notes: 'Loading waived',
          createdAt: '',
        ),
      ]) {
        final bytes = await PaymentReceiptPdfService.instance.build(
          payment,
          registered,
          bill: payment.billId.isEmpty ? null : taxed,
          balanceAfter: 1000,
        );
        expect(String.fromCharCodes(bytes.take(5)), '%PDF-', reason: payment.id);
      }
    });
  });
}
