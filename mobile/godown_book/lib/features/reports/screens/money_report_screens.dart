import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/contact/contact_launcher.dart';
import '../../../core/export/excel_share.dart';
import '../../billing/models/bill_model.dart';
import '../../billing/models/payment_model.dart';
import '../../quotation/models/quotation_model.dart';
import '../services/money_reports.dart';

// The money reports (the same set Bill N Bilty has, for a godown):
// Customer Ledger, Outstanding, Payment / Collection, GST Summary, Bill
// Report and Quotation Report. Each reads what is already on the phone,
// can be narrowed to a period, and exports to Excel for the CA.

final _inr = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 0);
final _day = DateFormat('dd MMM yyyy');

String _money(double v) => _inr.format(v);

String _dateText(String iso) {
  final d = DateTime.tryParse(iso);
  return d == null ? '' : _day.format(d);
}

String _fileDate() => DateFormat('dd-MM-yyyy').format(DateTime.now());

/// The frame every report shares: title, Excel button, a period chooser
/// (when the report has one), summary tiles and the list.
class _ReportFrame extends StatelessWidget {
  final String title;
  final bool loading;
  final Object? error;
  final VoidCallback onRetry;
  final VoidCallback? onExcel;
  final List<ReportPeriod>? periods;
  final ReportPeriod? period;
  final ValueChanged<ReportPeriod>? onPeriod;
  final List<Widget> summary;
  final String emptyText;
  final List<Widget> rows;

  const _ReportFrame({
    required this.title,
    required this.loading,
    required this.error,
    required this.onRetry,
    required this.onExcel,
    required this.summary,
    required this.emptyText,
    required this.rows,
    this.periods,
    this.period,
    this.onPeriod,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        actions: [
          TextButton.icon(
            onPressed: loading || error != null ? null : onExcel,
            icon: const Icon(Icons.table_view_outlined, size: 20),
            label: const Text('Excel'),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Text('The report could not be loaded.'),
                        const SizedBox(height: 12),
                        FilledButton.icon(
                          onPressed: onRetry,
                          icon: const Icon(Icons.refresh),
                          label: const Text('Retry'),
                        ),
                      ],
                    ),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
                  children: [
                    if (periods != null)
                      SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(
                          children: [
                            for (final p in periods!)
                              Padding(
                                padding: const EdgeInsets.only(right: 6),
                                child: ChoiceChip(
                                  label: Text(p.label),
                                  selected: p.label == period?.label,
                                  onSelected: (_) => onPeriod?.call(p),
                                ),
                              ),
                          ],
                        ),
                      ),
                    if (summary.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Wrap(spacing: 8, runSpacing: 8, children: summary),
                    ],
                    const SizedBox(height: 8),
                    if (rows.isEmpty)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 40),
                        child: Text(emptyText, textAlign: TextAlign.center),
                      )
                    else
                      ...rows,
                  ],
                ),
    );
  }
}

class _Tile extends StatelessWidget {
  final String label;
  final String value;
  final Color color;

  const _Tile(this.label, this.value, this.color);

  @override
  Widget build(BuildContext context) {
    final width = (MediaQuery.sizeOf(context).width - 24 - 8) / 2;
    return Container(
      width: width,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, color: Colors.black54)),
          const SizedBox(height: 4),
          Text(
            value,
            style: TextStyle(
                fontSize: 18, fontWeight: FontWeight.w800, color: color),
          ),
        ],
      ),
    );
  }
}

/// Loads data once and keeps a chosen period - the state every report
/// screen needs.
abstract class _ReportState<W extends StatefulWidget> extends State<W> {
  bool loading = true;
  Object? error;
  late final List<ReportPeriod> periods = ReportPeriod.presets(DateTime.now());
  late ReportPeriod period = initialPeriod;

  ReportPeriod get initialPeriod => periods.first;

  Future<void> loadData();

  @override
  void initState() {
    super.initState();
    Future.microtask(reload);
  }

  Future<void> reload() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      await loadData();
      if (!mounted) return;
      setState(() => loading = false);
    } catch (e) {
      debugPrint('Report load failed: $e');
      if (!mounted) return;
      setState(() {
        loading = false;
        error = e;
      });
    }
  }

  void choose(ReportPeriod p) => setState(() => period = p);
}

// ===================================================================
// Customer Ledger
// ===================================================================

class CustomerLedgerReportScreen extends StatefulWidget {
  const CustomerLedgerReportScreen({super.key});

  @override
  State<CustomerLedgerReportScreen> createState() => _LedgerState();
}

class _LedgerState extends _ReportState<CustomerLedgerReportScreen> {
  List<LedgerRow> _rows = [];
  String _query = '';

  @override
  Future<void> loadData() async {
    final rows =
        MoneyReports.ledger(await MoneyReports.bills(), await MoneyReports.payments());
    _rows = rows;
  }

  @override
  Widget build(BuildContext context) {
    final q = _query.trim().toLowerCase();
    final shown = q.isEmpty
        ? _rows
        : _rows
            .where((r) =>
                r.name.toLowerCase().contains(q) || r.phone.contains(q))
            .toList();
    double sum(double Function(LedgerRow) f) =>
        _rows.fold(0, (s, r) => s + f(r));

    return _ReportFrame(
      title: 'Customer Ledger',
      loading: loading,
      error: error,
      onRetry: reload,
      onExcel: _rows.isEmpty
          ? null
          : () => ExcelShare.showActions(
                context,
                build: () => MoneyReports.ledgerXlsx(_rows),
                fileName: 'Customer-Ledger-${_fileDate()}.xlsx',
                subject: 'Customer Ledger',
              ),
      summary: [
        _Tile('Billed', _money(sum((r) => r.billed)), const Color(0xff1E6FD9)),
        _Tile('Received', _money(sum((r) => r.received)), const Color(0xff1E9E5A)),
        _Tile('Outstanding', _money(sum((r) => r.outstanding)),
            const Color(0xffD64545)),
        _Tile('Deposit held', _money(sum((r) => r.depositHeld)),
            const Color(0xff6F4CC9)),
      ],
      emptyText: 'No bills or receipts yet.',
      rows: [
        if (_rows.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: TextField(
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'Search customer or mobile',
                isDense: true,
              ),
              onChanged: (v) => setState(() => _query = v),
            ),
          ),
        for (final r in shown)
          Card(
            margin: const EdgeInsets.symmetric(vertical: 4),
            child: ListTile(
              title: Text(r.name,
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text(
                'Billed ${_money(r.billed)}  •  Received ${_money(r.received)}'
                '${r.credited > 0 ? '  •  Credit ${_money(r.credited)}' : ''}'
                '${r.depositHeld > 0 ? '\nDeposit held ${_money(r.depositHeld)}' : ''}',
              ),
              trailing: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    r.outstanding > 0
                        ? _money(r.outstanding)
                        : r.advance > 0
                            ? 'Adv ${_money(r.advance)}'
                            : 'Settled',
                    style: TextStyle(
                      fontWeight: FontWeight.w800,
                      color: r.outstanding > 0
                          ? const Color(0xffD64545)
                          : const Color(0xff1E9E5A),
                    ),
                  ),
                  if (r.outstanding > 0)
                    const Text('due', style: TextStyle(fontSize: 11)),
                ],
              ),
              onTap: r.customerId.isEmpty
                  ? null
                  : () => context.push('/statement', extra: r.customerId),
            ),
          ),
      ],
    );
  }
}

// ===================================================================
// Outstanding
// ===================================================================

class OutstandingReportScreen extends StatefulWidget {
  const OutstandingReportScreen({super.key});

  @override
  State<OutstandingReportScreen> createState() => _OutstandingState();
}

class _OutstandingState extends _ReportState<OutstandingReportScreen> {
  List<BillModel> _bills = [];

  @override
  Future<void> loadData() async {
    _bills = MoneyReports.outstanding(await MoneyReports.bills());
  }

  Future<void> _remind(BillModel bill) async {
    final message = 'Namaste ${bill.customerName.trim()},\n\n'
        'Aapka bill ${bill.billNo} (${_dateText(bill.billDate)}) ka '
        '${_money(bill.balanceDue)} baaki hai'
        '${bill.dueDate.isEmpty ? '' : ', jo ${_dateText(bill.dueDate)} tak dena tha'}. '
        'Kripya jaldi payment kar dein.\n\nDhanyavaad';
    await ContactLauncher.openWhatsAppWithChoice(
      context,
      bill.customerPhone,
      message: message,
    );
  }

  @override
  Widget build(BuildContext context) {
    final today = DateTime.now();
    final total = _bills.fold<double>(0, (s, b) => s + b.balanceDue);
    final overdue = _bills.where((b) => MoneyReports.daysOverdue(b, today) > 0);

    return _ReportFrame(
      title: 'Outstanding Report',
      loading: loading,
      error: error,
      onRetry: reload,
      onExcel: _bills.isEmpty
          ? null
          : () => ExcelShare.showActions(
                context,
                build: () => MoneyReports.outstandingXlsx(_bills, today),
                fileName: 'Outstanding-${_fileDate()}.xlsx',
                subject: 'Outstanding Bills',
              ),
      summary: [
        _Tile('Total due', _money(total), const Color(0xffD64545)),
        _Tile('Overdue bills', '${overdue.length} of ${_bills.length}',
            const Color(0xffE0731F)),
      ],
      emptyText: 'Nothing is due - every bill is paid.',
      rows: [
        for (final b in _bills)
          Card(
            margin: const EdgeInsets.symmetric(vertical: 4),
            child: ListTile(
              title: Text('${b.customerName}  •  ${b.billNo}',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text(
                'Bill ${_money(b.grandTotal)}  •  Paid ${_money(b.amountPaid)}\n'
                '${MoneyReports.daysOverdue(b, today) > 0 ? '${MoneyReports.daysOverdue(b, today)} days overdue' : b.dueDate.isEmpty ? _dateText(b.billDate) : 'Due ${_dateText(b.dueDate)}'}',
              ),
              isThreeLine: true,
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_money(b.balanceDue),
                      style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          color: Color(0xffD64545))),
                  if (b.customerPhone.trim().isNotEmpty)
                    IconButton(
                      tooltip: 'WhatsApp reminder',
                      icon: const Icon(Icons.chat_outlined,
                          color: Color(0xff128C4A)),
                      onPressed: () => _remind(b),
                    ),
                ],
              ),
              onTap: () => context.push('/bill-pdf', extra: b.id),
            ),
          ),
      ],
    );
  }
}

// ===================================================================
// Payment / Collection
// ===================================================================

class PaymentReportScreen extends StatefulWidget {
  const PaymentReportScreen({super.key});

  @override
  State<PaymentReportScreen> createState() => _PaymentsState();
}

class _PaymentsState extends _ReportState<PaymentReportScreen> {
  List<PaymentModel> _all = [];
  Map<String, BillModel> _billsById = {};

  @override
  Future<void> loadData() async {
    _all = await MoneyReports.payments();
    _billsById = {for (final b in await MoneyReports.bills()) b.id: b};
  }

  @override
  Widget build(BuildContext context) {
    final shown = MoneyReports.inPeriod(_all, period, (p) => p.paymentDate);
    double total(bool Function(PaymentModel) f) =>
        shown.where(f).fold(0, (s, p) => s + p.amount);
    final byMode = <String, double>{};
    for (final p in shown.where((p) => p.paymentType.isCashIn)) {
      byMode[p.mode.label] = (byMode[p.mode.label] ?? 0) + p.amount;
    }

    return _ReportFrame(
      title: 'Payment / Collection',
      loading: loading,
      error: error,
      onRetry: reload,
      periods: periods,
      period: period,
      onPeriod: choose,
      onExcel: shown.isEmpty
          ? null
          : () => ExcelShare.showActions(
                context,
                build: () =>
                    MoneyReports.paymentsXlsx(shown, _billsById, period.label),
                fileName: 'Payment-Report-${_fileDate()}.xlsx',
                subject: 'Payment / Collection Report - ${period.label}',
              ),
      summary: [
        _Tile('Collected', _money(total((p) => p.paymentType.isCashIn)),
            const Color(0xff1E9E5A)),
        _Tile('Receipts', '${shown.length}', const Color(0xff0A7D8C)),
        for (final e in byMode.entries)
          _Tile(e.key, _money(e.value), const Color(0xff4B5A6E)),
      ],
      emptyText: 'No payments in ${period.label.toLowerCase()}.',
      rows: [
        for (final p in shown)
          Card(
            margin: const EdgeInsets.symmetric(vertical: 4),
            child: ListTile(
              title: Text(
                '${p.payerName.trim().isEmpty ? 'Receipt' : p.payerName.trim()}'
                '${p.receiptNo.isEmpty ? '' : '  •  ${p.receiptNo}'}',
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              subtitle: Text(
                '${_dateText(p.paymentDate)}  •  ${p.paymentType.label}  •  '
                '${p.mode.label}'
                '${_billsById[p.billId] == null ? '' : '  •  Bill ${_billsById[p.billId]!.billNo}'}',
              ),
              trailing: Text(
                _money(p.amount),
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                  color: p.paymentType.isCashIn
                      ? const Color(0xff1E9E5A)
                      : const Color(0xff4B5A6E),
                ),
              ),
              onTap: () => context.push('/receipt-pdf', extra: p.id),
            ),
          ),
      ],
    );
  }
}

// ===================================================================
// GST Summary
// ===================================================================

class GstSummaryReportScreen extends StatefulWidget {
  const GstSummaryReportScreen({super.key});

  @override
  State<GstSummaryReportScreen> createState() => _GstState();
}

class _GstState extends _ReportState<GstSummaryReportScreen> {
  List<BillModel> _bills = [];

  // GST is filed by financial year: start on the current one.
  @override
  ReportPeriod get initialPeriod => periods[2];

  @override
  Future<void> loadData() async {
    _bills = await MoneyReports.bills();
  }

  @override
  Widget build(BuildContext context) {
    final months = MoneyReports.gstMonths(_bills, period);
    double sum(double Function(GstMonth) f) => months.fold(0, (s, m) => s + f(m));

    return _ReportFrame(
      title: 'GST Summary',
      loading: loading,
      error: error,
      onRetry: reload,
      periods: periods,
      period: period,
      onPeriod: choose,
      onExcel: months.isEmpty
          ? null
          : () => ExcelShare.showActions(
                context,
                build: () => MoneyReports.gstXlsx(months, period.label),
                fileName: 'GST-Summary-${_fileDate()}.xlsx',
                subject: 'GST Summary - ${period.label}',
              ),
      summary: [
        _Tile('Taxable value', _money(sum((m) => m.taxable)),
            const Color(0xff1E6FD9)),
        _Tile('Total GST', _money(sum((m) => m.gst)), const Color(0xff6F4CC9)),
        _Tile('CGST + SGST', _money(sum((m) => m.cgst + m.sgst)),
            const Color(0xff0A7D8C)),
        _Tile('IGST', _money(sum((m) => m.igst)), const Color(0xff0A7D8C)),
      ],
      emptyText: 'No bills in ${period.label.toLowerCase()}.',
      rows: [
        for (final m in months)
          Card(
            margin: const EdgeInsets.symmetric(vertical: 4),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(DateFormat('MMMM yyyy').format(m.month),
                            style: const TextStyle(
                                fontWeight: FontWeight.w700, fontSize: 15)),
                      ),
                      Text('${m.billCount} bill${m.billCount == 1 ? '' : 's'}',
                          style: const TextStyle(color: Colors.black54)),
                    ],
                  ),
                  const SizedBox(height: 6),
                  _line('Taxable value', m.taxable),
                  _line('CGST', m.cgst),
                  _line('SGST', m.sgst),
                  _line('IGST', m.igst),
                  _line('Total GST', m.gst, bold: true),
                  if (m.nonGstValue > 0) _line('Bills without GST', m.nonGstValue),
                  _line('Invoice value', m.invoiceValue),
                ],
              ),
            ),
          ),
        if (months.isNotEmpty)
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text(
              'From the bills on this phone. Check with your CA before '
              'filing; the Excel file has a bill-wise sheet with GSTINs.',
              style: TextStyle(fontSize: 12, color: Colors.black54),
            ),
          ),
      ],
    );
  }

  Widget _line(String label, double value, {bool bold = false}) {
    final style = TextStyle(fontWeight: bold ? FontWeight.w700 : null);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style)),
          Text(_money(value), style: style),
        ],
      ),
    );
  }
}

// ===================================================================
// Bill Report
// ===================================================================

class BillReportScreen extends StatefulWidget {
  const BillReportScreen({super.key});

  @override
  State<BillReportScreen> createState() => _BillsState();
}

class _BillsState extends _ReportState<BillReportScreen> {
  List<BillModel> _all = [];

  @override
  Future<void> loadData() async {
    _all = await MoneyReports.bills();
  }

  @override
  Widget build(BuildContext context) {
    final shown = MoneyReports.inPeriod(_all, period, (b) => b.billDate);
    double sum(double Function(BillModel) f) => shown.fold(0, (s, b) => s + f(b));

    return _ReportFrame(
      title: 'Bill Report',
      loading: loading,
      error: error,
      onRetry: reload,
      periods: periods,
      period: period,
      onPeriod: choose,
      onExcel: shown.isEmpty
          ? null
          : () => ExcelShare.showActions(
                context,
                build: () => MoneyReports.billsXlsx(shown, period.label),
                fileName: 'Bill-Report-${_fileDate()}.xlsx',
                subject: 'Bill Report - ${period.label}',
              ),
      summary: [
        _Tile('Billed', _money(sum((b) => b.grandTotal)), const Color(0xff1E6FD9)),
        _Tile('Received', _money(sum((b) => b.amountPaid)), const Color(0xff1E9E5A)),
        _Tile('Balance', _money(sum((b) => b.balanceDue)), const Color(0xffD64545)),
        _Tile('Bills', '${shown.length}', const Color(0xff4B5A6E)),
      ],
      emptyText: 'No bills in ${period.label.toLowerCase()}.',
      rows: [
        for (final b in shown)
          Card(
            margin: const EdgeInsets.symmetric(vertical: 4),
            child: ListTile(
              title: Text('${b.customerName}  •  ${b.billNo}',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text(
                '${_dateText(b.billDate)}  •  ${b.derivedStatus.label}'
                '${b.balanceDue > 0 ? '  •  Balance ${_money(b.balanceDue)}' : ''}',
              ),
              trailing: Text(_money(b.grandTotal),
                  style: const TextStyle(fontWeight: FontWeight.w800)),
              onTap: () => context.push('/bill-pdf', extra: b.id),
            ),
          ),
      ],
    );
  }
}

// ===================================================================
// Quotation Report
// ===================================================================

class QuotationReportScreen extends StatefulWidget {
  const QuotationReportScreen({super.key});

  @override
  State<QuotationReportScreen> createState() => _QuotationsState();
}

class _QuotationsState extends _ReportState<QuotationReportScreen> {
  List<QuotationModel> _all = [];

  @override
  Future<void> loadData() async {
    _all = await MoneyReports.quotations();
  }

  static Color _statusColor(QuotationStatus s) => switch (s) {
        QuotationStatus.accepted => const Color(0xff1E9E5A),
        QuotationStatus.declined => const Color(0xffD64545),
        QuotationStatus.sent => const Color(0xff1E6FD9),
        QuotationStatus.draft => const Color(0xff4B5A6E),
      };

  @override
  Widget build(BuildContext context) {
    final shown = MoneyReports.inPeriod(_all, period, (q) => q.quotationDate);
    int count(QuotationStatus s) => shown.where((q) => q.status == s).length;
    final decided = count(QuotationStatus.accepted) + count(QuotationStatus.declined);

    return _ReportFrame(
      title: 'Quotation Report',
      loading: loading,
      error: error,
      onRetry: reload,
      periods: periods,
      period: period,
      onPeriod: choose,
      onExcel: shown.isEmpty
          ? null
          : () => ExcelShare.showActions(
                context,
                build: () => MoneyReports.quotationsXlsx(shown, period.label),
                fileName: 'Quotation-Report-${_fileDate()}.xlsx',
                subject: 'Quotation Report - ${period.label}',
              ),
      summary: [
        _Tile('Quotations', '${shown.length}', const Color(0xffE0731F)),
        _Tile(
          'Accepted',
          decided == 0
              ? '${count(QuotationStatus.accepted)}'
              : '${count(QuotationStatus.accepted)} '
                  '(${(count(QuotationStatus.accepted) * 100 / decided).round()}%)',
          const Color(0xff1E9E5A),
        ),
      ],
      emptyText: 'No quotations in ${period.label.toLowerCase()}.',
      rows: [
        for (final q in shown)
          Card(
            margin: const EdgeInsets.symmetric(vertical: 4),
            child: ListTile(
              title: Text('${q.customerName}  •  ${q.quotationNo}',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text(
                '${_dateText(q.quotationDate)}  •  ${_money(q.grandTotal)}',
              ),
              trailing: Text(
                q.status.label,
                style: TextStyle(
                    fontWeight: FontWeight.w700, color: _statusColor(q.status)),
              ),
              onTap: () => context.push('/quotation-pdf', extra: q.id),
            ),
          ),
      ],
    );
  }
}
