import 'package:godown_book/core/database/app_database.dart';
import 'package:godown_book/core/database/database_constants.dart';
import 'package:godown_book/core/tenant/tenant_scope.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Opens a fresh in-memory SQLite database with the real app schema
/// (AppDatabase.onCreate) and installs it as the app-wide database, so
/// DAOs and repositories under test run against real SQL.
Future<Database> openTestDatabase({String companyId = 'company-test'}) async {
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
  return db;
}
