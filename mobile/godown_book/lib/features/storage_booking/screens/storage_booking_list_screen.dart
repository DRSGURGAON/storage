import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/widgets/confirm_delete_dialog.dart';
import '../../../shared/widgets/document_actions_sheet.dart';
import '../models/storage_booking_model.dart';
import '../models/storage_status.dart';
import '../providers/storage_booking_provider.dart';
import '../repositories/storage_booking_repository.dart';
import 'storage_booking_pdf_screen.dart';

class StorageBookingListScreen extends ConsumerStatefulWidget {
  const StorageBookingListScreen({super.key});

  @override
  ConsumerState<StorageBookingListScreen> createState() =>
      _StorageBookingListScreenState();
}

class _StorageBookingListScreenState
    extends ConsumerState<StorageBookingListScreen> {
  final _search = TextEditingController();
  bool _openOnly = false;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  List<StorageBookingModel> _filter(List<StorageBookingModel> all) {
    final q = _search.text.trim().toLowerCase();
    return all.where((b) {
      if (_openOnly && !b.status.isOpen) return false;
      if (q.isEmpty) return true;
      return b.bookingNo.toLowerCase().contains(q) ||
          b.customerName.toLowerCase().contains(q) ||
          b.customerPhone.contains(q) ||
          b.locationName.toLowerCase().contains(q);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final bookings = ref.watch(storageBookingListProvider);

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/dashboard'),
        ),
        title: const Text('Storage'),
        centerTitle: true,
        actions: [
          IconButton(
            tooltip: _openOnly ? 'Showing in-storage only' : 'Show in-storage only',
            icon: Icon(_openOnly ? Icons.filter_alt : Icons.filter_alt_outlined),
            onPressed: () => setState(() => _openOnly = !_openOnly),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          await context.push('/storage-create');
          ref.invalidate(storageBookingListProvider);
        },
        icon: const Icon(Icons.add),
        label: const Text('New Storage'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: TextField(
              controller: _search,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: 'Search customer, phone, number or location',
                prefixIcon: const Icon(Icons.search),
                isDense: true,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),
          Expanded(
            child: bookings.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, s) => Center(child: Text(e.toString())),
              data: (all) {
                final list = _filter(all);
                if (list.isEmpty) {
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(32),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.inventory_2_outlined, size: 48),
                          const SizedBox(height: 12),
                          Text(
                            all.isEmpty
                                ? 'Nothing in storage yet.\nTap New Storage when a customer\'s goods come in.'
                                : 'Nothing matches.',
                            textAlign: TextAlign.center,
                          ),
                        ],
                      ),
                    ),
                  );
                }

                return RefreshIndicator(
                  onRefresh: () async => ref.invalidate(storageBookingListProvider),
                  child: ListView.builder(
                    padding: const EdgeInsets.fromLTRB(12, 4, 12, 96),
                    itemCount: list.length,
                    itemBuilder: (context, index) =>
                        _BookingTile(booking: list[index], onChanged: () {
                      ref.invalidate(storageBookingListProvider);
                    }),
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

class _BookingTile extends StatelessWidget {
  final StorageBookingModel booking;
  final VoidCallback onChanged;

  const _BookingTile({required this.booking, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final b = booking;
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: statusColor(b.status).withValues(alpha: 0.15),
          foregroundColor: statusColor(b.status),
          child: const Icon(Icons.inventory_2_outlined, size: 18),
        ),
        title: Text(
          b.bookingNo.isEmpty ? 'Unnumbered' : b.bookingNo,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          '${b.customerName}  •  ${b.items.isEmpty ? '${b.totalPackages} pkgs' : '${_qty(b.remainingQuantity)}/${_qty(b.totalQuantity)} in stock'}'
          '${b.locationName.isEmpty ? '' : '  •  ${b.locationName}'}',
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _StatusChip(status: b.status),
            IconButton(
              icon: const Icon(Icons.more_vert),
              tooltip: 'More options',
              onPressed: () => showBookingActions(context, b, onChanged),
            ),
          ],
        ),
        onTap: () async {
          await context.push('/storage-detail', extra: b.id);
          onChanged();
        },
      ),
    );
  }

  static String _qty(double v) =>
      v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(1);
}

Color statusColor(StorageStatus status) => switch (status) {
      StorageStatus.inStorage => const Color(0xff0D47A1),
      StorageStatus.partiallyReleased => const Color(0xffB35C00),
      StorageStatus.released => const Color(0xff2E7D32),
      StorageStatus.cancelled => Colors.grey,
    };

class _StatusChip extends StatelessWidget {
  final StorageStatus status;
  const _StatusChip({required this.status});

  @override
  Widget build(BuildContext context) {
    final color = statusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        status.label,
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: color),
      ),
    );
  }
}

/// The shared actions sheet for one receipt - used by the list and the
/// detail screen so both offer the same options.
Future<void> showBookingActions(
  BuildContext context,
  StorageBookingModel b,
  VoidCallback onChanged,
) {
  Future<void> openPdf(BookingDocumentKind kind) async {
    await context.push('/storage-pdf', extra: {'id': b.id, 'kind': kind.name});
    onChanged();
  }

  return DocumentActionsSheet.show(
    context,
    title: b.bookingNo.isEmpty ? 'Storage' : b.bookingNo,
    subtitle: b.customerName,
    customerPhone: b.customerPhone,
    whatsAppMessage:
        'Hello ${b.customerName}, sharing the Storage Receipt ${b.bookingNo} '
        'for your goods kept with us.',
    actions: [
      DocumentAction(
        icon: Icons.picture_as_pdf_outlined,
        label: 'Storage Receipt PDF',
        subtitle: 'Customer and office copies',
        color: Theme.of(context).colorScheme.tertiary,
        onTap: () => openPdf(BookingDocumentKind.receipt),
      ),
      DocumentAction(
        icon: Icons.list_alt_outlined,
        label: 'Goods List PDF',
        subtitle: 'What is stored, what has gone out',
        color: Theme.of(context).colorScheme.secondary,
        onTap: () => openPdf(BookingDocumentKind.inventory),
      ),
      DocumentAction(
        icon: Icons.handshake_outlined,
        label: 'Storage Agreement PDF',
        subtitle: 'Terms both sides sign',
        color: Theme.of(context).colorScheme.primary,
        onTap: () => openPdf(BookingDocumentKind.agreement),
      ),
      DocumentAction(
        icon: Icons.edit_outlined,
        label: 'Edit Storage',
        subtitle: 'Same receipt number, updated details',
        onTap: () async {
          await context.push('/storage-edit', extra: b.id);
          onChanged();
        },
      ),
      DocumentAction(
        icon: Icons.delete_outline,
        label: 'Delete Storage',
        isDestructive: true,
        onTap: () async {
          if (!await confirmDelete(
            context,
            what: 'storage record',
            warning: 'This storage record and its goods list will be '
                'permanently deleted. Bills and release records already '
                'raised against it keep their own copies.',
          )) {
            return;
          }
          await StorageBookingRepository.instance.delete(b.id);
          onChanged();
        },
      ),
    ],
  );
}
