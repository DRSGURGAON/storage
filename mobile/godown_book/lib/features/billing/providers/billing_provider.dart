import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/bill_model.dart';
import '../models/payment_model.dart';
import '../repositories/billing_repository.dart';

final billListProvider = FutureProvider<List<BillModel>>((ref) async {
  return BillingRepository.instance.getAllBills();
});

final paymentListProvider = FutureProvider<List<PaymentModel>>((ref) async {
  return BillingRepository.instance.getAllPayments();
});
