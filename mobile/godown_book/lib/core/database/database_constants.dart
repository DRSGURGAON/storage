class DatabaseConstants {
  /// Every table whose rows belong to a single company. Kept here so the
  /// migration, the DAO helpers and the cloud backup all read one list.
  static const List<String> tenantTables = [
    'customers',
    'quotations',
    'quotation_lines',
    'storage_locations',
    'charge_heads',
    'storage_bookings',
    'booking_items',
    'goods_releases',
    'release_items',
    'invoices',
    'invoice_charges',
    'payments',
    'roles',
    'role_permissions',
    'users',
    'security_audit',
    'document_terms',
    'company_kyc',
  ];

  static const String companyIdColumn = 'company_id';

  DatabaseConstants._();

  // ==========================
  // Database
  // ==========================

  static const String databaseName = 'godown_book.db';

  // v1: the first schema of Godown Book - company profile, customers,
  // storage locations, charge heads, quotations with their service
  // lines, storage records with their goods items, goods releases with
  // their items, storage bills with charge lines, payments (receipts),
  // roles/permissions/users, security audit, per-document terms,
  // company KYC, the subscription system and the cloud-sync
  // bookkeeping table. Every later change is an explicit
  // step in AppDatabase._onUpgrade, never an edit to an existing
  // CREATE TABLE.
  static const int databaseVersion = 1;

  // ==========================
  // Masters
  // ==========================

  static const String customerTable = 'customers';
  static const String storageLocationTable = 'storage_locations';
  static const String chargeHeadTable = 'charge_heads';

  // ==========================
  // Documents
  // ==========================

  static const String quotationTable = 'quotations';
  static const String quotationLineTable = 'quotation_lines';

  static const String storageBookingTable = 'storage_bookings';
  static const String bookingItemTable = 'booking_items';
  static const String goodsReleaseTable = 'goods_releases';
  static const String releaseItemTable = 'release_items';

  // ==========================
  // Billing
  // ==========================

  static const String invoiceTable = 'invoices';
  static const String invoiceChargeTable = 'invoice_charges';
  static const String paymentTable = 'payments';

  // ==========================
  // Company / users / platform
  // ==========================

  static const String companyTable = 'company_settings';
  static const String roleTable = 'roles';
  static const String rolePermissionTable = 'role_permissions';
  static const String userTable = 'users';
  static const String securityAuditTable = 'security_audit';
  static const String documentTermsTable = 'document_terms';
  static const String companyKycTable = 'company_kyc';
  static const String cloudSyncStateTable = 'cloud_sync_state';
}
