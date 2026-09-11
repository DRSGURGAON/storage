import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/goods_release_model.dart';
import '../repositories/goods_release_repository.dart';

final goodsReleaseListProvider =
    FutureProvider<List<GoodsReleaseModel>>((ref) async {
  return GoodsReleaseRepository.instance.getAll();
});
