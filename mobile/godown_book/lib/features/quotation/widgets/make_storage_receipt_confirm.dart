import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../storage_booking/repositories/storage_booking_repository.dart';
import '../models/quotation_model.dart';

/// Opens the storage receipt for [quotation] - the one already made
/// from it, if any, or a new one filled in from its details.
///
/// The app remembers which quotation a booking came from
/// (StorageBookingModel.quotationId), so tapping "Make Storage
/// Receipt" a second time opens the existing receipt instead of
/// risking a second, duplicate booking for the same goods - the same
/// way Bill N Bilty's Quotation -> Booking button behaves.
Future<void> openMakeStorageReceipt(
  BuildContext context,
  QuotationModel quotation,
) async {
  final existing =
      await StorageBookingRepository.instance.getByQuotationId(quotation.id);
  if (!context.mounted) return;

  if (existing != null) {
    await context.push('/storage-detail', extra: existing.id);
    return;
  }

  await context.push('/storage-create', extra: {'quotationId': quotation.id});
}
