import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/widgets/confirm_delete_dialog.dart';
import '../../../shared/widgets/document_actions_sheet.dart';
import '../../storage_booking/providers/storage_booking_provider.dart';
import '../models/goods_release_model.dart';
import '../providers/goods_release_provider.dart';
import '../repositories/goods_release_repository.dart';

class ReleaseListScreen extends ConsumerWidget {
  const ReleaseListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final releases = ref.watch(goodsReleaseListProvider);

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
        error: (e, s) => Center(child: Text(e.toString())),
        data: (list) {
          if (list.isEmpty) {
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

          return RefreshIndicator(
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
  ) {
    return DocumentActionsSheet.show(
      context,
      title: release.releaseNo,
      subtitle: '${release.customerName}  •  against ${release.bookingNo}',
      customerPhone: release.customerPhone,
      whatsAppMessage:
          'Hello ${release.customerName}, sharing the release record '
          '${release.releaseNo} for the goods collected from our godown.',
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
