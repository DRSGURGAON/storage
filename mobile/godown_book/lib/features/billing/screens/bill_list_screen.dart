import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/widgets/confirm_delete_dialog.dart';
import '../../../shared/widgets/document_actions_sheet.dart';
import '../models/bill_model.dart';
import '../providers/billing_provider.dart';
import '../repositories/billing_repository.dart';

class BillListScreen extends ConsumerStatefulWidget {
  const BillListScreen({super.key});

  @override
  ConsumerState<BillListScreen> createState() => _BillListScreenState();
}

class _BillListScreenState extends ConsumerState<BillListScreen> {
  final _search = TextEditingController();
  bool _dueOnly = false;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bills = ref.watch(billListProvider);
    final query = _search.text.trim().toLowerCase();

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/dashboard'),
        ),
        title: const Text('Storage Bills'),
        centerTitle: true,
        actions: [
          IconButton(
            tooltip: _dueOnly ? 'Showing unpaid only' : 'Show unpaid only',
            icon: Icon(_dueOnly ? Icons.filter_alt : Icons.filter_alt_outlined),
            onPressed: () => setState(() => _dueOnly = !_dueOnly),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          await context.push('/bill-create');
          ref.invalidate(billListProvider);
        },
        icon: const Icon(Icons.add),
        label: const Text('New Bill'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: TextField(
              controller: _search,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: 'Search customer, phone or bill no',
                prefixIcon: const Icon(Icons.search),
                isDense: true,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),
          Expanded(
            child: bills.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, s) => Center(child: Text(e.toString())),
              data: (all) {
                final list = all.where((b) {
                  if (_dueOnly && b.isSettled) return false;
                  if (query.isEmpty) return true;
                  return b.customerName.toLowerCase().contains(query) ||
                      b.customerPhone.contains(query) ||
                      b.billNo.toLowerCase().contains(query);
                }).toList();

                if (list.isEmpty) {
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(32),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.receipt_long_outlined, size: 48),
                          const SizedBox(height: 12),
                          Text(
                            all.isEmpty
                                ? 'No bills yet.\nRaise one from a storage record or tap New Bill.'
                                : 'Nothing matches.',
                            textAlign: TextAlign.center,
                          ),
                        ],
                      ),
                    ),
                  );
                }

                final outstanding =
                    list.fold(0.0, (sum, b) => sum + b.balanceDue);

                return Column(
                  children: [
                    if (outstanding > 0)
                      Container(
                        width: double.infinity,
                        color: Colors.red.shade50,
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        child: Text(
                          'Outstanding on these bills: ₹${outstanding.toStringAsFixed(0)}',
                          style: TextStyle(
                            color: Colors.red.shade900,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    Expanded(
                      child: RefreshIndicator(
                        onRefresh: () async => ref.invalidate(billListProvider),
                        child: ListView.builder(
                          padding: const EdgeInsets.fromLTRB(12, 4, 12, 96),
                          itemCount: list.length,
                          itemBuilder: (context, index) {
                            final bill = list[index];
                            final status = bill.derivedStatus;
                            return Card(
                              margin: const EdgeInsets.symmetric(vertical: 6),
                              child: ListTile(
                                leading: CircleAvatar(
                                  backgroundColor:
                                      billStatusColor(status).withValues(alpha: 0.15),
                                  foregroundColor: billStatusColor(status),
                                  child: const Icon(Icons.receipt_long_outlined, size: 18),
                                ),
                                title: Text(
                                  bill.billNo.isEmpty ? 'Draft' : bill.billNo,
                                  style: const TextStyle(fontWeight: FontWeight.w600),
                                ),
                                subtitle: Text(
                                  '${bill.customerName}  •  ${status.label}'
                                  '${bill.periodFrom.isEmpty ? '' : '\n${_short(bill.periodFrom)} to ${_short(bill.periodTo)}'}',
                                ),
                                isThreeLine: bill.periodFrom.isNotEmpty,
                                trailing: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    Text('₹${bill.grandTotal.toStringAsFixed(0)}',
                                        style: const TextStyle(fontWeight: FontWeight.bold)),
                                    if (bill.balanceDue > 0)
                                      Text('due ₹${bill.balanceDue.toStringAsFixed(0)}',
                                          style: TextStyle(
                                              fontSize: 12, color: Colors.red.shade700)),
                                  ],
                                ),
                                onTap: () => showBillActions(context, bill, () {
                                  ref.invalidate(billListProvider);
                                  ref.invalidate(paymentListProvider);
                                }),
                              ),
                            );
                          },
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  static String _short(String iso) {
    final d = DateTime.tryParse(iso);
    if (d == null) return iso;
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${d.day} ${months[d.month - 1]} ${d.year}';
  }
}

Color billStatusColor(BillStatus status) => switch (status) {
      BillStatus.draft => Colors.grey,
      BillStatus.sent => const Color(0xff0D47A1),
      BillStatus.partlyPaid => const Color(0xffB35C00),
      BillStatus.paid => const Color(0xff2E7D32),
      BillStatus.overdue => const Color(0xffC62828),
    };

Future<void> showBillActions(
  BuildContext context,
  BillModel bill,
  VoidCallback onChanged,
) {
  return DocumentActionsSheet.show(
    context,
    title: bill.billNo.isEmpty ? 'Bill' : bill.billNo,
    subtitle: '${bill.customerName}  •  ₹${bill.grandTotal.toStringAsFixed(0)}'
        '${bill.balanceDue > 0 ? '  •  due ₹${bill.balanceDue.toStringAsFixed(0)}' : ''}',
    customerPhone: bill.customerPhone,
    whatsAppMessage:
        'Hello ${bill.customerName}, sharing your storage bill ${bill.billNo} '
        'for ₹${bill.grandTotal.toStringAsFixed(0)}.',
    actions: [
      DocumentAction(
        icon: Icons.picture_as_pdf_outlined,
        label: 'View / Share PDF',
        subtitle: 'Opens the bill, with print and share',
        color: Theme.of(context).colorScheme.tertiary,
        onTap: () async {
          await context.push('/bill-pdf', extra: bill.id);
          onChanged();
        },
      ),
      if (bill.balanceDue > 0)
        DocumentAction(
          icon: Icons.payments_outlined,
          label: 'Receive Payment',
          subtitle: '₹${bill.balanceDue.toStringAsFixed(0)} still due',
          color: const Color(0xff2E7D32),
          onTap: () async {
            final paymentId = await context.push('/payment-create', extra: {'billId': bill.id});
            onChanged();
            if (paymentId is String && context.mounted) {
              await context.push('/receipt-pdf', extra: paymentId);
              onChanged();
            }
          },
        ),
      DocumentAction(
        icon: Icons.edit_outlined,
        label: 'Edit Bill',
        subtitle: 'Same bill number, updated charges',
        onTap: () async {
          await context.push('/bill-edit', extra: bill.id);
          onChanged();
        },
      ),
      if (bill.derivedStatus == BillStatus.draft)
        DocumentAction(
          icon: Icons.send_outlined,
          label: 'Mark Sent',
          onTap: () async {
            await BillingRepository.instance.setBillStatus(bill.id, BillStatus.sent);
            onChanged();
          },
        ),
      DocumentAction(
        icon: Icons.delete_outline,
        label: 'Delete Bill',
        isDestructive: true,
        onTap: () async {
          if (!await confirmDelete(
            context,
            what: 'bill',
            warning: 'The bill will be deleted. Receipts already issued against '
                'it stay on the customer\'s account.',
          )) {
            return;
          }
          await BillingRepository.instance.deleteBill(bill.id);
          onChanged();
        },
      ),
    ],
  );
}
