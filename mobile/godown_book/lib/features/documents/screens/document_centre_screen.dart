import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../billing/repositories/billing_repository.dart';
import '../../quotation/repositories/quotation_repository.dart';
import '../../consignment/repositories/consignment_repository.dart';
import '../../incidents/repositories/incident_repository.dart';
import '../../notices/repositories/notice_repository.dart';
import '../../release/repositories/goods_release_repository.dart';
import '../../storage_booking/repositories/storage_booking_repository.dart';

/// What kind of paper a row is.
enum DocumentKind {
  quotation,
  storageReceipt,
  bill,
  receipt,
  release,
  notice,
  incident,
  bilty;

  String get label => switch (this) {
        DocumentKind.quotation => 'Quotations',
        DocumentKind.storageReceipt => 'Storage Receipts',
        DocumentKind.bill => 'Bills',
        DocumentKind.receipt => 'Payment Receipts',
        DocumentKind.release => 'Releases',
        DocumentKind.notice => 'Notices',
        DocumentKind.incident => 'Damage / Loss',
        DocumentKind.bilty => 'Bilty / LR',
      };

  String get singular => switch (this) {
        DocumentKind.quotation => 'Quotation',
        DocumentKind.storageReceipt => 'Storage Receipt',
        DocumentKind.bill => 'Storage Bill',
        DocumentKind.receipt => 'Payment Receipt',
        DocumentKind.release => 'Release Record',
        DocumentKind.notice => 'Notice Letter',
        DocumentKind.incident => 'Damage / Loss Report',
        DocumentKind.bilty => 'Bilty / Lorry Receipt',
      };

  IconData get icon => switch (this) {
        DocumentKind.quotation => Icons.request_quote_outlined,
        DocumentKind.storageReceipt => Icons.inventory_2_outlined,
        DocumentKind.bill => Icons.receipt_long_outlined,
        DocumentKind.receipt => Icons.payments_outlined,
        DocumentKind.release => Icons.outbox_outlined,
        DocumentKind.notice => Icons.mail_outline,
        DocumentKind.incident => Icons.report_gmailerrorred_outlined,
        DocumentKind.bilty => Icons.fire_truck_outlined,
      };
}

/// One row in the centre - whatever the document is, reduced to what a
/// person looks for: who, when, which number, how much, and where it
/// stands.
class DocumentRow {
  final DocumentKind kind;
  final String id;
  final String number;
  final String customerName;
  final String customerPhone;
  final String date;
  final double amount;
  final String status;

  const DocumentRow({
    required this.kind,
    required this.id,
    required this.number,
    required this.customerName,
    this.customerPhone = '',
    required this.date,
    this.amount = 0,
    this.status = '',
  });
}

/// Every document the app has made, in one place, searchable.
class DocumentCentreScreen extends StatefulWidget {
  /// Open showing only this customer's documents.
  final String? customerId;

  const DocumentCentreScreen({super.key, this.customerId});

  @override
  State<DocumentCentreScreen> createState() => _DocumentCentreScreenState();
}

class _DocumentCentreScreenState extends State<DocumentCentreScreen> {
  static final _dateFormat = DateFormat('dd MMM yyyy');

  final _search = TextEditingController();
  final Set<DocumentKind> _kinds = {...DocumentKind.values};

  List<DocumentRow> _rows = const [];
  bool _loading = true;
  DateTime? _from;
  DateTime? _to;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final rows = <DocumentRow>[];

    bool mine(String customerId) =>
        widget.customerId == null || widget.customerId == customerId;

    for (final q in await QuotationRepository.instance.getAll()) {
      if (!mine(q.customerId)) continue;
      rows.add(DocumentRow(
        kind: DocumentKind.quotation,
        id: q.id,
        number: q.quotationNo,
        customerName: q.customerName,
        customerPhone: q.customerPhone,
        date: q.quotationDate,
        amount: q.grandTotal,
        status: q.status.label,
      ));
    }

    for (final b in await StorageBookingRepository.instance.getAll()) {
      if (!mine(b.customerId)) continue;
      rows.add(DocumentRow(
        kind: DocumentKind.storageReceipt,
        id: b.id,
        number: b.bookingNo,
        customerName: b.customerName,
        customerPhone: b.customerPhone,
        date: b.bookingDate,
        status: b.status.label,
      ));
    }

    for (final bill in await BillingRepository.instance.getAllBills()) {
      if (!mine(bill.customerId)) continue;
      rows.add(DocumentRow(
        kind: DocumentKind.bill,
        id: bill.id,
        number: bill.billNo,
        customerName: bill.customerName,
        customerPhone: bill.customerPhone,
        date: bill.billDate,
        amount: bill.grandTotal,
        status: bill.derivedStatus.label,
      ));
    }

    for (final payment in await BillingRepository.instance.getAllPayments()) {
      if (!mine(payment.customerId)) continue;
      rows.add(DocumentRow(
        kind: DocumentKind.receipt,
        id: payment.id,
        number: payment.receiptNo,
        customerName: payment.payerName,
        customerPhone: payment.payerPhone,
        date: payment.paymentDate,
        amount: payment.amount,
        status: payment.mode.label,
      ));
    }

    for (final release in await GoodsReleaseRepository.instance.getAll()) {
      rows.add(DocumentRow(
        kind: DocumentKind.release,
        id: release.id,
        number: release.releaseNo,
        customerName: release.customerName,
        customerPhone: release.customerPhone,
        date: release.releaseDate,
        status: release.releaseType.label,
      ));
    }

    for (final notice in await NoticeRepository.instance.getAll()) {
      if (!mine(notice.customerId)) continue;
      rows.add(DocumentRow(
        kind: DocumentKind.notice,
        id: notice.id,
        number: notice.noticeNo,
        customerName: notice.customerName,
        customerPhone: notice.customerPhone,
        date: notice.noticeDate,
        amount: notice.amountDue,
        status: notice.kind.label,
      ));
    }

    for (final report in await IncidentRepository.instance.getAll()) {
      if (!mine(report.customerId)) continue;
      rows.add(DocumentRow(
        kind: DocumentKind.incident,
        id: report.id,
        number: report.reportNo,
        customerName:
            report.customerName.isEmpty ? 'Godown' : report.customerName,
        customerPhone: report.customerPhone,
        date: report.reportDate,
        amount: report.estimatedLoss,
        status: report.kind.label,
      ));
    }

    for (final bilty in await ConsignmentRepository.instance.getAll()) {
      if (!mine(bilty.customerId)) continue;
      rows.add(DocumentRow(
        kind: DocumentKind.bilty,
        id: bilty.id,
        number: bilty.lrNo,
        customerName: bilty.consignorName,
        customerPhone: bilty.consignorPhone,
        date: bilty.lrDate,
        amount: bilty.freightTotal,
        status: bilty.status.label,
      ));
    }

    rows.sort((a, b) => b.date.compareTo(a.date));

    if (!mounted) return;
    setState(() {
      _rows = rows;
      _loading = false;
    });
  }

  List<DocumentRow> get _filtered {
    final query = _search.text.trim().toLowerCase();

    return _rows.where((row) {
      if (!_kinds.contains(row.kind)) return false;

      final date = DateTime.tryParse(row.date);
      if (_from != null && date != null && date.isBefore(_from!)) return false;
      if (_to != null &&
          date != null &&
          date.isAfter(_to!.add(const Duration(days: 1)))) {
        return false;
      }

      if (query.isEmpty) return true;
      return row.customerName.toLowerCase().contains(query) ||
          row.customerPhone.contains(query) ||
          row.number.toLowerCase().contains(query);
    }).toList();
  }

  Future<void> _open(DocumentRow row) async {
    switch (row.kind) {
      case DocumentKind.quotation:
        await context.push('/quotation-pdf', extra: row.id);
      case DocumentKind.storageReceipt:
        await context.push('/storage-pdf', extra: {'id': row.id, 'kind': 'receipt'});
      case DocumentKind.bill:
        await context.push('/bill-pdf', extra: row.id);
      case DocumentKind.receipt:
        await context.push('/receipt-pdf', extra: row.id);
      case DocumentKind.release:
        await context.push('/release-pdf', extra: row.id);
      case DocumentKind.notice:
        await context.push('/notice-pdf', extra: row.id);
      case DocumentKind.incident:
        await context.push('/incident-pdf', extra: row.id);
      case DocumentKind.bilty:
        await context.push('/bilty-pdf', extra: row.id);
    }
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final list = _filtered;

    return Scaffold(
      appBar: AppBar(
        // A tab root has the bar below it; a customer's own document
        // list is pushed on top and gets a way back.
        automaticallyImplyLeading: false,
        leading: context.canPop()
            ? IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () => context.pop(),
              )
            : null,
        title: const Text('Documents'),
        centerTitle: true,
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: TextField(
              controller: _search,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: 'Search customer, phone or document number',
                prefixIcon: const Icon(Icons.search),
                isDense: true,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),
          SizedBox(
            height: 46,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: [
                for (final kind in DocumentKind.values)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    child: FilterChip(
                      label: Text(kind.label, style: const TextStyle(fontSize: 12)),
                      selected: _kinds.contains(kind),
                      onSelected: (on) => setState(() {
                        if (on) {
                          _kinds.add(kind);
                        } else if (_kinds.length > 1) {
                          _kinds.remove(kind);
                        }
                      }),
                    ),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: Row(
              children: [
                Expanded(child: _dateTile('From', _from, (d) => _from = d)),
                const SizedBox(width: 12),
                Expanded(child: _dateTile('To', _to, (d) => _to = d)),
              ],
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : list.isEmpty
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(32),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.folder_open_outlined, size: 48),
                              const SizedBox(height: 12),
                              Text(
                                _rows.isEmpty
                                    ? 'No documents yet.\nWhatever you make will be listed here.'
                                    : 'Nothing matches these filters.',
                                textAlign: TextAlign.center,
                              ),
                            ],
                          ),
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: _load,
                        child: ListView.builder(
                          padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
                          itemCount: list.length,
                          itemBuilder: (context, index) {
                            final row = list[index];
                            return Card(
                              margin: const EdgeInsets.symmetric(vertical: 5),
                              child: ListTile(
                                leading: CircleAvatar(
                                  backgroundColor: Theme.of(context)
                                      .colorScheme
                                      .primaryContainer,
                                  foregroundColor: Theme.of(context)
                                      .colorScheme
                                      .onPrimaryContainer,
                                  child: Icon(row.kind.icon, size: 18),
                                ),
                                title: Text(
                                  row.number.isEmpty ? row.kind.singular : row.number,
                                  style: const TextStyle(fontWeight: FontWeight.w600),
                                ),
                                subtitle: Text(
                                  '${row.kind.singular}  •  ${row.customerName}\n'
                                  '${_short(row.date)}${row.status.isEmpty ? '' : '  •  ${row.status}'}',
                                ),
                                isThreeLine: true,
                                trailing: row.amount > 0
                                    ? Text('₹${row.amount.toStringAsFixed(0)}',
                                        style: const TextStyle(fontWeight: FontWeight.bold))
                                    : const Icon(Icons.chevron_right),
                                onTap: () => _open(row),
                              ),
                            );
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _dateTile(String label, DateTime? value, ValueChanged<DateTime?> onPicked) {
    return InkWell(
      onTap: () async {
        final picked = await showDatePicker(
          context: context,
          initialDate: value ?? DateTime.now(),
          firstDate: DateTime(2015),
          lastDate: DateTime(2100),
        );
        if (picked != null) setState(() => onPicked(picked));
      },
      borderRadius: BorderRadius.circular(8),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          isDense: true,
          suffixIcon: value == null
              ? const Icon(Icons.calendar_today_outlined, size: 18)
              : IconButton(
                  icon: const Icon(Icons.clear, size: 18),
                  onPressed: () => setState(() => onPicked(null)),
                ),
        ),
        child: Text(value == null ? 'Any' : _dateFormat.format(value)),
      ),
    );
  }

  static String _short(String iso) {
    final d = DateTime.tryParse(iso);
    return d == null ? iso : _dateFormat.format(d);
  }
}
