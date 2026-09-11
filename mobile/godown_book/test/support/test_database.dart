import 'package:godown_book/core/database/app_database.dart';
import 'package:godown_book/core/database/database_constants.dart';
import 'package:godown_book/core/tenant/tenant_migrator.dart';
import 'package:godown_book/core/tenant/tenant_scope.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Opens a fresh in-memory SQLite database with the real app schema
/// (AppDatabase.onCreate) and installs it as the app-wide database, so
/// DAOs and repositories under test run against real SQL.
///
/// [claimSeeds] mirrors what the app itself does on first launch: the
/// company claims the rows seeded before it existed (charge heads), so
/// a test sees the same masters an operator would. Pass false to test
/// the unclaimed state itself.
Future<Database> openTestDatabase({
  String companyId = 'company-test',
  bool claimSeeds = true,
}) async {
  sqfliteFfiInit();
  databaseFactory = databaseFactoryFfi;

  final db = await databaseFactory.openDatabase(
    inMemoryDatabasePath,
    options: OpenDatabaseOptions(
      version: DatabaseConstants.databaseVersion,
      onCreate: AppDatabase.instance.onCreate,
      onUpgrade: AppDatabase.instance.onUpgrade,
    ),
  );

  AppDatabase.overrideForTesting(db);
  TenantScope.set(companyId);
  if (claimSeeds) await TenantMigrator.claimUnassignedRows(companyId);
  return db;
}
