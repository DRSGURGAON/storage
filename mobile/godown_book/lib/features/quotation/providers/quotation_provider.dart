import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/quotation_model.dart';
import '../repositories/quotation_repository.dart';

final quotationListProvider = FutureProvider<List<QuotationModel>>((ref) async {
  return QuotationRepository.instance.getAll();
});
