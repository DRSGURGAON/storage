/// Every distinct permission the app can check - one flat enum rather
/// than a category/action pair, so a check site is a single, greppable
/// `hasPermission(Permission.xxx)` call. Grouped into categories purely
/// for organizing this file and the role matrix seeded by AppDatabase;
/// the enum itself has no nested structure.
enum Permission {
  // Customers
  customerView,
  customerCreate,
  customerEdit,
  customerDeactivate,

  // Storage booking (Warehouse Receipt / Inventory / Agreement)
  bookingView,
  bookingCreate,
  bookingEdit,
  bookingDelete,

  // Goods release (Delivery Order / Gate Pass)
  releaseView,
  releaseCreate,
  releaseEdit,

  // Rent invoice / bill
  invoiceView,
  invoiceCreate,
  invoiceEdit,
  invoiceFinalize,

  // Payment / Money Receipt
  paymentView,
  paymentCreate,
  paymentEdit,

  // Masters (charge heads, storage locations)
  mastersView,
  mastersManage,

  // Reports
  reportsView,

  // Dashboard
  dashboardView,

  // Company Settings
  companySettingsManage,

  // Users/Roles
  usersView,
  usersCreate,
  usersEdit,
  usersDeactivate,
  usersManagePermissions;

  String get code => name;

  static Permission? fromCode(String code) {
    for (final permission in Permission.values) {
      if (permission.code == code) return permission;
    }
    return null;
  }
}
