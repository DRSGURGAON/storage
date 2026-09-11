/// Every CREATE TABLE statement of the local SQLite database, one
/// constant per table. All use IF NOT EXISTS so a statement can be
/// re-run safely from an upgrade step. Tenant-owned tables carry a
/// company_id column (see DatabaseConstants.tenantTables) that every
/// DAO filters on through DatabaseHelper's *Scoped helpers.
class Migrations {
  Migrations._();

  // ==========================
  // Company profile (single row - the letterhead)
  // ==========================

  static const String createCompanyTable = '''
  CREATE TABLE IF NOT EXISTS company_settings(

    id INTEGER PRIMARY KEY,

    /* Stable tenant identifier. The INTEGER id above is local-only and
       cannot be used as a key once data syncs to the cloud. */
    company_id TEXT NOT NULL DEFAULT '',

    /* Human-readable company code, e.g. DRS001. Distinct from company_id:
       this is shown to the user, company_id never is. */
    company_code TEXT NOT NULL DEFAULT '',

    company_name TEXT NOT NULL,
    tag_line TEXT,

    logo_path TEXT,
    signature_path TEXT,
    stamp_path TEXT,
    authorized_signatory_name TEXT,

    /* Purely visual PDF theme - see DocumentTheme. Column name kept
       as quotation_theme for backward compatibility with existing
       databases; the Dart-side class/field were renamed to
       DocumentTheme/documentTheme since this now styles every
       generated PDF, not just the Quotation it was originally named
       after. Defaults to 'classic' (matches the pre-existing PDF
       appearance) when unset. */
    quotation_theme TEXT,

    mobile1 TEXT,
    mobile2 TEXT,
    mobile3 TEXT,
    mobile4 TEXT,

    whatsapp TEXT,
    landline TEXT,
    tollfree TEXT,

    email TEXT,
    website TEXT,

    gst_number TEXT,
    pan_number TEXT,
    msme_number TEXT,
    iso_certificate TEXT,

    address TEXT,
    city TEXT,
    state TEXT,
    pincode TEXT,
    jurisdiction TEXT,

    beneficiary_name TEXT,
    bank_name TEXT,
    branch_name TEXT,
    account_number TEXT,
    ifsc_code TEXT,

    upi1 TEXT,
    upi2 TEXT,
    phonepe TEXT,
    gpay TEXT,
    paytm TEXT,

    affiliated_by TEXT,

    /* Document numbering prefixes, e.g. "SR" -> SR/2026/0001. */
    quotation_prefix TEXT NOT NULL DEFAULT 'QT',
    booking_prefix TEXT NOT NULL DEFAULT 'SR',
    release_prefix TEXT NOT NULL DEFAULT 'RL',
    invoice_prefix TEXT NOT NULL DEFAULT 'INV',
    receipt_prefix TEXT NOT NULL DEFAULT 'MR',

    default_terms TEXT,
    footer TEXT,
    /* Optional second footer line under `footer` (Section: "REPORTS ->
       CUSTOMISE DOCUMENTS") - per-company, e.g. an extra tagline under
       the save-paper line. */
    footer2 TEXT,

    created_at TEXT,
    updated_at TEXT

  );
  ''';

  // ==========================
  // Masters
  // ==========================

  /// The customer master - the depositor whose goods are in storage.
  /// Every document snapshots the customer's details at the time it
  /// was made (name/phone/GST/address on the booking itself), so an
  /// edit here never rewrites an already-issued Warehouse Receipt.
  static const String createCustomerTable = '''
  CREATE TABLE IF NOT EXISTS customers(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL DEFAULT '',

    customer_name TEXT NOT NULL,
    mobile_number TEXT NOT NULL DEFAULT '',
    alt_mobile TEXT,
    email TEXT,

    gst_number TEXT,
    pan_number TEXT,

    address TEXT,
    city TEXT,
    state TEXT,
    pincode TEXT,

    id_proof_type TEXT,
    id_proof_number TEXT,

    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,

    created_at TEXT NOT NULL,
    updated_at TEXT
  );
  ''';

  /// A place inside the godown goods can be kept - a hall, room, rack
  /// or bay. Optional on a booking; purely a label for finding the
  /// goods again, no capacity arithmetic.
  static const String createStorageLocationTable = '''
  CREATE TABLE IF NOT EXISTS storage_locations(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL DEFAULT '',
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,

    UNIQUE(company_id, code)
  );
  ''';

  /// A configurable charge head - everything that can appear as a line
  /// on a rent bill (Storage Rent, Loading, Unloading, Handling,
  /// Insurance, Transport...). Seeded once by AppDatabase.
  static const String createChargeHeadTable = '''
  CREATE TABLE IF NOT EXISTS charge_heads(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL DEFAULT '',
    code TEXT NOT NULL UNIQUE,
    charge_name TEXT NOT NULL,
    default_mode TEXT NOT NULL,
    default_amount REAL NOT NULL DEFAULT 0,
    taxable INTEGER NOT NULL DEFAULT 1,
    is_system INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    description TEXT
  );
  ''';

  // ==========================
  // Quotation
  // ==========================

  /// What the operator quotes a customer before the goods move - the
  /// packing/loading/transport/storage services and their amounts.
  /// Customer details are snapshotted on the row (customer_id is a live
  /// reference for navigation only), so editing the Customer master
  /// never rewrites a quotation already sent.
  static const String createQuotationTable = '''
  CREATE TABLE IF NOT EXISTS quotations(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL DEFAULT '',
    quotation_no TEXT NOT NULL,
    quotation_date TEXT NOT NULL,
    valid_upto TEXT,

    customer_id TEXT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL DEFAULT '',
    customer_gst TEXT,
    customer_address TEXT,
    customer_city TEXT,
    customer_state TEXT,
    customer_pincode TEXT,

    /* Where the goods come from and go to - both optional, since a
       pure storage quotation has neither. */
    from_city TEXT,
    to_city TEXT,
    move_date TEXT,

    /* The storage part of the quote, in plain terms. */
    storage_months REAL NOT NULL DEFAULT 0,
    storage_note TEXT,

    goods_description TEXT,

    subtotal REAL NOT NULL DEFAULT 0,
    discount_value REAL NOT NULL DEFAULT 0,
    gst_percent REAL NOT NULL DEFAULT 0,
    gst_amount REAL NOT NULL DEFAULT 0,
    cgst_amount REAL NOT NULL DEFAULT 0,
    sgst_amount REAL NOT NULL DEFAULT 0,
    igst_amount REAL NOT NULL DEFAULT 0,
    grand_total REAL NOT NULL DEFAULT 0,

    /* 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED' - see QuotationStatus. */
    status TEXT NOT NULL DEFAULT 'DRAFT',

    notes TEXT,
    terms TEXT,

    created_at TEXT NOT NULL,
    updated_at TEXT,

    UNIQUE(company_id, quotation_no)
  );
  ''';

  /// One service line on a quotation. A line can carry an amount, or be
  /// marked Included / Excluded / N/A - the customer must be able to see
  /// which services are part of the price and which are not.
  static const String createQuotationLineTable = '''
  CREATE TABLE IF NOT EXISTS quotation_lines(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL DEFAULT '',
    quotation_id TEXT NOT NULL,

    sort_order INTEGER NOT NULL DEFAULT 0,
    charge_head_id TEXT,
    service_name TEXT NOT NULL,
    description TEXT,

    /* 'AMOUNT' | 'INCLUDED' | 'EXCLUDED' | 'NA' - see ChargeMode. */
    mode TEXT NOT NULL DEFAULT 'AMOUNT',
    quantity REAL NOT NULL DEFAULT 1,
    rate REAL NOT NULL DEFAULT 0,
    amount REAL NOT NULL DEFAULT 0,
    taxable INTEGER NOT NULL DEFAULT 1
  );
  ''';

  // ==========================
  // Storage booking (Warehouse Receipt / Goods Receipt)
  // ==========================

  /// One lot of goods received into storage from one customer. This is
  /// the document the customer holds as proof of deposit, and the
  /// record every later paper hangs off: Inventory List, Storage
  /// Agreement, Delivery Orders / Gate Passes, and monthly rent bills.
  /// Customer details are snapshotted on the row (customer_id is a
  /// live reference for navigation only).
  static const String createStorageBookingTable = '''
  CREATE TABLE IF NOT EXISTS storage_bookings(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL DEFAULT '',
    booking_no TEXT NOT NULL,
    booking_date TEXT NOT NULL,

    customer_id TEXT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL DEFAULT '',
    customer_gst TEXT,
    customer_address TEXT,
    customer_city TEXT,
    customer_state TEXT,
    customer_pincode TEXT,
    customer_id_proof TEXT,

    location_id TEXT,
    location_name TEXT,

    storage_start_date TEXT NOT NULL,
    expected_end_date TEXT,
    actual_end_date TEXT,

    /* 'MONTHLY' | 'DAILY' | 'PER_BOX_MONTHLY' | 'CUSTOM' - how
       rent_rate is applied when a bill is raised. See RentBasis. */
    rent_basis TEXT NOT NULL DEFAULT 'MONTHLY',
    rent_rate REAL NOT NULL DEFAULT 0,
    /* Free-text unit the rate is quoted per, e.g. "month", "sq.ft/month" -
       printed next to the rate, never used in arithmetic. */
    rent_unit_label TEXT,
    area_sqft REAL,
    security_deposit REAL NOT NULL DEFAULT 0,

    total_packages INTEGER NOT NULL DEFAULT 0,
    goods_description TEXT,
    declared_value REAL,
    insurance_note TEXT,

    vehicle_number TEXT,
    driver_name TEXT,
    received_by TEXT,

    /* 'IN_STORAGE' | 'PARTIALLY_RELEASED' | 'RELEASED' | 'CANCELLED' -
       see StorageStatus. Derived from the items' released quantities
       on every release, stored so list screens never re-add them. */
    status TEXT NOT NULL DEFAULT 'IN_STORAGE',

    /* Last date rent has been invoiced up to (ISO date). NULL until the
       first rent bill; every bill from this booking proposes the day
       after as its period start. */
    rent_billed_upto TEXT,

    notes TEXT,
    terms TEXT,

    created_at TEXT NOT NULL,
    updated_at TEXT,

    UNIQUE(company_id, booking_no)
  );
  ''';

  /// One line of goods on a booking - the Inventory List is these rows.
  /// released_qty is maintained by GoodsReleaseRepository so "remaining
  /// in storage" is always quantity - released_qty.
  static const String createBookingItemTable = '''
  CREATE TABLE IF NOT EXISTS booking_items(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL DEFAULT '',
    booking_id TEXT NOT NULL,

    sort_order INTEGER NOT NULL DEFAULT 0,
    item_name TEXT NOT NULL,
    description TEXT,
    quantity REAL NOT NULL DEFAULT 1,
    unit TEXT NOT NULL DEFAULT 'Nos',
    weight TEXT,
    marks TEXT,
    condition_note TEXT,

    released_qty REAL NOT NULL DEFAULT 0
  );
  ''';

  // ==========================
  // Goods release (Delivery Order / Gate Pass)
  // ==========================

  /// One hand-over of goods out of storage against a booking - partial
  /// or full. Prints as a Delivery Order (customer copy) and a Gate
  /// Pass (gate copy) from the same row.
  static const String createGoodsReleaseTable = '''
  CREATE TABLE IF NOT EXISTS goods_releases(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL DEFAULT '',
    release_no TEXT NOT NULL,
    release_date TEXT NOT NULL,

    booking_id TEXT NOT NULL,
    booking_no TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL DEFAULT '',

    /* 'PARTIAL' | 'FULL' */
    release_type TEXT NOT NULL DEFAULT 'PARTIAL',

    /* What the customer still owed when the goods went out, as a
       snapshot - so the record shows what was known at the time. */
    outstanding_at_release REAL NOT NULL DEFAULT 0,

    collected_by_name TEXT,
    collected_by_phone TEXT,
    collected_by_id_proof TEXT,
    vehicle_number TEXT,
    driver_name TEXT,
    gate_out_time TEXT,

    remarks TEXT,

    created_at TEXT NOT NULL,

    UNIQUE(company_id, release_no)
  );
  ''';

  static const String createReleaseItemTable = '''
  CREATE TABLE IF NOT EXISTS release_items(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL DEFAULT '',
    release_id TEXT NOT NULL,
    booking_item_id TEXT NOT NULL,

    sort_order INTEGER NOT NULL DEFAULT 0,
    item_name TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'Nos'
  );
  ''';

  /// A photo taken of the goods - their condition, the boxes, the
  /// packed lot or the area they are kept in. The image itself stays on
  /// the device (file_path); only the record is backed up, the same
  /// honest limitation the company logo and signature have.
  static const String createStoragePhotoTable = '''
  CREATE TABLE IF NOT EXISTS storage_photos(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL DEFAULT '',
    booking_id TEXT NOT NULL,

    file_path TEXT NOT NULL,
    caption TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,

    created_at TEXT NOT NULL
  );
  ''';

  // ==========================
  // Customer signature requests
  // ==========================

  /// A request for a customer's signature on a document, sent to them
  /// as a link. The cloud copy (Firestore, keyed by the same token)
  /// carries what the customer is asked to sign; this row is the
  /// operator's own record of it, so the app shows the state offline
  /// and keeps the signature after the cloud copy is deleted.
  static const String createSignatureRequestTable = '''
  CREATE TABLE IF NOT EXISTS signature_requests(
    /* The token in the link - long and random, so a link cannot be
       guessed from another one. */
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL DEFAULT '',

    /* Which document is being signed - a DocumentType code and the
       row it belongs to. */
    document_type TEXT NOT NULL,
    document_id TEXT NOT NULL,
    document_no TEXT NOT NULL DEFAULT '',

    customer_name TEXT NOT NULL DEFAULT '',
    customer_phone TEXT NOT NULL DEFAULT '',

    /* 'PENDING' | 'SIGNED' | 'CANCELLED' | 'EXPIRED' */
    status TEXT NOT NULL DEFAULT 'PENDING',

    link TEXT NOT NULL DEFAULT '',

    created_at TEXT NOT NULL,
    expires_at TEXT,

    signed_at TEXT,
    signer_name TEXT,

    /* Where the signature image was saved on this device. */
    signature_path TEXT,

    UNIQUE(company_id, id)
  );
  ''';

  // ==========================
  // Rent invoice / bill
  // ==========================

  /// A bill raised on a customer - normally the monthly storage rent
  /// for one booking (period_from..period_to), but booking_id is
  /// nullable so a one-off standalone bill works too. Many bills per
  /// booking (one per rent period), so deliberately NO unique index on
  /// booking_id.
  static const String createInvoiceTable = '''
  CREATE TABLE IF NOT EXISTS invoices(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL DEFAULT '',
    invoice_no TEXT NOT NULL,
    invoice_date TEXT NOT NULL,

    booking_id TEXT,
    booking_no TEXT,
    customer_id TEXT,

    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL DEFAULT '',
    customer_gst TEXT,
    customer_address TEXT,
    customer_city TEXT,
    customer_state TEXT,
    customer_pincode TEXT,

    period_from TEXT,
    period_to TEXT,
    due_date TEXT,

    subtotal REAL NOT NULL DEFAULT 0,
    discount_value REAL NOT NULL DEFAULT 0,
    gst_percent REAL NOT NULL DEFAULT 0,
    gst_amount REAL NOT NULL DEFAULT 0,
    cgst_amount REAL NOT NULL DEFAULT 0,
    sgst_amount REAL NOT NULL DEFAULT 0,
    igst_amount REAL NOT NULL DEFAULT 0,
    grand_total REAL NOT NULL DEFAULT 0,

    /* Stored, not computed on read - recalculated transactionally by
       InvoiceRepository on every Payment create/edit/delete. */
    amount_paid REAL NOT NULL DEFAULT 0,

    status TEXT NOT NULL DEFAULT 'UNPAID',
    notes TEXT,

    created_at TEXT NOT NULL,

    UNIQUE(company_id, invoice_no)
  );
  ''';

  /// One line on a bill - quantity x rate, or a plain amount.
  static const String createInvoiceChargeTable = '''
  CREATE TABLE IF NOT EXISTS invoice_charges(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL DEFAULT '',
    invoice_id TEXT NOT NULL,

    charge_name TEXT NOT NULL,
    description TEXT,
    quantity REAL NOT NULL DEFAULT 1,
    rate REAL NOT NULL DEFAULT 0,
    amount REAL NOT NULL DEFAULT 0,
    taxable INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  ''';

  /// One payment - against a bill, or a standalone Money Receipt
  /// (invoice_id NULL). See PaymentModel.
  static const String createPaymentTable = '''
  CREATE TABLE IF NOT EXISTS payments(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL DEFAULT '',

    /* NULL means this receipt is not against any one bill - an advance
       or an on-account payment. See PaymentModel.isOnAccount. */
    invoice_id TEXT,

    /* Who paid, and which storage record it relates to - both live
       references for the customer statement and for navigation. */
    customer_id TEXT,
    booking_id TEXT,

    /* Every receipt carries its own number (Company Settings ->
       receiptPrefix), whether or not it is against a bill. */
    receipt_no TEXT,

    amount REAL NOT NULL DEFAULT 0,
    mode TEXT NOT NULL DEFAULT 'CASH',

    /* What the payment represents in the deal (full settlement vs a
       part payment) - independent of `mode`, which is only how the
       money arrived. See PaymentType. */
    payment_type TEXT NOT NULL DEFAULT 'FULL_PAYMENT',

    payment_date TEXT NOT NULL,
    reference_no TEXT,
    notes TEXT,

    /* Snapshotted so a receipt prints correctly even if the customer
       record is edited later. */
    payer_name TEXT,
    payer_phone TEXT,
    "against" TEXT,

    created_at TEXT NOT NULL,

    UNIQUE(company_id, receipt_no)
  );
  ''';

  // ==========================
  // Roles / Permissions / Users
  // ==========================

  static const String createRoleTable = '''
  CREATE TABLE IF NOT EXISTS roles(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL DEFAULT '',
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    is_system INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,

    UNIQUE(company_id, code)
  );
  ''';

  static const String createRolePermissionTable = '''
  CREATE TABLE IF NOT EXISTS role_permissions(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL DEFAULT '',
    role_id TEXT NOT NULL,
    permission_code TEXT NOT NULL,

    UNIQUE(role_id, permission_code)
  );
  ''';

  static const String createUserTable = '''
  CREATE TABLE IF NOT EXISTS users(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    mobile_number TEXT NOT NULL,
    role_id TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,

    created_at TEXT NOT NULL,

    UNIQUE(company_id, mobile_number)
  );
  ''';

  static const String createSecurityAuditTable = '''
  CREATE TABLE IF NOT EXISTS security_audit(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL DEFAULT '',
    event_type TEXT NOT NULL,
    description TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    actor_mobile_number TEXT,

    created_at TEXT NOT NULL
  );
  ''';

  // ==========================
  // Per-document Terms & Conditions
  // ==========================

  static const String createDocumentTermsTable = '''
  CREATE TABLE IF NOT EXISTS document_terms(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL DEFAULT '',

    /* One of DocumentTermsType's codes - 'warehouse_receipt',
       'storage_agreement', 'delivery_order', 'bill', 'money_receipt' */
    doc_type TEXT NOT NULL,

    terms TEXT,

    updated_at TEXT,

    UNIQUE(company_id, doc_type)
  );
  ''';

  // ==========================
  // Company KYC
  // ==========================

  static const String createCompanyKycTable = '''
  CREATE TABLE IF NOT EXISTS company_kyc(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL DEFAULT '',

    pan_file_path TEXT,
    pan_file_name TEXT,

    second_doc_type TEXT,
    second_file_path TEXT,
    second_file_name TEXT,

    status TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
    submitted_at TEXT,
    reviewed_at TEXT,
    rejection_reason TEXT,

    UNIQUE(company_id)
  );
  ''';

  // ==========================
  // Subscription & Manual Payment Authorization
  // ==========================

  static const String createSubscriptionPlanTable = '''
  CREATE TABLE IF NOT EXISTS subscription_plans(
    id TEXT PRIMARY KEY,

    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    duration_months INTEGER NOT NULL,

    price REAL NOT NULL DEFAULT 0,
    discount_amount REAL NOT NULL DEFAULT 0,
    tax_percent REAL NOT NULL DEFAULT 0,

    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    is_recommended INTEGER NOT NULL DEFAULT 0
  );
  ''';

  static const String createSubscriptionTable = '''
  CREATE TABLE IF NOT EXISTS subscriptions(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL,
    plan_id TEXT,

    status TEXT NOT NULL DEFAULT 'LIMITED',

    start_date TEXT,
    expiry_date TEXT,

    demo_generations_used_json TEXT NOT NULL DEFAULT '{}',

    /* Firebase Auth uid of the subscription's owner - see
       database_constants.dart's own v37 comment for why this exists. */
    owner_uid TEXT,

    /* Denormalized copy of the company's own display name - see
       database_constants.dart's own v48 comment for why. Super
       Admin's cross-company Dashboard list needs a per-row name
       without a second Firestore round-trip per company. */
    company_name TEXT NOT NULL DEFAULT '',

    /* 5 more denormalized company-profile fields - see
       database_constants.dart's own v49 comment for why. Super
       Admin's cross-company Company Detail screen needs THIS
       company's real profile fields, not the Super Admin's own
       device-local company. */
    owner_mobile TEXT NOT NULL DEFAULT '',
    gst_number TEXT NOT NULL DEFAULT '',
    authorized_signatory_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    company_code TEXT NOT NULL DEFAULT '',

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    UNIQUE(company_id)
  );
  ''';

  static const String createPaymentTransactionTable = '''
  CREATE TABLE IF NOT EXISTS payment_transactions(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL,
    subscription_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,

    method TEXT NOT NULL DEFAULT 'MANUAL_UPI',
    amount REAL NOT NULL DEFAULT 0,

    utr_number TEXT,
    payer_name TEXT,
    payment_date TEXT NOT NULL,

    proof_id TEXT,
    remark TEXT,

    status TEXT NOT NULL DEFAULT 'UNDER_REVIEW',

    reviewed_by_mobile_number TEXT,
    reviewed_at TEXT,
    rejection_reason TEXT,

    provider_reference TEXT,
    provider_transaction_id TEXT,

    created_at TEXT NOT NULL
  );
  ''';

  static const String createPaymentProofTable = '''
  CREATE TABLE IF NOT EXISTS payment_proofs(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL,

    file_path TEXT NOT NULL,
    file_name TEXT,
    file_size_bytes INTEGER NOT NULL DEFAULT 0,

    uploaded_at TEXT NOT NULL
  );
  ''';

  static const String createSubscriptionHistoryTable = '''
  CREATE TABLE IF NOT EXISTS subscription_history(
    id TEXT PRIMARY KEY,

    company_id TEXT NOT NULL,
    subscription_id TEXT NOT NULL,

    plan_id TEXT NOT NULL,
    plan_name TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,

    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,

    payment_reference TEXT,
    payment_method TEXT,

    authorized_by_mobile_number TEXT,
    authorization_date TEXT NOT NULL,

    status TEXT NOT NULL,
    remarks TEXT
  );
  ''';

  static const String createSubscriptionSettingsTable = '''
  CREATE TABLE IF NOT EXISTS subscription_settings(
    id TEXT PRIMARY KEY,

    upi_id TEXT,
    merchant_name TEXT,
    qr_image_path TEXT,
    qr_label_1 TEXT,
    qr_image_path_2 TEXT,
    qr_label_2 TEXT,

    whatsapp_number TEXT,
    support_phone_number TEXT,

    payment_instructions TEXT,

    demo_generation_limit INTEGER NOT NULL DEFAULT 2,

    watermark_text TEXT NOT NULL DEFAULT 'DEMO - UNLICENSED COPY',
    watermark_opacity REAL NOT NULL DEFAULT 0.05,

    expiry_warning_days_csv TEXT NOT NULL DEFAULT '30,15,7,3,1',
    grace_period_days INTEGER NOT NULL DEFAULT 0,

    updated_at TEXT NOT NULL
  );
  ''';

  static const String createSuperAdminTable = '''
  CREATE TABLE IF NOT EXISTS super_admins(
    id TEXT PRIMARY KEY,

    mobile_number TEXT NOT NULL UNIQUE,
    name TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,

    created_at TEXT NOT NULL
  );
  ''';

  // ==========================
  // Cloud backup bookkeeping
  // ==========================

  static const String createCloudSyncStateTable = '''
  CREATE TABLE IF NOT EXISTS cloud_sync_state(
    table_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    row_hash TEXT NOT NULL,

    PRIMARY KEY(table_name, row_id)
  );
  ''';
}
