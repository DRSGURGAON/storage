import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/widgets/confirm_delete_dialog.dart';
import '../../../shared/widgets/document_actions_sheet.dart';
import '../models/quotation_model.dart';
import '../providers/quotation_provider.dart';
import '../repositories/quotation_repository.dart';

class QuotationListScreen extends ConsumerStatefulWidget {
  const QuotationListScreen({super.key});

  @override
  ConsumerState<QuotationListScreen> createState() => _QuotationListScreenState();
}

class _QuotationListScreenState extends ConsumerState<QuotationListScreen> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final quotations = ref.watch(quotationListProvider);
    final query = _search.text.trim().toLowerCase();

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/dashboard'),
        ),
        title: const Text('Quotations'),
        centerTitle: true,
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          await context.push('/quotation-create');
          ref.invalidate(quotationListProvider);
        },
        icon: const Icon(Icons.add),
        label: const Text('New Quotation'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: TextField(
              controller: _search,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: 'Search customer, phone or number',
                prefixIcon: const Icon(Icons.search),
                isDense: true,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),
          Expanded(
            child: quotations.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, s) => Center(child: Text(e.toString())),
              data: (all) {
                final list = all.where((q) {
                  if (query.isEmpty) return true;
                  return q.customerName.toLowerCase().contains(query) ||
                      q.customerPhone.contains(query) ||
                      q.quotationNo.toLowerCase().contains(query);
                }).toList();

                if (list.isEmpty) {
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(32),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.request_quote_outlined, size: 48),
                          const SizedBox(height: 12),
                          Text(
                            all.isEmpty
                                ? 'No quotations yet.\nTap New Quotation to price a job.'
                                : 'Nothing matches.',
                            textAlign: TextAlign.center,
                          ),
                        ],
                      ),
                    ),
                  );
                }

                return RefreshIndicator(
                  onRefresh: () async => ref.invalidate(quotationListProvider),
                  child: ListView.builder(
                    padding: const EdgeInsets.fromLTRB(12, 4, 12, 96),
                    itemCount: list.length,
                    itemBuilder: (context, index) {
                      final q = list[index];
                      return Card(
                        margin: const EdgeInsets.symmetric(vertical: 6),
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor: quotationStatusColor(q.status).withValues(alpha: 0.15),
                            foregroundColor: quotationStatusColor(q.status),
                            child: const Icon(Icons.request_quote_outlined, size: 18),
                          ),
                          title: Text(
                            q.quotationNo.isEmpty ? 'Draft' : q.quotationNo,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          subtitle: Text(
                            '${q.customerName}'
                            '${q.fromCity.isEmpty && q.toCity.isEmpty ? '' : '  •  ${q.fromCity} → ${q.toCity}'}',
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                '₹${q.grandTotal.toStringAsFixed(0)}',
                                style: const TextStyle(fontWeight: FontWeight.bold),
                              ),
                              IconButton(
                                icon: const Icon(Icons.more_vert),
                                onPressed: () => showQuotationActions(context, q, () {
                                  ref.invalidate(quotationListProvider);
                                }),
                              ),
                            ],
                          ),
                          onTap: () async {
                            await context.push('/quotation-pdf', extra: q.id);
                            ref.invalidate(quotationListProvider);
                          },
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
}

Color quotationStatusColor(QuotationStatus status) => switch (status) {
      QuotationStatus.draft => Colors.grey,
      QuotationStatus.sent => const Color(0xff0D47A1),
      QuotationStatus.accepted => const Color(0xff2E7D32),
      QuotationStatus.declined => const Color(0xffC62828),
    };

Future<void> showQuotationActions(
  BuildContext context,
  QuotationModel q,
  VoidCallback onChanged,
) {
  return DocumentActionsSheet.show(
    context,
    title: q.quotationNo.isEmpty ? 'Quotation' : q.quotationNo,
    subtitle: '${q.customerName}  •  ${q.status.label}',
    customerPhone: q.customerPhone,
    whatsAppMessage:
        'Hello ${q.customerName}, sharing our quotation ${q.quotationNo} '
        'for your shifting and storage.',
    actions: [
      DocumentAction(
        icon: Icons.picture_as_pdf_outlined,
        label: 'View / Share PDF',
        subtitle: 'Opens the PDF, with print and share',
        color: Theme.of(context).colorScheme.tertiary,
        onTap: () async {
          await context.push('/quotation-pdf', extra: q.id);
          onChanged();
        },
      ),
      DocumentAction(
        icon: Icons.edit_outlined,
        label: 'Edit Quotation',
        subtitle: 'Same number, updated services',
        onTap: () async {
          await context.push('/quotation-edit', extra: q.id);
          onChanged();
        },
      ),
      for (final status in QuotationStatus.values)
        if (status != q.status)
          DocumentAction(
            icon: switch (status) {
              QuotationStatus.draft => Icons.drafts_outlined,
              QuotationStatus.sent => Icons.send_outlined,
              QuotationStatus.accepted => Icons.check_circle_outline,
              QuotationStatus.declined => Icons.cancel_outlined,
            },
            label: 'Mark ${status.label}',
            onTap: () async {
              await QuotationRepository.instance.setStatus(q.id, status);
              onChanged();
            },
          ),
      DocumentAction(
        icon: Icons.delete_outline,
        label: 'Delete Quotation',
        isDestructive: true,
        onTap: () async {
          if (!await confirmDelete(context, what: 'quotation')) return;
          await QuotationRepository.instance.delete(q.id);
          onChanged();
        },
      ),
    ],
  );
}
