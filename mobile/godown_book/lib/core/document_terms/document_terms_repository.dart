import '../database/database_constants.dart';
import '../database/database_helper.dart';
import '../utils/id_generator.dart';

/// The document types whose Terms & Conditions can be customised
/// individually (Reports -> Customise Documents). Stored as stable
/// string codes in the document_terms table - never rename an existing
/// code, existing rows reference it.
class DocumentTermsType {
  DocumentTermsType._();

  static const String quotation = 'quotation';
  static const String storageAgreement = 'storage_agreement';
  static const String storageReceipt = 'storage_receipt';
  static const String bill = 'bill';
  static const String moneyReceipt = 'money_receipt';
  static const String releaseRecord = 'release_record';
}

/// Per-document-type Terms & Conditions overrides, one optional row per
/// document type per company (see Migrations.createDocumentTermsTable).
///
/// Resolution used by every PDF service:
///   1. the specific document's own saved terms (where the document
///      type stores one, e.g. a Bilty's own terms field),
///   2. this table's per-type custom terms,
///   3. the company-wide defaultTerms from Company Settings.
/// An empty/missing row here simply means step 2 is skipped, so a
/// company that never customises anything sees exactly the old
/// behaviour.
class DocumentTermsRepository {
  DocumentTermsRepository._();

  static final DocumentTermsRepository instance = DocumentTermsRepository._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  /// The custom terms for [docType], or '' when none have been saved -
  /// callers treat '' as "no override, fall through to defaultTerms".
  Future<String> getTerms(String docType) async {
    try {
      final rows = await _db.queryScoped(
        DatabaseConstants.documentTermsTable,
        where: 'doc_type = ?',
        whereArgs: [docType],
        limit: 1,
      );

      if (rows.isEmpty) return '';
      return (rows.first['terms'] as String? ?? '').trim();
    } catch (_) {
      // A lookup failure must never block PDF generation - the
      // company-wide default terms still print.
      return '';
    }
  }

  /// All overrides at once, keyed by doc_type - for the Customise
  /// Documents screen to prefill its editors in one query.
  Future<Map<String, String>> getAllTerms() async {
    try {
      final rows = await _db.queryScoped(DatabaseConstants.documentTermsTable);

      return {
        for (final row in rows)
          (row['doc_type'] as String? ?? ''):
              (row['terms'] as String? ?? '').trim(),
      };
    } catch (_) {
      return const {};
    }
  }

  /// Upsert (insertScoped uses ConflictAlgorithm.replace and the table
  /// is UNIQUE(company_id, doc_type), so saving twice simply
  /// overwrites). Saving empty [terms] clears the override back to the
  /// company-wide default.
  Future<void> saveTerms(String docType, String terms) async {
    final trimmed = terms.trim();

    if (trimmed.isEmpty) {
      await _db.deleteWhereScoped(
        DatabaseConstants.documentTermsTable,
        'doc_type = ?',
        [docType],
      );
      return;
    }

    // Reuse the existing row's id so REPLACE targets the same row
    // deterministically rather than relying only on the UNIQUE index.
    final existing = await _db.queryScoped(
      DatabaseConstants.documentTermsTable,
      where: 'doc_type = ?',
      whereArgs: [docType],
      limit: 1,
    );

    await _db.insertScoped(DatabaseConstants.documentTermsTable, {
      'id': existing.isNotEmpty
          ? existing.first['id'] as String
          : IdGenerator.generateId(),
      'doc_type': docType,
      'terms': trimmed,
      'updated_at': DateTime.now().toIso8601String(),
    });
  }
}
