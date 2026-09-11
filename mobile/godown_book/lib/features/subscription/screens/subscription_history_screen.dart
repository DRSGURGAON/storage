import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/tenant/tenant_scope.dart';
import '../models/subscription_history_model.dart';
import '../repositories/subscription_repository.dart';

/// Section 23's "SUBSCRIPTION HISTORY" - every past period, never
/// edited or deleted.
class SubscriptionHistoryScreen extends StatefulWidget {
  const SubscriptionHistoryScreen({super.key});

  @override
  State<SubscriptionHistoryScreen> createState() =>
      _SubscriptionHistoryScreenState();
}

class _SubscriptionHistoryScreenState
    extends State<SubscriptionHistoryScreen> {
  List<SubscriptionHistoryModel> _history = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    if (!TenantScope.isReady) {
      if (!mounted) return;
      setState(() => _loading = false);
      return;
    }

    final history = await SubscriptionRepository.instance.getHistory(
      TenantScope.companyId,
    );

    if (!mounted) return;

    setState(() {
      _history = history;
      _loading = false;
    });
  }

  String _date(String iso) {
    final parsed = DateTime.tryParse(iso);
    if (parsed == null) return '-';
    return '${parsed.day.toString().padLeft(2, '0')}/'
        '${parsed.month.toString().padLeft(2, '0')}/${parsed.year}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/subscription'),
        ),
        title: const Text('Subscription History'),
        centerTitle: true,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _history.isEmpty
              ? const Center(child: Text('No subscription history yet.'))
              : ListView.builder(
                  padding: const EdgeInsets.all(12),
                  itemCount: _history.length,
                  itemBuilder: (context, index) {
                    final entry = _history[index];

                    return Card(
                      margin: const EdgeInsets.symmetric(vertical: 4),
                      child: ListTile(
                        title: Text(
                          '${entry.planName}  •  ₹${entry.amount.toStringAsFixed(0)}',
                        ),
                        subtitle: Text(
                          '${_date(entry.startDate)} → ${_date(entry.endDate)}'
                          '${entry.paymentMethod != null ? '  •  ${entry.paymentMethod}' : ''}',
                        ),
                        trailing: Text(entry.status.label),
                      ),
                    );
                  },
                ),
    );
  }
}
