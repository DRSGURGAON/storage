import 'package:archive/archive.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/features/billing/models/bill_model.dart';
import 'package:godown_book/features/billing/models/payment_model.dart';
import 'package:godown_book/features/reports/services/money_reports.dart';

BillModel _bill(
  String id, {
  required String customerId,
  required String name,
  required String date,
  double amount = 1000,
  double cgst = 0,
  double sgst = 0,
  double igst = 0,
  double paid = 0,
  String due = '',
}) =>
    BillModel(
      id: id,
      billNo: 'B-$id',
      billDate: date,
      dueDate: due,
      customerId: customerId,
      customerName: name,
      customerPhone: '98765${id.padLeft(5, '0')}',
      gstPercent: cgst + sgst + igst > 0 ? 18 : 0,
      cgstAmount: cgst,
      sgstAmount: sgst,
      igstAmount: igst,
      amountPaid: paid,
      createdAt: date,
      lines: [BillLineModel(id: 'l$id', chargeName: 'Storage', amount: amount)],
    );

PaymentModel _payment(
  String id, {
  required String customerId,
  required double amount,
  required String date,
  PaymentType type = PaymentType.fullPayment,
  String billId = '',
}) =>
    PaymentModel(
      id: id,
      receiptNo: 'R-$id',
      customerId: customerId,
      billId: billId,
      payerName: customerId == 'c1' ? 'Rajesh' : 'Suman',
      amount: amount,
      paymentType: type,
      paymentDate: date,
      createdAt: date,
    );

void main() {
  final bills = [
    _bill('1', customerId: 'c1', name: 'Rajesh', date: '2026-09-05',
        cgst: 90, sgst: 90, paid: 500, due: '2026-09-20'),
    _bill('2', customerId: 'c1', name: 'Rajesh', date: '2026-10-02'),
    _bill('3', customerId: 'c2', name: 'Suman', date: '2026-10-03',
        igst: 180, paid: 1180),
  ];
  final payments = [
    _payment('p1', customerId: 'c1', amount: 500, date: '2026-09-10', billId: '1'),
    _payment('p2', customerId: 'c2', amount: 1180, date: '2026-10-04', billId: '3'),
    _payment('p3', customerId: 'c2', amount: 2000, date: '2026-10-04',
        type: PaymentType.securityDeposit),
    _payment('p4', customerId: 'c1', amount: 100, date: '2026-10-05',
        type: PaymentType.creditNote),
  ];

  test('the ledger: billed, received, credit notes, deposit and what is due',
      () {
    final rows = MoneyReports.ledger(bills, payments);
    final rajesh = rows.firstWhere((r) => r.customerId == 'c1');
    final suman = rows.firstWhere((r) => r.customerId == 'c2');

    expect(rajesh.billed, 2180);
    expect(rajesh.received, 500);
    expect(rajesh.credited, 100);
    expect(rajesh.outstanding, 1580);
    expect(rajesh.billCount, 2);

    // A deposit is held, not received - it never makes anyone look paid.
    expect(suman.received, 1180);
    expect(suman.depositHeld, 2000);
    expect(suman.outstanding, 0);

    // The most owed first.
    expect(rows.first.customerId, 'c1');
  });

  test('outstanding: only bills with money due, the oldest first', () {
    final due = MoneyReports.outstanding(bills);
    expect(due.map((b) => b.id), ['1', '2']);
    expect(MoneyReports.daysOverdue(due.first, DateTime(2026, 10, 1)), 11);
    expect(MoneyReports.daysOverdue(due.last, DateTime(2026, 10, 1)), 0);
  });

  test('GST month by month, within the period', () {
    final months = MoneyReports.gstMonths(bills, ReportPeriod.all);
    expect(months.map((m) => m.month), [DateTime(2026, 10), DateTime(2026, 9)]);

    final october = months.first;
    expect(october.billCount, 2);
    expect(october.igst, 180);
    expect(october.taxable, 1000); // only the bill that carried GST
    expect(october.nonGstValue, 1000);

    final september = months.last;
    expect(september.cgst + september.sgst, 180);

    final fy = ReportPeriod.presets(DateTime(2026, 10, 12))[2];
    expect(fy.label, 'FY 2026-27');
    expect(MoneyReports.gstMonths(bills, fy).length, 2);
    final lastMonth = ReportPeriod.presets(DateTime(2026, 10, 12))[1];
    expect(MoneyReports.gstMonths(bills, lastMonth).single.month,
        DateTime(2026, 9));
  });

  test('periods: this month, last month and the financial years', () {
    final p = ReportPeriod.presets(DateTime(2027, 2, 15));
    expect(p[0].contains(DateTime(2027, 2, 1)), isTrue);
    expect(p[0].contains(DateTime(2027, 3, 1)), isFalse);
    expect(p[1].contains(DateTime(2027, 1, 31)), isTrue);
    expect(p[2].label, 'FY 2026-27');
    expect(p[2].contains(DateTime(2026, 4, 1)), isTrue);
    expect(p[2].contains(DateTime(2027, 4, 1)), isFalse);
    expect(p[3].label, 'FY 2025-26');
  });

  test('every report exports a real Excel workbook', () {
    final files = [
      MoneyReports.ledgerXlsx(MoneyReports.ledger(bills, payments)),
      MoneyReports.outstandingXlsx(MoneyReports.outstanding(bills), DateTime(2026, 10, 12)),
      MoneyReports.paymentsXlsx(payments, {for (final b in bills) b.id: b}, 'All time'),
      MoneyReports.gstXlsx(MoneyReports.gstMonths(bills, ReportPeriod.all), 'All time'),
      MoneyReports.billsXlsx(bills, 'All time'),
      MoneyReports.quotationsXlsx(const [], 'All time'),
    ];
    for (final bytes in files) {
      final archive = ZipDecoder().decodeBytes(bytes);
      final names = archive.files.map((f) => f.name).toSet();
      expect(names, containsAll(['[Content_Types].xml', 'xl/workbook.xml',
          'xl/worksheets/sheet1.xml']));
    }
  });
}
