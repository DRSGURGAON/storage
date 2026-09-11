import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../controllers/charge_head_controller.dart';
import '../models/charge_head_model.dart';

final chargeHeadControllerProvider = Provider<ChargeHeadController>(
  (ref) => ChargeHeadController(),
);

final chargeHeadProvider = FutureProvider<List<ChargeHeadModel>>((ref) async {
  return ref.watch(chargeHeadControllerProvider).getAll();
});
