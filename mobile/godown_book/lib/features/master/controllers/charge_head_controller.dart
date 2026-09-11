import '../models/charge_head_model.dart';
import '../repositories/charge_head_repository.dart';

class ChargeHeadController {
  final ChargeHeadRepository _repository = ChargeHeadRepository.instance;

  Future<List<ChargeHeadModel>> getAll({bool activeOnly = true}) =>
      _repository.getAll(activeOnly: activeOnly);

  Future<void> insert(ChargeHeadModel head) => _repository.insert(head);

  Future<void> update(ChargeHeadModel head) => _repository.update(head);

  Future<void> delete(String id) => _repository.delete(id);

  /// Codes must stay unique, so derive from the highest existing number
  /// rather than the list length.
  Future<String> generateNextCode() async {
    final list = await _repository.getAll(activeOnly: false);

    var maxNumber = 0;

    for (final head in list) {
      final match = RegExp(r'(\d+)$').firstMatch(head.code);
      final number = match != null ? int.tryParse(match.group(1)!) ?? 0 : 0;

      if (number > maxNumber) maxNumber = number;
    }

    return 'CHG${(maxNumber + 1).toString().padLeft(3, '0')}';
  }

  Future<int> nextSortOrder() async {
    final list = await _repository.getAll(activeOnly: false);

    var max = 0;
    for (final head in list) {
      if (head.sortOrder > max) max = head.sortOrder;
    }

    return max + 10;
  }
}
