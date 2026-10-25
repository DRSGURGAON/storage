import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/widgets/confirm_delete_dialog.dart';
import '../../../shared/widgets/document_actions_sheet.dart';
import '../../billing/services/storage_charge_calculator.dart';
import '../../storage_booking/providers/storage_booking_provider.dart';
import '../../storage_booking/repositories/storage_booking_repository.dart';
import '../models/goods_release_model.dart';
import '../providers/goods_release_provider.dart';
import '../repositories/goods_release_repository.dart';
import '../../../core/contact/whatsapp_templates.dart';
import '../../../shared/widgets/load_error_view.dart';

class ReleaseListScreen extends ConsumerStatefulWidget {
  const ReleaseListScreen({super.key});

  @override
  ConsumerState<ReleaseListScreen> createState() => _ReleaseListScreenState();
}

class _ReleaseListScreenState extends ConsumerState<ReleaseListScreen> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  bool _matches(GoodsReleaseModel r, String query) {
    if (query.isEmpty) return true;
    return [r.releaseNo, r.bookingNo, r.customerName, r.customerPhone, r.vehicleNumber]
        .any((field) => field.toLowerCase().contains(query));
  }

  @override
  Widget build(BuildContext context) {
    final releases = ref.watch(goodsReleaseListProvider);
    final query = _search.text.trim().toLowerCase();

    void refresh() {
      ref.invalidate(goodsReleaseListProvider);
      ref.invalidate(storageBookingListProvider);
    }

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/dashboard'),
        ),
        title: const Text('Goods Released'),
        centerTitle: true,
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final releaseId = await context.push('/release-create');
          refresh();
          if (releaseId is String && context.mounted) {
            await context.push('/release-pdf', extra: releaseId);
            refresh();
          }
        },
        icon: const Icon(Icons.outbox_outlined),
        label: const Text('Release Goods'),
      ),
      body: releases.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, s) => LoadErrorView(
                message: 'Could not load the release records.',
                onRetry: () => ref.invalidate(goodsReleaseListProvider),
              ),
        data: (all) {
          if (all.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(32),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.outbox_outlined, size: 48),
                    SizedBox(height: 12),
                    Text(
                      'Nothing released yet.\nTap Release Goods when a customer '
                      'takes their goods back.',
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
            );
          }

          final list = all.where((r) => _matches(r, query)).toList();

          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: TextField(
                  textInputAction: TextInputAction.search,
                  controller: _search,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    hintText: 'Search customer, phone, release or storage no',
                    prefixIcon: const Icon(Icons.search),
                    isDense: true,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                ),
              ),
              if (list.isEmpty)
                const Expanded(
                  child: Center(child: Text('No release matches your search.')),
                )
              else
                Expanded(
                  child: RefreshIndicator(
            onRefresh: () async => refresh(),
            child: ListView.builder(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 96),
              itemCount: list.length,
              itemBuilder: (context, index) {
                final release = list[index];
                return Card(
                  margin: const EdgeInsets.symmetric(vertical: 6),
                  child: ListTile(
                    leading: const CircleAvatar(
                      child: Icon(Icons.outbox_outlined, size: 18),
                    ),
                    title: Text(
                      release.releaseNo.isEmpty ? 'Release' : release.releaseNo,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    subtitle: Text(
                      '${release.customerName}  •  ${release.releaseType.label}'
                      '${release.vehicleNumber.isEmpty ? '' : '  •  ${release.vehicleNumber}'}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    trailing: Text(
                      _qty(release.totalQuantity),
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    onTap: () => _showActions(context, release, refresh),
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
    );
  }

  static String _qty(double v) =>
      v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(1);

  Future<void> _showActions(
    BuildContext context,
    GoodsReleaseModel release,
    VoidCallback refresh,
  ) async {
    var canMakeBill = false;
    if (release.bookingId.isNotEmpty) {
      final booking =
          await StorageBookingRepository.instance.getById(release.bookingId);
      canMakeBill =
          booking != null && StorageChargeCalculator.hasUnbilledRent(booking);
    }
    if (!context.mounted) return;

    return DocumentActionsSheet.show(
      context,
      title: release.releaseNo,
      subtitle: '${release.customerName}  •  against ${release.bookingNo}',
      customerPhone: release.customerPhone,
      whatsAppMessage: WhatsAppTemplates.instance.document(
        name: release.customerName,
        document: 'Release Record',
        number: release.releaseNo,
      ),
      actions: [
        DocumentAction(
          icon: Icons.picture_as_pdf_outlined,
          label: 'View / Share PDF',
          subtitle: 'Customer and gate copies',
          color: Theme.of(context).colorScheme.tertiary,
          onTap: () async {
            await context.push('/release-pdf', extra: release.id);
            refresh();
          },
        ),
        if (canMakeBill)
          DocumentAction(
            icon: Icons.receipt_long_outlined,
            label: 'Make Bill',
            subtitle: 'Rent up to the release is still unbilled',
            onTap: () async {
              await context.push('/bill-create', extra: release.bookingId);
              refresh();
            },
          ),
        DocumentAction(
          icon: Icons.delete_outline,
          label: 'Delete Release',
          subtitle: 'Puts the goods back into storage',
          isDestructive: true,
          onTap: () async {
            if (!await confirmDelete(
              context,
              what: 'release record',
              warning: 'The record will be deleted and the goods put back on '
                  'the storage record.',
            )) {
              return;
            }
            await GoodsReleaseRepository.instance.delete(release.id);
            refresh();
          },
        ),
      ],
    );
  }
}
