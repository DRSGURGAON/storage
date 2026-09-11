import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../models/incident_model.dart';
import '../repositories/incident_repository.dart';

/// Everything that has gone wrong in the godown, newest first.
class IncidentListScreen extends StatefulWidget {
  const IncidentListScreen({super.key});

  @override
  State<IncidentListScreen> createState() => _IncidentListScreenState();
}

class _IncidentListScreenState extends State<IncidentListScreen> {
  static final _dateFormat = DateFormat('dd MMM yyyy');

  List<IncidentModel> _reports = const [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final reports = await IncidentRepository.instance.getAll();
    if (!mounted) return;
    setState(() {
      _reports = reports;
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
        title: const Text('Damage / Loss Reports'),
        centerTitle: true,
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final id = await context.push('/incident-create');
          await _load();
          if (id is String && context.mounted) {
            await context.push('/incident-pdf', extra: id);
            await _load();
          }
        },
        icon: const Icon(Icons.report_gmailerrorred_outlined),
        label: const Text('New Report'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _reports.isEmpty
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(32),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.report_gmailerrorred_outlined, size: 48),
                        SizedBox(height: 12),
                        Text(
                          'Nothing reported - good.\nIf goods are damaged, lost '
                          'or stolen, write it down the same day with photos.',
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
                    itemCount: _reports.length,
                    separatorBuilder: (context, index) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final report = _reports[index];
                      return ListTile(
                        leading: const Icon(Icons.report_gmailerrorred_outlined,
                            color: Colors.deepOrange),
                        title: Text(
                          report.customerName.isEmpty
                              ? report.kind.label
                              : '${report.kind.label}  ·  ${report.customerName}',
                          style: const TextStyle(fontWeight: FontWeight.bold),
                        ),
                        subtitle: Text(
                          '${_date(report.happenedOn.isEmpty ? report.reportDate : report.happenedOn)}'
                          '  ·  ${report.reportNo}'
                          '${report.bookingNo.isEmpty ? '' : '  ·  ${report.bookingNo}'}',
                        ),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () async {
                          await context.push('/incident-pdf', extra: report.id);
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
