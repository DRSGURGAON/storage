import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/storage_booking_model.dart';
import '../repositories/storage_booking_repository.dart';

final storageBookingListProvider =
    FutureProvider<List<StorageBookingModel>>((ref) async {
  return StorageBookingRepository.instance.getAll();
});
