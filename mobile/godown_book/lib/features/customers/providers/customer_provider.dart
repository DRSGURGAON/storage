import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/customer_model.dart';
import '../repositories/customer_repository.dart';

final customerListProvider = FutureProvider<List<CustomerModel>>((ref) async {
  return CustomerRepository.instance.getAll();
});
