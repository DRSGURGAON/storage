import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';

import '../permissions/permission.dart';
import 'database_constants.dart';
import 'migrations.dart';

/// Opens the one local SQLite database and owns its schema lifecycle:
/// every table is created on first open, and every later schema change
/// is an explicit, numbered step in [_onUpgrade] keyed off
/// [DatabaseConstants.databaseVersion].
///
/// Seeds (charge heads, default roles, subscription plans and settings)
/// are idempotent by code, so they can be re-run on any upgrade without
/// duplicating rows.
class AppDatabase {
  AppDatabase._();

  static final AppDatabase instance = AppDatabase._();

  static Database? _database;

  /// Test hook: lets a test open the schema on an in-memory database
  /// (sqflite_common_ffi) instead of the device path. Never called by
  /// production code.
  static void overrideForTesting(Database database) {
    _database = database;
  }

  Future<Database> get database async {
    if (_database != null) return _database!;

    _database = await _initDatabase();

    return _database!;
  }

  Future<Database> _initDatabase() async {
    final databasePath = await getDatabasesPath();

    final path = join(databasePath, DatabaseConstants.databaseName);

    return openDatabase(
      path,
      version: DatabaseConstants.databaseVersion,
      onCreate: onCreate,
      onUpgrade: onUpgrade,
    );
  }

  Future<void> onCreate(Database db, int version) async {
    // ==========================
    // Company profile
    // ==========================
    await db.execute(Migrations.createCompanyTable);
    await db.execute(Migrations.createCompanyKycTable);
    await db.execute(Migrations.createDocumentTermsTable);

    // ==========================
    // Masters
    // ==========================
    await db.execute(Migrations.createCustomerTable);
    await db.execute(Migrations.createStorageLocationTable);
    await db.execute(Migrations.createChargeHeadTable);
    await seedChargeHeads(db);

    // ==========================
    // Documents
    // ==========================
    await db.execute(Migrations.createQuotationTable);
    await db.execute(Migrations.createQuotationLineTable);
    await db.execute(Migrations.createStorageBookingTable);
    await db.execute(Migrations.createBookingItemTable);
    await db.execute(Migrations.createStoragePhotoTable);
    await db.execute(Migrations.createSignatureRequestTable);
    await db.execute(Migrations.createGoodsReleaseTable);
    await db.execute(Migrations.createReleaseItemTable);
    await db.execute(Migrations.createNoticeTable);
    await db.execute(Migrations.createIncidentTable);
    await db.execute(Migrations.createConsignmentTable);
    await db.execute(Migrations.createConsignmentItemTable);

    // ==========================
    // Billing
    // ==========================
    await db.execute(Migrations.createInvoiceTable);
    await db.execute(Migrations.createInvoiceChargeTable);
    await db.execute(Migrations.createPaymentTable);

    // ==========================
    // Roles / Permissions / Users / Audit
    // ==========================
    await db.execute(Migrations.createRoleTable);
    await db.execute(Migrations.createRolePermissionTable);
    await db.execute(Migrations.createUserTable);
    await seedDefaultRoles(db);
    await db.execute(Migrations.createSecurityAuditTable);

    // ==========================
    // Subscription
    // ==========================
    await db.execute(Migrations.createSubscriptionPlanTable);
    await db.execute(Migrations.createSubscriptionTable);
    await db.execute(Migrations.createPaymentTransactionTable);
    await db.execute(Migrations.createPaymentProofTable);
    await db.execute(Migrations.createSubscriptionHistoryTable);
    await db.execute(Migrations.createSubscriptionSettingsTable);
    await db.execute(Migrations.createSuperAdminTable);
    await seedSubscriptionPlans(db);
    await seedSubscriptionSettings(db);

    // ==========================
    // Cloud backup bookkeeping
    // ==========================
    await db.execute(Migrations.createCloudSyncStateTable);
  }

  Future<void> onUpgrade(Database db, int oldVersion, int newVersion) async {
    // Each version adds its own block here, in order, and bumps
    // DatabaseConstants.databaseVersion. Never edit a CREATE TABLE.
    if (oldVersion < 2) {
      await db.execute(Migrations.createNoticeTable);
      await db.execute(Migrations.createIncidentTable);
    await db.execute(Migrations.createConsignmentTable);
    await db.execute(Migrations.createConsignmentItemTable);
      await db.execute(
        "ALTER TABLE storage_photos ADD COLUMN incident_id TEXT NOT NULL DEFAULT ''",
      );
    }
    if (oldVersion < 3) {
      await db.execute(Migrations.createConsignmentTable);
      await db.execute(Migrations.createConsignmentItemTable);
      await db.execute(
        "ALTER TABLE company_settings ADD COLUMN consignment_prefix TEXT NOT NULL DEFAULT 'LR'",
      );
    }
  }

  /// The charge heads a godown bills for. Storage Rent is the system
  /// head every rent bill starts from; the rest are one-time services
  /// the user can add as extra lines or hide from Masters.
  Future<void> seedChargeHeads(Database db) async {
    const seed = <List<Object>>[
      // code, name, default mode, taxable, system, sort order, default amount
      ['CHG001', 'Storage Rent', 'AMOUNT', 1, 1, 10, 0],
      ['CHG002', 'Loading Charge', 'AMOUNT', 1, 0, 20, 0],
      ['CHG003', 'Unloading Charge', 'AMOUNT', 1, 0, 30, 0],
      ['CHG004', 'Handling Charge', 'AMOUNT', 1, 0, 40, 0],
      ['CHG005', 'Packing Charge', 'AMOUNT', 1, 0, 50, 0],
      ['CHG006', 'Transportation', 'AMOUNT', 1, 0, 60, 0],
      ['CHG007', 'Insurance', 'AMOUNT', 0, 0, 70, 0],
      ['CHG008', 'Fumigation / Pest Control', 'AMOUNT', 1, 0, 80, 0],
      ['CHG009', 'Late Payment Charge', 'AMOUNT', 1, 0, 90, 0],
      ['CHG010', 'Other Charge', 'AMOUNT', 1, 0, 100, 0],
    ];

    final existing = await db.query('charge_heads', columns: ['code']);
    final existingCodes = existing.map((e) => e['code']).toSet();

    for (final row in seed) {
      if (existingCodes.contains(row[0])) continue;

      await db.insert('charge_heads', {
        'id': row[0],
        'code': row[0],
        'charge_name': row[1],
        'default_mode': row[2],
        'default_amount': row[6],
        'taxable': row[3],
        'is_system': row[4],
        'sort_order': row[5],
        'is_active': 1,
      });
    }
  }

  /// Seeds the default roles with their permission grants. Company
  /// Admin always holds every permission; the other roles cover the
  /// way a godown is usually staffed - a manager who runs the floor,
  /// godown staff who receive and release goods, an accounts person
  /// who bills and collects, and a plain staff role that starts empty.
  Future<void> seedDefaultRoles(Database db) async {
    const roles = <List<Object>>[
      // code, name, sort_order
      ['ROLE_COMPANY_ADMIN', 'Company Admin', 10],
      ['ROLE_MANAGER', 'Manager', 20],
      ['ROLE_GODOWN_STAFF', 'Godown Staff', 30],
      ['ROLE_ACCOUNTS', 'Accounts', 40],
      ['ROLE_STAFF', 'Staff', 50],
    ];

    final existingRoles = await db.query('roles', columns: ['code']);
    final existingRoleCodes = existingRoles.map((e) => e['code']).toSet();

    for (final row in roles) {
      if (existingRoleCodes.contains(row[0])) continue;

      await db.insert('roles', {
        'id': row[0],
        'code': row[0],
        'name': row[1],
        'is_system': 1,
        'is_active': 1,
        'sort_order': row[2],
      });
    }

    final allPermissions = Permission.values.map((p) => p.code).toList();

    // Manager: everything operational and financial, but no user/role
    // or company-settings ownership.
    const managerPermissions = [
      'customerView', 'customerCreate', 'customerEdit',
      'bookingView', 'bookingCreate', 'bookingEdit',
      'releaseView', 'releaseCreate', 'releaseEdit',
      'invoiceView', 'invoiceCreate', 'invoiceEdit',
      'paymentView', 'paymentCreate',
      'mastersView',
      'reportsView', 'dashboardView',
    ];

    // Godown staff: receive and release goods, look up customers -
    // no billing, no masters.
    const godownStaffPermissions = [
      'customerView', 'customerCreate',
      'bookingView', 'bookingCreate', 'bookingEdit',
      'releaseView', 'releaseCreate',
      'dashboardView',
    ];

    // Accounts: bills, receipts, reports - view-only on the floor.
    const accountsPermissions = [
      'customerView',
      'bookingView', 'releaseView',
      'invoiceView', 'invoiceCreate', 'invoiceEdit', 'invoiceFinalize',
      'paymentView', 'paymentCreate', 'paymentEdit',
      'reportsView', 'dashboardView',
    ];

    const staffPermissions = <String>[];

    final rolePermissions = <String, List<String>>{
      'ROLE_COMPANY_ADMIN': allPermissions,
      'ROLE_MANAGER': managerPermissions,
      'ROLE_GODOWN_STAFF': godownStaffPermissions,
      'ROLE_ACCOUNTS': accountsPermissions,
      'ROLE_STAFF': staffPermissions,
    };

    final existingGrants = await db.query(
      'role_permissions',
      columns: ['role_id', 'permission_code'],
    );
    final existingGrantKeys = existingGrants
        .map((e) => '${e['role_id']}|${e['permission_code']}')
        .toSet();

    for (final entry in rolePermissions.entries) {
      final roleId = entry.key;

      for (final permissionCode in entry.value) {
        final key = '$roleId|$permissionCode';
        if (existingGrantKeys.contains(key)) continue;

        await db.insert('role_permissions', {
          'id': '$roleId-$permissionCode',
          'role_id': roleId,
          'permission_code': permissionCode,
        });
      }
    }
  }

  /// The four subscription plans. Prices here are the launch prices;
  /// Super Admin can change them from the Super Admin settings, and a
  /// later price change for existing installs needs an explicit UPDATE
  /// step in onUpgrade (this seed skips codes that already exist).
  Future<void> seedSubscriptionPlans(Database db) async {
    const plans = <List<Object>>[
      // code, name, duration_months, sort_order, price
      ['PLAN_QUARTERLY', 'Quarterly', 3, 10, 699.0],
      ['PLAN_HALF_YEARLY', 'Half-Yearly', 6, 20, 1399.0],
      ['PLAN_YEARLY', 'Yearly', 12, 30, 2699.0],
      ['PLAN_2_YEAR', '2-Year', 24, 40, 5299.0],
    ];

    final existing = await db.query('subscription_plans', columns: ['code']);
    final existingCodes = existing.map((e) => e['code']).toSet();

    for (final row in plans) {
      if (existingCodes.contains(row[0])) continue;

      await db.insert('subscription_plans', {
        'id': row[0],
        'code': row[0],
        'name': row[1],
        'duration_months': row[2],
        'price': row[4],
        'discount_amount': 0,
        'tax_percent': 0,
        'sort_order': row[3],
        'is_active': 1,
        'is_recommended': row[0] == 'PLAN_YEARLY' ? 1 : 0,
      });
    }
  }

  /// The single subscription_settings row. Defaults match
  /// SubscriptionSettingsModel's own constructor defaults exactly.
  Future<void> seedSubscriptionSettings(Database db) async {
    final existing = await db.query(
      'subscription_settings',
      where: 'id = ?',
      whereArgs: ['DEFAULT'],
    );

    if (existing.isNotEmpty) return;

    await db.insert('subscription_settings', {
      'id': 'DEFAULT',
      'upi_id': '',
      'merchant_name': '',
      'qr_image_path': null,
      'whatsapp_number': '',
      'support_phone_number': '',
      'payment_instructions': '',
      'demo_generation_limit': 2,
      'watermark_text': 'DEMO - UNLICENSED COPY',
      'watermark_opacity': 0.05,
      'expiry_warning_days_csv': '30,15,7,3,1',
      'grace_period_days': 0,
      'updated_at': DateTime.now().toIso8601String(),
    });
  }
}
