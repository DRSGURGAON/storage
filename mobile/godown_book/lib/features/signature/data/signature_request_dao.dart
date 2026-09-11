import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../models/signature_request_model.dart';

class SignatureRequestDao {
  SignatureRequestDao._();

  static final SignatureRequestDao instance = SignatureRequestDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  Future<void> insert(SignatureRequestModel request) async {
    await _db.insertScoped(
      DatabaseConstants.signatureRequestTable,
      request.toMap(),
    );
  }

  Future<void> update(SignatureRequestModel request) async {
    await _db.updateScoped(
      DatabaseConstants.signatureRequestTable,
      request.toMap(),
      request.id,
    );
  }

  Future<List<SignatureRequestModel>> getAll() async {
    final rows = await _db.queryScoped(
      DatabaseConstants.signatureRequestTable,
      orderBy: 'created_at DESC',
    );
    return rows.map(SignatureRequestModel.fromMap).toList();
  }

  /// Every request raised for one document, newest first.
  Future<List<SignatureRequestModel>> getForDocument(
    String documentType,
    String documentId,
  ) async {
    final rows = await _db.queryScoped(
      DatabaseConstants.signatureRequestTable,
      where: 'document_type = ? AND document_id = ?',
      whereArgs: [documentType, documentId],
      orderBy: 'created_at DESC',
    );
    return rows.map(SignatureRequestModel.fromMap).toList();
  }

  Future<SignatureRequestModel?> getById(String id) async {
    final rows = await _db.queryScoped(
      DatabaseConstants.signatureRequestTable,
      where: 'id = ?',
      whereArgs: [id],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return SignatureRequestModel.fromMap(rows.first);
  }

  Future<void> delete(String id) async {
    await _db.deleteScoped(DatabaseConstants.signatureRequestTable, id);
  }
}
