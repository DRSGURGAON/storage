import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/contact/contact_launcher.dart';
import '../../core/contact/whatsapp_templates.dart';
import '../dashboard/services/dashboard_stats_service.dart';
import '../quotation/models/quotation_model.dart';
import '../quotation/repositories/quotation_repository.dart';
import 'follow_up_service.dart';

final _inr = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 0);

/// Who to call and why: today's calls (quotation follow-ups, overdue
/// payments, storage past its end date), quotation follow-ups planned
/// for later, and the ones already closed (Booked or Lost).
class FollowUpsScreen extends StatefulWidget {
  const FollowUpsScreen({super.key});

  @override
  State<FollowUpsScreen> createState() => _FollowUpsScreenState();
}

class _FollowUpsScreenState extends State<FollowUpsScreen> {
  bool _loading = true;
  DashboardStats? _stats;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final stats = await DashboardStatsService.load();
    if (!mounted) return;
    setState(() {
      _stats = stats;
      _loading = false;
    });
  }

  QuotationModel? _quotation(String id) {
    for (final q in _stats?.quotations ?? const <QuotationModel>[]) {
      if (q.id == id) return q;
    }
    return null;
  }

  Future<void> _whatsApp(FollowUpCall call) async {
    final templates = WhatsAppTemplates.instance;
    final text = switch (call.reason) {
      FollowUpReason.quotation => templates.followUp(
          name: call.customerName, number: call.number, amount: call.amount),
      FollowUpReason.payment => templates.paymentReminder(
          name: call.customerName,
          number: call.number,
          balance: call.amount,
          dueDate: call.date,
        ),
      FollowUpReason.storageEnd => templates.storageEnd(
          name: call.customerName, booking: call.number, endDate: call.date),
    };
    await ContactLauncher.openWhatsAppWithChoice(context, call.phone,
        message: text);
  }

  /// "What happened?" after a quotation call: next date, Booked or Lost.
  Future<void> _outcome(QuotationModel q) async {
    final today = DateTime.now();
    DateTime inDays(int n) => DateTime(today.year, today.month, today.day + n);

    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheet) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Text('What happened with ${q.customerName}?',
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            ),
            ListTile(
              leading: const Icon(Icons.check_circle, color: Color(0xff1E9E5A)),
              title: const Text('Booked - customer is coming'),
              onTap: () => Navigator.pop(sheet, 'booked'),
            ),
            ListTile(
              leading: const Icon(Icons.cancel_outlined, color: Color(0xffD64545)),
              title: const Text('Lost - not interested'),
              onTap: () => Navigator.pop(sheet, 'lost'),
            ),
            const Divider(),
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 4, 20, 0),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text('Call again', style: TextStyle(color: Colors.black54)),
              ),
            ),
            ListTile(
              leading: const Icon(Icons.today_outlined),
              title: const Text('Tomorrow'),
              onTap: () => Navigator.pop(sheet, '1'),
            ),
            ListTile(
              leading: const Icon(Icons.date_range_outlined),
              title: const Text('In 3 days'),
              onTap: () => Navigator.pop(sheet, '3'),
            ),
            ListTile(
              leading: const Icon(Icons.event_outlined),
              title: const Text('In a week'),
              onTap: () => Navigator.pop(sheet, '7'),
            ),
            ListTile(
              leading: const Icon(Icons.edit_calendar_outlined),
              title: const Text('Pick a date'),
              onTap: () => Navigator.pop(sheet, 'pick'),
            ),
          ],
        ),
      ),
    );
    if (choice == null || !mounted) return;

    final repo = QuotationRepository.instance;
    switch (choice) {
      case 'booked':
        await repo.setFollowUp(q.id,
            followUpDate: '', status: QuotationStatus.accepted);
        if (!mounted) return;
        // Straight on to the storage entry, with the customer filled in.
        context.push('/storage-create',
            extra: q.customerId.isEmpty ? null : {'customerId': q.customerId});
      case 'lost':
        await repo.setFollowUp(q.id,
            followUpDate: '', status: QuotationStatus.declined);
      case 'pick':
        final picked = await showDatePicker(
          context: context,
          initialDate: inDays(1),
          firstDate: inDays(0),
          lastDate: inDays(365),
        );
        if (picked == null) return;
        await repo.setFollowUp(q.id, followUpDate: picked.toIso8601String());
      default:
        await repo.setFollowUp(q.id,
            followUpDate: inDays(int.parse(choice)).toIso8601String());
    }
    await _load();
  }

  Future<void> _reopen(QuotationModel q) async {
    final today = DateTime.now();
    await QuotationRepository.instance.setFollowUp(
      q.id,
      followUpDate: DateTime(today.year, today.month, today.day).toIso8601String(),
      status: QuotationStatus.sent,
    );
    await _load();
  }

  void _open(FollowUpCall call) {
    switch (call.reason) {
      case FollowUpReason.quotation:
        context.push('/quotation-pdf', extra: call.recordId);
      case FollowUpReason.payment:
        if (call.recordId.isNotEmpty) {
          context.push('/statement', extra: call.recordId);
        }
      case FollowUpReason.storageEnd:
        context.push('/storage-detail', extra: call.recordId);
    }
  }

  static (IconData, Color, String) _look(FollowUpReason reason) =>
      switch (reason) {
        FollowUpReason.quotation =>
          (Icons.description_outlined, const Color(0xffE0731F), 'Quotation'),
        FollowUpReason.payment =>
          (Icons.currency_rupee, const Color(0xffD64545), 'Payment'),
        FollowUpReason.storageEnd =>
          (Icons.event_busy_outlined, const Color(0xff1E6FD9), 'Storage'),
      };

  Widget _callCard(FollowUpCall call) {
    final (icon, color, tag) = _look(call.reason);
    final q = call.reason == FollowUpReason.quotation ? _quotation(call.recordId) : null;
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 5),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 8, 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 18,
                  backgroundColor: color.withValues(alpha: 0.12),
                  child: Icon(icon, color: color, size: 20),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(call.customerName,
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                      Text(call.detail,
                          style: const TextStyle(fontSize: 12.5, color: Colors.black54)),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(tag,
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: color)),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Wrap(
              spacing: 4,
              children: [
                if (call.phone.trim().isNotEmpty) ...[
                  TextButton.icon(
                    onPressed: () => ContactLauncher.call(call.phone),
                    icon: const Icon(Icons.call, size: 18),
                    label: const Text('Call'),
                  ),
                  TextButton.icon(
                    onPressed: () => _whatsApp(call),
                    icon: const Icon(Icons.chat_outlined, size: 18, color: Color(0xff128C4A)),
                    label: const Text('WhatsApp'),
                  ),
                ],
                if (q != null)
                  TextButton.icon(
                    onPressed: () => _outcome(q),
                    icon: const Icon(Icons.task_alt, size: 18),
                    label: const Text('What happened?'),
                  ),
                TextButton(onPressed: () => _open(call), child: const Text('Open')),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _quotationTile(QuotationModel q, DateTime today, {bool closed = false}) {
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: ListTile(
        title: Text('${q.customerName}  •  ${q.quotationNo}',
            style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(closed
            ? q.status == QuotationStatus.accepted ? 'Booked' : 'Lost'
            : 'Call ${FollowUps.dueLabel(q.followUpDate, today).toLowerCase()}'),
        trailing: closed
            ? TextButton(onPressed: () => _reopen(q), child: const Text('Reopen'))
            : IconButton(
                tooltip: 'Change',
                icon: const Icon(Icons.edit_calendar_outlined),
                onPressed: () => _outcome(q),
              ),
        onTap: () => context.push('/quotation-pdf', extra: q.id),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final stats = _stats;
    final today = DateTime.now();
    final calls = stats == null
        ? const <FollowUpCall>[]
        : FollowUps.callsToday(
            quotations: stats.quotations,
            overdueBills: stats.overdueBills,
            pastExpectedEnd: stats.pastExpectedEnd,
            today: today,
            money: _inr.format,
          );
    final upcoming =
        stats == null ? const <QuotationModel>[] : FollowUps.quotationsUpcoming(stats.quotations, today);
    final closed =
        stats == null ? const <QuotationModel>[] : FollowUps.quotationsClosed(stats.quotations);

    Widget list(List<Widget> children, String empty) => RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.all(12),
            children: children.isEmpty
                ? [
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 60),
                      child: Text(empty, textAlign: TextAlign.center),
                    ),
                  ]
                : children,
          ),
        );

    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Follow-ups'),
          bottom: TabBar(
            tabs: [
              Tab(text: 'Call today (${calls.length})'),
              Tab(text: 'Upcoming (${upcoming.length})'),
              const Tab(text: 'Closed'),
            ],
          ),
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : TabBarView(
                children: [
                  list([for (final c in calls) _callCard(c)],
                      'Nobody to call today. 👍'),
                  list([for (final q in upcoming) _quotationTile(q, today)],
                      'No follow-ups planned.'),
                  list([for (final q in closed) _quotationTile(q, today, closed: true)],
                      'Nothing closed yet.'),
                ],
              ),
      ),
    );
  }
}

