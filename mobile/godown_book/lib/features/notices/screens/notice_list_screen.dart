import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../models/notice_model.dart';
import '../repositories/notice_repository.dart';

/// Every letter sent about money owed, newest first. This list is the
/// trail: it shows what was asked, when, and how it went out.
class NoticeListScreen extends StatefulWidget {
  const NoticeListScreen({super.key});

  @override
  State<NoticeListScreen> createState() => _NoticeListScreenState();
}

class _NoticeListScreenState extends State<NoticeListScreen> {
  static final _dateFormat = DateFormat('dd MMM yyyy');

  List<NoticeModel> _notices = const [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final notices = await NoticeRepository.instance.getAll();
    if (!mounted) return;
    setState(() {
      _notices = notices;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/dashboard'),
        ),
        title: const Text('Notices Sent'),
        centerTitle: true,
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final noticeId = await context.push('/notice-create');
          await _load();
          if (noticeId is String && context.mounted) {
            await context.push('/notice-pdf', extra: noticeId);
            await _load();
          }
        },
        icon: const Icon(Icons.mail_outline),
        label: const Text('Send a Notice'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _notices.isEmpty
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(32),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.mail_outline, size: 48),
                        SizedBox(height: 12),
                        Text(
                          'No notice sent yet.\nWhen rent stays unpaid, send a '
                          'reminder from here - and keep the proof.',
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(0, 8, 0, 90),
                    itemCount: _notices.length,
                    separatorBuilder: (context, index) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final notice = _notices[index];
                      return ListTile(
                        leading: Icon(
                          switch (notice.kind) {
                            NoticeKind.reminder => Icons.notifications_outlined,
                            NoticeKind.finalNotice => Icons.warning_amber_outlined,
                            NoticeKind.disposal => Icons.gavel_outlined,
                          },
                          color: switch (notice.kind) {
                            NoticeKind.reminder => Colors.blueGrey,
                            NoticeKind.finalNotice => Colors.deepOrange,
                            NoticeKind.disposal => Colors.red,
                          },
                        ),
                        title: Text(notice.customerName,
                            style: const TextStyle(fontWeight: FontWeight.bold)),
                        subtitle: Text(
                          '${notice.kind.label}  ·  ₹${notice.amountDue.toStringAsFixed(0)}'
                          '\n${_date(notice.noticeDate)}  ·  ${notice.noticeNo}'
                          '${notice.sentVia.isEmpty ? '' : '  ·  ${notice.sentVia}'}',
                        ),
                        isThreeLine: true,
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () async {
                          await context.push('/notice-pdf', extra: notice.id);
                          await _load();
                        },
                      );
                    },
                  ),
                ),
    );
  }

  String _date(String iso) {
    final parsed = DateTime.tryParse(iso);
    return parsed == null ? '-' : _dateFormat.format(parsed);
  }
}
