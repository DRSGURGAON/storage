import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../models/consignment_model.dart';
import '../repositories/consignment_repository.dart';

/// Every bilty, newest first - who sent it, where it went, and whether
/// it has reached.
class ConsignmentListScreen extends StatefulWidget {
  const ConsignmentListScreen({super.key});

  @override
  State<ConsignmentListScreen> createState() => _ConsignmentListScreenState();
}

class _ConsignmentListScreenState extends State<ConsignmentListScreen> {
  static final _dateFormat = DateFormat('dd MMM yyyy');

  List<ConsignmentModel> _consignments = const [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final consignments = await ConsignmentRepository.instance.getAll();
    if (!mounted) return;
    setState(() {
      _consignments = consignments;
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
        title: const Text('Bilty / Lorry Receipts'),
        centerTitle: true,
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final id = await context.push('/bilty-create');
          await _load();
          if (id is String && context.mounted) {
            await context.push('/bilty-pdf', extra: id);
            await _load();
          }
        },
        icon: const Icon(Icons.fire_truck_outlined),
        label: const Text('New Bilty'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _consignments.isEmpty
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(32),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.fire_truck_outlined, size: 48),
                        SizedBox(height: 12),
                        Text(
                          'No bilty yet.\nWhen goods move by truck, make a bilty '
                          '- it is the paper every claim and every checkpost '
                          'asks for.',
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
                    itemCount: _consignments.length,
                    separatorBuilder: (context, index) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final c = _consignments[index];
                      return ListTile(
                        leading: Icon(
                          c.isDelivered
                              ? Icons.check_circle_outline
                              : Icons.local_shipping_outlined,
                          color: c.isDelivered ? Colors.green.shade700 : null,
                        ),
                        title: Text(
                          c.consignorName,
                          style: const TextStyle(fontWeight: FontWeight.bold),
                        ),
                        subtitle: Text(
                          '${c.lrNo}  ·  ${_dateFormat.format(DateTime.tryParse(c.lrDate) ?? DateTime.now())}'
                          '\n${c.fromPlace.isEmpty ? '-' : c.fromPlace} → '
                          '${c.toPlace.isEmpty ? '-' : c.toPlace}'
                          '  ·  ${c.totalPackages} pkg  ·  ${c.status.label}',
                        ),
                        isThreeLine: true,
                        trailing: c.freightBalance > 0.004 && !c.isDelivered
                            ? Text('₹${c.freightBalance.toStringAsFixed(0)}\nto pay',
                                textAlign: TextAlign.right,
                                style: const TextStyle(
                                    fontSize: 11, color: Colors.deepOrange))
                            : const Icon(Icons.chevron_right),
                        onTap: () async {
                          await context.push('/bilty-pdf', extra: c.id);
                          await _load();
                        },
                      );
                    },
                  ),
                ),
    );
  }
}
