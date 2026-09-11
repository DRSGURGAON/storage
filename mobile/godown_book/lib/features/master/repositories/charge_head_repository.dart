import '../data/charge_head_dao.dart';
import '../models/charge_head_model.dart';

class ChargeHeadRepository {
  ChargeHeadRepository._();

  static final ChargeHeadRepository instance = ChargeHeadRepository._();

  final ChargeHeadDao _dao = ChargeHeadDao.instance;

  Future<List<ChargeHeadModel>> getAll({bool activeOnly = true}) =>
      _dao.getAll(activeOnly: activeOnly);

  Future<void> insert(ChargeHeadModel head) => _dao.insert(head);

  Future<void> update(ChargeHeadModel head) => _dao.update(head);

  Future<void> delete(String id) => _dao.delete(id);
}
