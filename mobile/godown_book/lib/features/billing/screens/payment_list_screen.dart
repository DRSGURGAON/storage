import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/widgets/confirm_delete_dialog.dart';
import '../../../shared/widgets/document_actions_sheet.dart';
import '../models/payment_model.dart';
import '../providers/billing_provider.dart';
import '../repositories/billing_repository.dart';

class PaymentListScreen extends ConsumerStatefulWidget {
  const PaymentListScreen({super.key});

  @override
  ConsumerState<PaymentListScreen> createState() => _PaymentListScreenState();
}

class _PaymentListScreenState extends ConsumerState<PaymentListScreen> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final payments = ref.watch(paymentListProvider);
    final query = _search.text.trim().toLowerCase();

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/dashboard'),
        ),
        title: const Text('Payment Receipts'),
        centerTitle: true,
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final paymentId = await context.push('/payment-create');
          ref.invalidate(paymentListProvider);
          ref.invalidate(billListProvider);
          if (paymentId is String && context.mounted) {
            await context.push('/receipt-pdf', extra: paymentId);
            ref.invalidate(paymentListProvider);
          }
        },
        icon: const Icon(Icons.add),
        label: const Text('Receive Payment'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: TextField(
              controller: _search,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: 'Search customer, phone or receipt no',
                prefixIcon: const Icon(Icons.search),
                isDense: true,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),
          Expanded(
            child: payments.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, s) => Center(child: Text(e.toString())),
              data: (all) {
                final list = all.where((p) {
                  if (query.isEmpty) return true;
                  return p.payerName.toLowerCase().contains(query) ||
                      p.payerPhone.contains(query) ||
                      p.receiptNo.toLowerCase().contains(query);
                }).toList();

                if (list.isEmpty) {
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(32),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.payments_outlined, size: 48),
                          const SizedBox(height: 12),
                          Text(
                            all.isEmpty
                                ? 'No payments yet.\nTap Receive Payment when money comes in.'
                                : 'Nothing matches.',
                            textAlign: TextAlign.center,
                          ),
                        ],
                      ),
                    ),
                  );
                }

                return RefreshIndicator(
                  onRefresh: () async => ref.invalidate(paymentListProvider),
                  child: ListView.builder(
                    padding: const EdgeInsets.fromLTRB(12, 4, 12, 96),
                    itemCount: list.length,
                    itemBuilder: (context, index) {
                      final payment = list[index];
                      return Card(
                        margin: const EdgeInsets.symmetric(vertical: 6),
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor: payment.isCreditNote
                                ? const Color(0xffFFF3E0)
                                : null,
                            child: Icon(
                              payment.isCreditNote
                                  ? Icons.remove_circle_outline
                                  : Icons.payments_outlined,
                              size: 18,
                            ),
                          ),
                          title: Text(
                            payment.receiptNo.isEmpty ? 'Receipt' : payment.receiptNo,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          subtitle: Text(
                            '${payment.payerName}  •  '
                            '${payment.isCreditNote ? 'Credit note' : payment.mode.label}'
                            '${payment.against.isEmpty ? '' : '  •  ${payment.against}'}',
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          trailing: Text(
                            '${payment.isCreditNote ? '- ' : ''}'
                            '₹${payment.amount.toStringAsFixed(0)}',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              color: payment.isCreditNote
                                  ? const Color(0xffB35C00)
                                  : const Color(0xff2E7D32),
                            ),
                          ),
                          onTap: () => _showActions(payment),
                        ),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _showActions(PaymentModel payment) {
    void refresh() {
      ref.invalidate(paymentListProvider);
      ref.invalidate(billListProvider);
    }

    return DocumentActionsSheet.show(
      context,
      title: payment.receiptNo,
      subtitle: '${payment.payerName}  •  ₹${payment.amount.toStringAsFixed(0)}',
      customerPhone: payment.payerPhone,
      whatsAppMessage: payment.isCreditNote
          ? 'Hello ${payment.payerName}, sharing credit note ${payment.receiptNo} '
              'for ₹${payment.amount.toStringAsFixed(0)} against your account.'
          : 'Hello ${payment.payerName}, sharing the receipt ${payment.receiptNo} '
              'for ₹${payment.amount.toStringAsFixed(0)} received. Thank you.',
      actions: [
        DocumentAction(
          icon: Icons.picture_as_pdf_outlined,
          label: 'View / Share PDF',
          color: Theme.of(context).colorScheme.tertiary,
          onTap: () async {
            await context.push('/receipt-pdf', extra: payment.id);
            refresh();
          },
        ),
        DocumentAction(
          icon: Icons.delete_outline,
          label: payment.isCreditNote ? 'Delete Credit Note' : 'Delete Receipt',
          isDestructive: true,
          onTap: () async {
            if (!await confirmDelete(
              context,
              what: payment.isCreditNote ? 'credit note' : 'receipt',
              warning: payment.isCreditNote
                  ? 'The credit note will be deleted and the amount put back '
                      'on the bill.'
                  : 'The receipt will be deleted and the money taken off the '
                      'bill it settled.',
            )) {
              return;
            }
            await BillingRepository.instance.deletePayment(payment.id);
            refresh();
          },
        ),
      ],
    );
  }
}
