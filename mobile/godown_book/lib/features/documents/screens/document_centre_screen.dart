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
  creditNote,
  release,
  notice,
  incident,
  bilty;

  String get label => switch (this) {
        DocumentKind.quotation => 'Quotations',
        DocumentKind.storageReceipt => 'Storage Receipts',
        DocumentKind.bill => 'Bills',
        DocumentKind.receipt => 'Payment Receipts',
        DocumentKind.creditNote => 'Credit Notes',
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
        DocumentKind.creditNote => 'Credit Note',
        DocumentKind.release => 'Release Record',
        DocumentKind.notice => 'Notice Letter',
        DocumentKind.incident => 'Damage / Loss Report',
        DocumentKind.bilty => 'Bilty / Lorry Receipt',
      };

  /// Where a new one of these is made. Null when it is only ever made
  /// from somewhere else (a credit note starts from a bill).
  String? get createRoute => switch (this) {
        DocumentKind.quotation => '/quotation-create',
        DocumentKind.storageReceipt => '/storage-create',
        DocumentKind.bill => '/bill-create',
        DocumentKind.receipt => '/payment-create',
        DocumentKind.creditNote => null,
        DocumentKind.release => '/release-create',
        DocumentKind.notice => '/notice-create',
        DocumentKind.incident => '/incident-create',
        DocumentKind.bilty => '/bilty-create',
      };

  IconData get icon => switch (this) {
        DocumentKind.quotation => Icons.request_quote_outlined,
        DocumentKind.storageReceipt => Icons.inventory_2_outlined,
        DocumentKind.bill => Icons.receipt_long_outlined,
        DocumentKind.receipt => Icons.payments_outlined,
        DocumentKind.creditNote => Icons.remove_circle_outline,
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
  /// The folder that is open; null shows the folders themselves.
  DocumentKind? _folder;

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
        kind: payment.isCreditNote ? DocumentKind.creditNote : DocumentKind.receipt,
        id: payment.id,
        number: payment.receiptNo,
        customerName: payment.payerName,
        customerPhone: payment.payerPhone,
        date: payment.paymentDate,
        amount: payment.amount,
        status: payment.isCreditNote ? payment.paymentType.label : payment.mode.label,
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
      if (_folder != null && row.kind != _folder) return false;

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
      case DocumentKind.creditNote:
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
    final folder = _folder;
    final searching = _search.text.trim().isNotEmpty;
    // A folder, or a search across every folder, shows the list; with
    // neither, the folders themselves.
    final showList = folder != null || searching;
    final list = showList ? _filtered : const <DocumentRow>[];

    return Scaffold(
      appBar: AppBar(
        // A tab root has the bar below it; a customer's own document
        // list is pushed on top and gets a way back. Inside a folder,
        // back closes the folder first.
        automaticallyImplyLeading: false,
        leading: folder != null
            ? IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () => setState(() => _folder = null),
              )
            : context.canPop()
                ? IconButton(
                    icon: const Icon(Icons.arrow_back),
                    onPressed: () => context.pop(),
                  )
                : null,
        title: Text(folder == null ? 'Documents' : folder.label),
        centerTitle: true,
      ),
      floatingActionButton: folder == null || folder.createRoute == null
          ? null
          : FloatingActionButton.extended(
              onPressed: () async {
                await context.push(folder.createRoute!);
                _load();
              },
              icon: const Icon(Icons.add),
              label: Text('New ${folder.singular}'),
            ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: TextField(
              controller: _search,
              onChanged: (_) => setState(() {}),
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: folder == null
                    ? 'Search every document'
                    : 'Search in ${folder.label.toLowerCase()}',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: searching
                    ? IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () => setState(_search.clear),
                      )
                    : null,
                isDense: true,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),
          if (showList)
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
                : !showList
                    ? _folders()
                    : list.isEmpty
                        ? Center(
                            child: Padding(
                              padding: const EdgeInsets.all(32),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(folder?.icon ?? Icons.folder_open_outlined, size: 48),
                                  const SizedBox(height: 12),
                                  Text(
                                    folder != null && !searching
                                        ? 'No ${folder.label.toLowerCase()} yet.'
                                            '${folder.createRoute == null ? '' : '\nTap New ${folder.singular} to make the first one.'}'
                                        : 'Nothing matches.',
                                    textAlign: TextAlign.center,
                                  ),
                                ],
                              ),
                            ),
                          )
                        : RefreshIndicator(
                            onRefresh: _load,
                            child: ListView.builder(
                              padding: const EdgeInsets.fromLTRB(12, 4, 12, 96),
                              itemCount: list.length,
                              itemBuilder: (context, index) => _rowTile(list[index]),
                            ),
                          ),
          ),
        ],
      ),
    );
  }

  /// One tile per kind of paper, with how many there are. The old
  /// list is behind each one, and the New button with it - the way a
  /// person keeps paper: bills in the bills file, and a blank on top.
  Widget _folders() {
    final counts = <DocumentKind, int>{};
    for (final row in _rows) {
      counts[row.kind] = (counts[row.kind] ?? 0) + 1;
    }

    return GridView.count(
      crossAxisCount: 2,
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      childAspectRatio: 1.45,
      children: [
        for (final kind in DocumentKind.values)
          Card(
            child: InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: () => setState(() => _folder = kind),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(kind.icon, color: Theme.of(context).colorScheme.primary),
                    const Spacer(),
                    Text(kind.label,
                        style: const TextStyle(fontWeight: FontWeight.w700)),
                    Text(
                      '${counts[kind] ?? 0}',
                      style: const TextStyle(fontSize: 12, color: Colors.black54),
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _rowTile(DocumentRow row) {
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 5),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: Theme.of(context).colorScheme.primaryContainer,
          foregroundColor: Theme.of(context).colorScheme.onPrimaryContainer,
          child: Icon(row.kind.icon, size: 18),
        ),
        title: Text(
          row.number.isEmpty ? row.kind.singular : row.number,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          '${_folder == null ? '${row.kind.singular}  •  ' : ''}${row.customerName}\n'
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
