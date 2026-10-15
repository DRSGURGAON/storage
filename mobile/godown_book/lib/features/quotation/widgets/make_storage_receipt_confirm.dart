import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../models/quotation_model.dart';

/// Opens the "Make Storage Receipt" flow for [quotation] - asking
/// first when the quotation is already Accepted, since that status is
/// also what a previous conversion leaves behind. The app has no
/// record of which booking (if any) a quotation turned into, so this
/// is the one guard against tapping the button twice and ending up
/// with two storage bookings for the same goods.
Future<void> openMakeStorageReceipt(
  BuildContext context,
  QuotationModel quotation,
) async {
  if (quotation.status == QuotationStatus.accepted) {
    final proceed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Already marked Accepted'),
        content: Text(
          'This quotation is already Accepted - it may already have a '
          'storage receipt. Make another one for '
          '${quotation.customerName}?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Make Another'),
          ),
        ],
      ),
    );
    if (proceed != true || !context.mounted) return;
  }

  if (!context.mounted) return;
  await context.push('/storage-create', extra: {'quotationId': quotation.id});
}
