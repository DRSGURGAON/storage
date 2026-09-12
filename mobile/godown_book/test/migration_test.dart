import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/database/app_database.dart';
import 'package:godown_book/core/database/database_constants.dart';
import 'package:godown_book/core/database/migrations.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// A phone that already has the app installed runs onUpgrade, not
/// onCreate - and a migration that fails there loses somebody's data.
/// These tests build a database shaped like the older release and then
/// upgrade it, exactly as the phone would.
void main() {
  late Directory scratch;

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() {
    // A real file per test: sqflite's in-memory database is shared
    // within the process, so one test would open another's database
    // and skip the migration entirely.
    scratch = Directory.systemTemp.createTempSync('godown-migration');
  });

  tearDown(() {
    if (scratch.existsSync()) scratch.deleteSync(recursive: true);
  });

  String path(String name) => '${scratch.path}/$name.db';

  Future<Set<String>> tables(Database db) async {
    final rows =
        await db.rawQuery("SELECT name FROM sqlite_master WHERE type = 'table'");
    return rows.map((row) => row['name'] as String).toSet();
  }

  Future<Set<String>> columns(Database db, String table) async {
    final rows = await db.rawQuery('PRAGMA table_info($table)');
    return rows.map((row) => row['name'] as String).toSet();
  }

  /// The v1 shape: no notices, no incidents, no consignments, and
  /// without the columns later versions add.
  Future<Database> openVersionOne() async {
    final db = await databaseFactory.openDatabase(
      path('v1'),
      options: OpenDatabaseOptions(version: 1),
    );

    await db.execute(
      Migrations.createCompanyTable
          .replaceAll("    consignment_prefix TEXT NOT NULL DEFAULT 'LR',\n", ''),
    );
    await db.execute(Migrations.createStorageLocationTable
        .replaceAll('    capacity INTEGER NOT NULL DEFAULT 0,\n', ''));
    await db.execute(Migrations.createStoragePhotoTable.replaceAll(
      "    incident_id TEXT NOT NULL DEFAULT '',\n",
      '',
    ));
    await db.execute(Migrations.createCustomerTable);
    await db.execute(Migrations.createStorageBookingTable);
    await db.execute(Migrations.createBookingItemTable);
    await db.execute(Migrations.createInvoiceTable);
    await db.execute(Migrations.createPaymentTable);

    return db;
  }

  test('a v1 database upgrades to the current version without losing data',
      () async {
    final db = await openVersionOne();

    // Something an operator already had on their phone.
    await db.insert('customers', {
      'id': 'customer-1',
      'company_id': 'company-test',
      'customer_name': 'Rajesh Kumar',
      'mobile_number': '9876500001',
      'created_at': DateTime(2026, 9, 1).toIso8601String(),
    });
    await db.insert('storage_photos', {
      'id': 'photo-1',
      'company_id': 'company-test',
      'booking_id': 'booking-1',
      'file_path': '/tmp/goods.jpg',
      'created_at': DateTime(2026, 9, 1).toIso8601String(),
    });

    expect(await tables(db), isNot(contains('notices')));
    expect(await columns(db, 'storage_photos'), isNot(contains('incident_id')));

    await AppDatabase.instance
        .onUpgrade(db, 1, DatabaseConstants.databaseVersion);

    final after = await tables(db);
    expect(after, containsAll(['notices', 'incidents', 'consignments',
        'consignment_items']));
    expect(await columns(db, 'storage_photos'), contains('incident_id'));
    expect(await columns(db, 'company_settings'), contains('consignment_prefix'));
    expect(await columns(db, 'storage_locations'), contains('capacity'));

    // The rows that were already there are untouched, and the added
    // column has its default rather than null.
    final customers = await db.query('customers');
    expect(customers, hasLength(1));
    expect(customers.first['customer_name'], 'Rajesh Kumar');

    final photos = await db.query('storage_photos');
    expect(photos.first['incident_id'], '');

    await db.close();
  });

  test('a phone already on v2 gets only what v3 brings', () async {
    final db = await openVersionOne();

    // What v2 left on that phone.
    await db.execute(Migrations.createNoticeTable);
    await db.execute(Migrations.createIncidentTable);
    await db.execute(
      "ALTER TABLE storage_photos ADD COLUMN incident_id TEXT NOT NULL DEFAULT ''",
    );
    await db.insert('notices', {
      'id': 'notice-1',
      'company_id': 'company-test',
      'notice_date': DateTime(2026, 11, 1).toIso8601String(),
      'notice_kind': 'REMINDER',
      'customer_name': 'Rajesh Kumar',
      'amount_due': 3500,
      'created_at': DateTime(2026, 11, 1).toIso8601String(),
    });

    expect(await tables(db), isNot(contains('consignments')));

    await AppDatabase.instance.onUpgrade(db, 2, 3);

    expect(await tables(db), contains('consignments'));
    expect(await columns(db, 'company_settings'), contains('consignment_prefix'));

    // The letter that phone had sent is still there.
    expect(await db.query('notices'), hasLength(1));

    await db.close();
  });

  test('a phone already on v3 gets only the capacity column', () async {
    final db = await openVersionOne();
    await db.execute(Migrations.createNoticeTable);
    await db.execute(Migrations.createIncidentTable);
    await db.execute(Migrations.createConsignmentTable);
    await db.execute(Migrations.createConsignmentItemTable);
    await db.execute(
      "ALTER TABLE storage_photos ADD COLUMN incident_id TEXT NOT NULL DEFAULT ''",
    );
    await db.execute(
      "ALTER TABLE company_settings ADD COLUMN consignment_prefix TEXT NOT NULL DEFAULT 'LR'",
    );
    await db.insert('storage_locations', {
      'id': 'hall-a',
      'company_id': 'company-test',
      'code': 'H1',
      'name': 'Hall A',
    });

    expect(await columns(db, 'storage_locations'), isNot(contains('capacity')));

    await AppDatabase.instance.onUpgrade(db, 3, 4);

    expect(await columns(db, 'storage_locations'), contains('capacity'));
    final rows = await db.query('storage_locations');
    expect(rows.single['capacity'], 0);

    await db.close();
  });

  test('a fresh install creates every table the app reads and backs up',
      () async {
    final db = await databaseFactory.openDatabase(
      path('fresh'),
      options: OpenDatabaseOptions(
        version: DatabaseConstants.databaseVersion,
        onCreate: AppDatabase.instance.onCreate,
        onUpgrade: AppDatabase.instance.onUpgrade,
      ),
    );

    final created = await tables(db);
    for (final table in DatabaseConstants.tenantTables) {
      expect(created, contains(table), reason: table);

      // Every tenant table is scoped, so nothing can leak between
      // companies on a shared phone.
      expect(await columns(db, table),
          containsAll(['id', DatabaseConstants.companyIdColumn]),
          reason: table);
    }

    await db.close();
  });
}
