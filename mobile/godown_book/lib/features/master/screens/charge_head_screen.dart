import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../models/charge_head_model.dart';
import '../providers/charge_head_provider.dart';

class ChargeHeadScreen extends ConsumerWidget {
  const ChargeHeadScreen({super.key});

  Future<void> _edit(
    BuildContext context,
    WidgetRef ref, {
    ChargeHeadModel? existing,
  }) async {
    final controller = ref.read(chargeHeadControllerProvider);

    final nameController = TextEditingController(
      text: existing?.chargeName ?? '',
    );
    final amountController = TextEditingController(
      text: (existing?.defaultAmount ?? 0) == 0
          ? ''
          : existing!.defaultAmount.toStringAsFixed(0),
    );

    var mode = existing?.defaultMode ?? ChargeMode.amount;
    var taxable = existing?.taxable ?? true;

    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: Text(existing == null ? 'New Charge Head' : 'Edit Charge Head'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: nameController,
                  autofocus: existing == null,
                  textCapitalization: TextCapitalization.words,
                  enabled: !(existing?.isSystem ?? false),
                  decoration: const InputDecoration(labelText: 'Charge name'),
                ),
                const SizedBox(height: 16),
                const Text('Default on new bills'),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  children: [
                    for (final option in ChargeMode.values)
                      ChoiceChip(
                        label: Text(option.label),
                        selected: mode == option,
                        onSelected: (_) => setDialogState(() => mode = option),
                      ),
                  ],
                ),
                if (mode == ChargeMode.amount) ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: amountController,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Default amount',
                      prefixText: '₹ ',
                    ),
                  ),
                ],
                const SizedBox(height: 8),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('GST applicable'),
                  value: taxable,
                  onChanged: (value) => setDialogState(() => taxable = value),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                if (nameController.text.trim().isEmpty) return;
                Navigator.pop(dialogContext, true);
              },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );

    final name = nameController.text.trim();
    final amount = double.tryParse(amountController.text.trim()) ?? 0;

    nameController.dispose();
    amountController.dispose();

    if (saved != true || name.isEmpty) return;

    if (existing == null) {
      await controller.insert(
        ChargeHeadModel(
          id: await controller.generateNextCode(),
          code: await controller.generateNextCode(),
          chargeName: name,
          defaultMode: mode,
          defaultAmount: amount,
          taxable: taxable,
          sortOrder: await controller.nextSortOrder(),
        ),
      );
    } else {
      await controller.update(
        existing.copyWith(
          chargeName: name,
          defaultMode: mode,
          defaultAmount: amount,
          taxable: taxable,
        ),
      );
    }

    ref.invalidate(chargeHeadProvider);
  }

  Future<void> _delete(
    BuildContext context,
    WidgetRef ref,
    ChargeHeadModel head,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Remove Charge Head'),
        content: Text(
          'Remove "${head.chargeName}"? Bills already saved keep it.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    await ref.read(chargeHeadControllerProvider).delete(head.id);

    ref.invalidate(chargeHeadProvider);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final headsAsync = ref.watch(chargeHeadProvider);

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/masters'),
        ),
        title: const Text('Charge Heads'),
        centerTitle: true,
      ),

      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _edit(context, ref),
        icon: const Icon(Icons.add),
        label: const Text('Charge Head'),
      ),

      body: headsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),

        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text('Could not load charge heads.\n$e',
                textAlign: TextAlign.center),
          ),
        ),

        data: (heads) {
          if (heads.isEmpty) {
            return const Center(
              child: Text('No charge heads yet.'),
            );
          }

          return ListView.separated(
            padding: const EdgeInsets.symmetric(vertical: 8),
            itemCount: heads.length,
            separatorBuilder: (context, index) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final head = heads[index];

              return ListTile(
                title: Text(head.chargeName),
                subtitle: Text(
                  'Default: ${head.defaultMode.label}'
                  '${head.defaultMode == ChargeMode.amount && head.defaultAmount > 0 ? ' ₹${head.defaultAmount.toStringAsFixed(0)}' : ''}'
                  '  •  ${head.taxable ? 'GST applicable' : 'GST exempt'}',
                ),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      onPressed: () => _edit(context, ref, existing: head),
                      icon: const Icon(Icons.edit_outlined),
                    ),
                    if (!head.isSystem)
                      IconButton(
                        onPressed: () => _delete(context, ref, head),
                        icon: const Icon(Icons.delete_outline),
                      ),
                  ],
                ),
              );
            },
          );
        },
      ),
    );
  }
}
