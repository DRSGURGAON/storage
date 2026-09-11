import '../database/database_constants.dart';
import '../database/database_helper.dart';

/// Assigns ownership of rows that exist without a company.
///
/// Two situations produce such rows, and both are normal:
///   * seed data written by the database migration, before any company
///     exists (charge heads, inventory defaults);
///   * an upgrade from a pre-tenant database version.
///
/// Without this step those rows stay invisible, because every DAO now
/// filters by company.
class TenantMigrator {
  TenantMigrator._();

  static Future<int> claimUnassignedRows(String companyId) async {
    if (companyId.isEmpty) {
      throw ArgumentError('companyId cannot be empty.');
    }

    final db = DatabaseHelper.instance;
    var claimed = 0;

    for (final table in DatabaseConstants.tenantTables) {
      claimed += await db.updateWhere(
        table,
        {DatabaseConstants.companyIdColumn: companyId},
        "${DatabaseConstants.companyIdColumn} = '' "
            "OR ${DatabaseConstants.companyIdColumn} IS NULL",
        const [],
      );
    }

    return claimed;
  }
}
