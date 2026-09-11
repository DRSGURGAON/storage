import '../../../core/database/database_helper.dart';
import '../models/payment_proof_model.dart';

class PaymentProofDao {
  PaymentProofDao._();

  static final PaymentProofDao instance = PaymentProofDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  Future<void> insert(PaymentProofModel proof) async {
    final db = await _db.database;

    await db.insert('payment_proofs', proof.toMap());
  }

  Future<PaymentProofModel?> getById(String id) async {
    final db = await _db.database;

    final data = await db.query(
      'payment_proofs',
      where: 'id = ?',
      whereArgs: [id],
    );

    if (data.isEmpty) return null;

    return PaymentProofModel.fromMap(data.first);
  }
}
