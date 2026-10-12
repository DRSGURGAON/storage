import 'dart:typed_data';

import '../../../core/export/xlsx_writer.dart';
import '../../billing/models/bill_model.dart';
import '../../billing/models/payment_model.dart';
import '../../billing/repositories/billing_repository.dart';
import '../../quotation/models/quotation_model.dart';
import '../../quotation/repositories/quotation_repository.dart';

/// The date range a report covers. Indian financial years run April to
/// March, which is what an owner and their CA think in.
class ReportPeriod {
  final String label;

  /// Inclusive start and exclusive end; null means open.
  final DateTime? from;
  final DateTime? to;

  const ReportPeriod(this.label, {this.from, this.to});

  static const all = ReportPeriod('All time');

  bool contains(DateTime date) =>
      (from == null || !date.isBefore(from!)) &&
      (to == null || date.isBefore(to!));

  /// The choices every report offers, as of [now].
  static List<ReportPeriod> presets(DateTime now) {
    final monthStart = DateTime(now.year, now.month);
    final fyStartYear = now.month >= 4 ? now.year : now.year - 1;
    final fyStart = DateTime(fyStartYear, 4);
    String fy(int startYear) =>
        'FY $startYear-${(startYear + 1).toString().substring(2)}';
    return [
      ReportPeriod('This month',
          from: monthStart, to: DateTime(now.year, now.month + 1)),
      ReportPeriod('Last month',
          from: DateTime(now.year, now.month - 1), to: monthStart),
      ReportPeriod(fy(fyStartYear),
          from: fyStart, to: DateTime(fyStartYear + 1, 4)),
      ReportPeriod(fy(fyStartYear - 1),
          from: DateTime(fyStartYear - 1, 4), to: fyStart),
      all,
    ];
  }
}

/// One customer's account: everything billed, received and still due.
class LedgerRow {
  final String customerId;
  final String name;
  final String phone;
  final double billed;
  final double received;
  final double credited;
  final double depositHeld;
  final int billCount;
  final DateTime? lastBill;

  const LedgerRow({
    required this.customerId,
    required this.name,
    required this.phone,
    required this.billed,
    required this.received,
    required this.credited,
    required this.depositHeld,
    required this.billCount,
    required this.lastBill,
  });

  double get outstanding {
    final due = billed - received - credited;
    return due < 0.005 ? 0 : due;
  }

  double get advance {
    final extra = received + credited - billed;
    return extra < 0.005 ? 0 : extra;
  }
}

/// One month of GST, for filing.
class GstMonth {
  final DateTime month;
  final List<BillModel> bills;

  GstMonth(this.month, this.bills);

  Iterable<BillModel> get _withGst => bills.where((b) => b.gstAmount > 0);

  int get billCount => bills.length;
  double get taxable => _withGst.fold(0, (s, b) => s + b.taxableBase);
  double get cgst => bills.fold(0, (s, b) => s + b.cgstAmount);
  double get sgst => bills.fold(0, (s, b) => s + b.sgstAmount);
  double get igst => bills.fold(0, (s, b) => s + b.igstAmount);
  double get gst => cgst + sgst + igst;
  double get nonGstValue => bills
      .where((b) => b.gstAmount <= 0)
      .fold(0, (s, b) => s + b.grandTotal);
  double get invoiceValue => bills.fold(0, (s, b) => s + b.grandTotal);
}

/// Every money report, built from the bills, receipts and quotations
/// already on this phone - nothing is stored twice.
class MoneyReports {
  MoneyReports._();

  static DateTime dateOf(String iso) =>
      DateTime.tryParse(iso) ?? DateTime(1970);

  static Future<List<BillModel>> bills() =>
      BillingRepository.instance.getAllBills();

  static Future<List<PaymentModel>> payments() =>
      BillingRepository.instance.getAllPayments();

  static Future<List<QuotationModel>> quotations() =>
      QuotationRepository.instance.getAll();

  // ---------------------------------------------------------------
  // Builders (pure - tested without a database)
  // ---------------------------------------------------------------

  /// Per customer: billed, received, credit notes, deposit held and what
  /// is still due - the most owed first.
  static List<LedgerRow> ledger(
    List<BillModel> bills,
    List<PaymentModel> payments,
  ) {
    String keyOf(String id, String name) =>
        id.isNotEmpty ? id : 'name:${name.trim().toLowerCase()}';

    final names = <String, String>{};
    final phones = <String, String>{};
    final billed = <String, double>{};
    final counts = <String, int>{};
    final last = <String, DateTime>{};
    final received = <String, double>{};
    final credited = <String, double>{};
    final deposit = <String, double>{};

    for (final b in bills) {
      final key = keyOf(b.customerId, b.customerName);
      names[key] = b.customerName;
      if (b.customerPhone.isNotEmpty) phones[key] = b.customerPhone;
      billed[key] = (billed[key] ?? 0) + b.grandTotal;
      counts[key] = (counts[key] ?? 0) + 1;
      final date = dateOf(b.billDate);
      if (last[key] == null || date.isAfter(last[key]!)) last[key] = date;
    }

    for (final p in payments) {
      final key = keyOf(p.customerId, p.payerName);
      names.putIfAbsent(key, () => p.payerName);
      if (p.payerPhone.isNotEmpty) phones.putIfAbsent(key, () => p.payerPhone);
      final type = p.paymentType;
      if (type == PaymentType.creditNote) {
        credited[key] = (credited[key] ?? 0) + p.amount;
      } else if (type.settlesDues) {
        received[key] = (received[key] ?? 0) + p.amount;
      }
      if (type.isDepositIn) deposit[key] = (deposit[key] ?? 0) + p.amount;
      if (type.lowersDeposit) deposit[key] = (deposit[key] ?? 0) - p.amount;
    }

    final rows = [
      for (final key in names.keys)
        LedgerRow(
          customerId: key.startsWith('name:') ? '' : key,
          name: names[key]!.trim().isEmpty ? 'Customer' : names[key]!.trim(),
          phone: phones[key] ?? '',
          billed: billed[key] ?? 0,
          received: received[key] ?? 0,
          credited: credited[key] ?? 0,
          depositHeld: (deposit[key] ?? 0) < 0 ? 0 : (deposit[key] ?? 0),
          billCount: counts[key] ?? 0,
          lastBill: last[key],
        ),
    ]..sort((a, b) {
        final byDue = b.outstanding.compareTo(a.outstanding);
        return byDue != 0
            ? byDue
            : a.name.toLowerCase().compareTo(b.name.toLowerCase());
      });
    return rows;
  }

  /// Bills with money still due, the longest-waiting first.
  static List<BillModel> outstanding(List<BillModel> bills) => [
        for (final b in bills)
          if (b.balanceDue > 0.004) b,
      ]..sort((a, b) => dateOf(a.dueDate.isEmpty ? a.billDate : a.dueDate)
          .compareTo(dateOf(b.dueDate.isEmpty ? b.billDate : b.dueDate)));

  /// Days a bill is past its due date (0 when not yet due).
  static int daysOverdue(BillModel bill, DateTime today) {
    final due = DateTime.tryParse(bill.dueDate);
    if (due == null) return 0;
    final days = DateTime(today.year, today.month, today.day)
        .difference(DateTime(due.year, due.month, due.day))
        .inDays;
    return days < 0 ? 0 : days;
  }

  /// Month by month, newest first, for bills in [period].
  static List<GstMonth> gstMonths(List<BillModel> bills, ReportPeriod period) {
    final byMonth = <DateTime, List<BillModel>>{};
    for (final b in bills) {
      final date = dateOf(b.billDate);
      if (!period.contains(date)) continue;
      byMonth.putIfAbsent(DateTime(date.year, date.month), () => []).add(b);
    }
    return [
      for (final e in byMonth.entries)
        GstMonth(e.key,
            e.value..sort((a, b) => dateOf(a.billDate).compareTo(dateOf(b.billDate)))),
    ]..sort((a, b) => b.month.compareTo(a.month));
  }

  static List<T> inPeriod<T>(
    List<T> items,
    ReportPeriod period,
    String Function(T) dateOfItem,
  ) =>
      [
        for (final item in items)
          if (period.contains(dateOf(dateOfItem(item)))) item,
      ]..sort((a, b) => dateOf(dateOfItem(b)).compareTo(dateOf(dateOfItem(a))));

  // ---------------------------------------------------------------
  // Excel
  // ---------------------------------------------------------------

  static DateTime? _date(String iso) => DateTime.tryParse(iso);

  static Uint8List ledgerXlsx(List<LedgerRow> rows) {
    double sum(double Function(LedgerRow) f) => rows.fold(0, (s, r) => s + f(r));
    return XlsxWriter.build([
      XlsxSheet(
        name: 'Customer Ledger',
        title: 'Customer Ledger',
        headers: const [
          'Customer', 'Mobile', 'Bills', 'Billed', 'Received',
          'Credit Notes', 'Outstanding', 'Advance', 'Deposit Held',
        ],
        widths: const [28, 14, 8, 14, 14, 14, 14, 12, 14],
        rows: [
          for (final r in rows)
            [
              r.name, r.phone, r.billCount, r.billed, r.received,
              r.credited, r.outstanding, r.advance, r.depositHeld,
            ],
        ],
        totals: [
          'Total', '', rows.fold<int>(0, (s, r) => s + r.billCount),
          sum((r) => r.billed), sum((r) => r.received),
          sum((r) => r.credited), sum((r) => r.outstanding),
          sum((r) => r.advance), sum((r) => r.depositHeld),
        ],
      ),
    ]);
  }

  static Uint8List outstandingXlsx(List<BillModel> bills, DateTime today) {
    return XlsxWriter.build([
      XlsxSheet(
        name: 'Outstanding',
        title: 'Outstanding Bills',
        headers: const [
          'Bill No', 'Bill Date', 'Due Date', 'Customer', 'Mobile',
          'Bill Amount', 'Paid', 'Balance', 'Days Overdue',
        ],
        widths: const [14, 12, 12, 26, 14, 14, 12, 14, 12],
        rows: [
          for (final b in bills)
            [
              b.billNo, _date(b.billDate), _date(b.dueDate), b.customerName,
              b.customerPhone, b.grandTotal, b.amountPaid, b.balanceDue,
              daysOverdue(b, today),
            ],
        ],
        totals: [
          'Total', null, null, '', '',
          bills.fold<double>(0, (s, b) => s + b.grandTotal),
          bills.fold<double>(0, (s, b) => s + b.amountPaid),
          bills.fold<double>(0, (s, b) => s + b.balanceDue),
          null,
        ],
      ),
    ]);
  }

  static Uint8List paymentsXlsx(
    List<PaymentModel> payments,
    Map<String, BillModel> billsById,
    String periodLabel,
  ) {
    return XlsxWriter.build([
      XlsxSheet(
        name: 'Payments',
        title: 'Payment / Collection Report - $periodLabel',
        headers: const [
          'Receipt No', 'Date', 'Received From', 'Mobile', 'Type', 'Mode',
          'Reference', 'Against Bill', 'Amount',
        ],
        widths: const [14, 12, 26, 14, 18, 14, 16, 14, 14],
        rows: [
          for (final p in payments)
            [
              p.receiptNo, _date(p.paymentDate), p.payerName, p.payerPhone,
              p.paymentType.label, p.mode.label, p.referenceNo,
              billsById[p.billId]?.billNo ?? '', p.amount,
            ],
        ],
        totals: [
          'Total', null, '', '', '', '', '', '',
          payments.fold<double>(0, (s, p) => s + p.amount),
        ],
      ),
    ]);
  }

  static Uint8List gstXlsx(List<GstMonth> months, String periodLabel) {
    double sum(double Function(GstMonth) f) => months.fold(0, (s, m) => s + f(m));
    String monthName(DateTime m) =>
        const ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
            'Oct', 'Nov', 'Dec'][m.month - 1] +
        ' ${m.year}';
    final bills = [for (final m in months) ...m.bills];
    return XlsxWriter.build([
      XlsxSheet(
        name: 'GST Summary',
        title: 'GST Summary - $periodLabel',
        headers: const [
          'Month', 'Bills', 'Taxable Value', 'CGST', 'SGST', 'IGST',
          'Total GST', 'Non-GST Value', 'Invoice Value',
        ],
        widths: const [12, 8, 16, 12, 12, 12, 14, 16, 16],
        rows: [
          for (final m in months)
            [
              monthName(m.month), m.billCount, m.taxable, m.cgst, m.sgst,
              m.igst, m.gst, m.nonGstValue, m.invoiceValue,
            ],
        ],
        totals: [
          'Total', months.fold<int>(0, (s, m) => s + m.billCount),
          sum((m) => m.taxable), sum((m) => m.cgst), sum((m) => m.sgst),
          sum((m) => m.igst), sum((m) => m.gst), sum((m) => m.nonGstValue),
          sum((m) => m.invoiceValue),
        ],
      ),
      XlsxSheet(
        name: 'Bill-wise',
        title: 'Bill-wise GST - $periodLabel',
        headers: const [
          'Bill No', 'Date', 'Customer', 'Customer GSTIN', 'State',
          'GST %', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Bill Total',
        ],
        widths: const [14, 12, 26, 18, 14, 8, 16, 12, 12, 12, 14],
        rows: [
          for (final b in bills)
            [
              b.billNo, _date(b.billDate), b.customerName, b.customerGst,
              b.customerState, b.gstPercent,
              b.gstAmount > 0 ? b.taxableBase : 0, b.cgstAmount,
              b.sgstAmount, b.igstAmount, b.grandTotal,
            ],
        ],
      ),
    ]);
  }

  static Uint8List billsXlsx(List<BillModel> bills, String periodLabel) {
    return XlsxWriter.build([
      XlsxSheet(
        name: 'Bills',
        title: 'Bill Report - $periodLabel',
        headers: const [
          'Bill No', 'Date', 'Customer', 'Mobile', 'Booking', 'Status',
          'Taxable', 'GST', 'Bill Amount', 'Paid', 'Balance',
        ],
        widths: const [14, 12, 26, 14, 12, 12, 14, 12, 14, 12, 14],
        rows: [
          for (final b in bills)
            [
              b.billNo, _date(b.billDate), b.customerName, b.customerPhone,
              b.bookingNo, b.derivedStatus.label, b.taxableBase, b.gstAmount,
              b.grandTotal, b.amountPaid, b.balanceDue,
            ],
        ],
        totals: [
          'Total', null, '', '', '', '',
          bills.fold<double>(0, (s, b) => s + b.taxableBase),
          bills.fold<double>(0, (s, b) => s + b.gstAmount),
          bills.fold<double>(0, (s, b) => s + b.grandTotal),
          bills.fold<double>(0, (s, b) => s + b.amountPaid),
          bills.fold<double>(0, (s, b) => s + b.balanceDue),
        ],
      ),
    ]);
  }

  static Uint8List quotationsXlsx(
    List<QuotationModel> quotations,
    String periodLabel,
  ) {
    return XlsxWriter.build([
      XlsxSheet(
        name: 'Quotations',
        title: 'Quotation Report - $periodLabel',
        headers: const [
          'Quotation No', 'Date', 'Customer', 'Mobile', 'From', 'To',
          'Status', 'Amount',
        ],
        widths: const [16, 12, 26, 14, 14, 14, 12, 14],
        rows: [
          for (final q in quotations)
            [
              q.quotationNo, _date(q.quotationDate), q.customerName,
              q.customerPhone, q.fromCity, q.toCity, q.status.label,
              q.grandTotal,
            ],
        ],
        totals: [
          'Total', null, '', '', '', '', '',
          quotations.fold<double>(0, (s, q) => s + q.grandTotal),
        ],
      ),
    ]);
  }
}
