import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/auth/auth_scope.dart';
import 'package:godown_book/core/cloud_sync/document_cloud_sync_service.dart';
import 'package:godown_book/core/customer/customer_lookup_service.dart';
import 'package:godown_book/core/database/app_database.dart';
import 'package:godown_book/core/database/database_constants.dart';
import 'package:godown_book/core/tenant/tenant_bootstrap.dart';
import 'package:godown_book/core/tenant/tenant_scope.dart';
import 'package:godown_book/features/billing/models/payment_model.dart';
import 'package:godown_book/features/billing/repositories/billing_repository.dart';
import 'package:godown_book/features/company/controllers/company_controller.dart';
import 'package:godown_book/features/company/models/company_model.dart';
import 'package:godown_book/features/company/services/company_firestore_sync_service.dart';
import 'package:godown_book/features/customers/models/customer_model.dart';
import 'package:godown_book/features/customers/repositories/customer_repository.dart';
import 'package:godown_book/features/quotation/models/quotation_model.dart';
import 'package:godown_book/features/quotation/repositories/quotation_repository.dart';
import 'package:godown_book/features/release/repositories/goods_release_repository.dart';
import 'package:godown_book/features/storage_booking/models/booking_item_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_booking_model.dart';
import 'package:godown_book/features/storage_booking/repositories/storage_booking_repository.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// The company follows the account. A reinstall or a second phone gets
/// the account's cloud company and every backed-up document back; a
/// new account gets a new company; two accounts on one phone never see
/// each other's rows, and each finds its own data again on signing
/// back in.
///
/// One fake Firestore stands in for the cloud; each "phone" is its own
/// SQLite file, opened fresh the way a real install would be.
const uidA = 'uid-account-a';
const uidB = 'uid-account-b';

late FakeFirebaseFirestore cloud;
late Directory scratch;
String? signedIn;
Database? current;

Future<Database> _openPhone(String name) async {
  final db = await databaseFactory.openDatabase(
    '${scratch.path}/$name.db',
    options: OpenDatabaseOptions(
      version: DatabaseConstants.databaseVersion,
      onCreate: AppDatabase.instance.onCreate,
      onUpgrade: AppDatabase.instance.onUpgrade,
    ),
  );
  AppDatabase.overrideForTesting(db);
  CustomerLookupService.instance.invalidate();
  return db;
}

/// Switches to [name]'s database, closing the previous one - what
/// happens to a phone's storage when the app is wiped and reinstalled
/// is simply "a different file".
Future<Database> usePhone(String name) async {
  await current?.close();
  current = await _openPhone(name);
  return current!;
}

/// A reinstall: nothing on disk, nobody signed in, no preferences.
Future<void> freshInstall(String name) async {
  TenantScope.clear();
  AuthScope.clear();
  SharedPreferences.setMockInitialValues({});
  signedIn = null;
  await usePhone(name);
}

void signIn(String uid) => signedIn = uid;

Future<void> makeCompanyAndData({required String companyName}) async {
  await CompanyController.instance.saveCompany(CompanyModel(
    companyName: companyName,
    address: 'GT Road',
    city: 'Karnal',
    state: 'Haryana',
    mobile1: '9999999999',
  ));
  final customer = await CustomerRepository.instance.create(CustomerModel(
    id: '',
    customerName: '$companyName customer',
    mobileNumber: '9876500001',
    createdAt: '',
  ));
  await QuotationRepository.instance.save(QuotationModel(
    id: '',
    quotationDate: '2026-09-01',
    customerId: customer.id,
    customerName: customer.customerName,
    customerPhone: customer.mobileNumber,
    createdAt: '',
    lines: const [
      QuotationLineModel(id: '', serviceName: 'Packing', rate: 500, amount: 500),
    ],
  ));
  final booking = await StorageBookingRepository.instance.save(StorageBookingModel(
    id: '',
    bookingDate: '2026-09-01T00:00:00',
    customerId: customer.id,
    customerName: customer.customerName,
    customerPhone: customer.mobileNumber,
    storageStartDate: '2026-09-01T00:00:00',
    rentRate: 3500,
    items: const [
      BookingItemModel(id: '', bookingId: '', itemName: 'Sofa', quantity: 1),
      BookingItemModel(id: '', bookingId: '', itemName: 'Cartons', quantity: 10),
    ],
    createdAt: '',
  ));
  final bill = await BillingRepository.instance.saveBill(
    await BillingRepository.instance
        .draftForBooking(booking, upto: DateTime(2026, 9, 30)),
  );
  await BillingRepository.instance.recordPayment(PaymentModel(
    id: '',
    billId: bill.id,
    customerId: customer.id,
    bookingId: booking.id,
    payerName: customer.customerName,
    amount: 1000,
    mode: PaymentMode.cash,
    paymentType: PaymentType.partPayment,
    paymentDate: '2026-10-02T00:00:00',
    createdAt: '',
  ));
  final reloaded = (await StorageBookingRepository.instance.getById(booking.id))!;
  final draft = GoodsReleaseRepository.instance.draftForBooking(reloaded);
  await GoodsReleaseRepository.instance.save(draft.copyWith(
    items: [draft.items[1].copyWith(quantity: 4)],
    releaseDate: '2026-10-05T00:00:00',
  ));
}

Future<Map<String, int>> counts() async => {
      'customers': (await CustomerRepository.instance.getAll()).length,
      'quotations': (await QuotationRepository.instance.getAll()).length,
      'bookings': (await StorageBookingRepository.instance.getAll()).length,
      'bills': (await BillingRepository.instance.getAllBills()).length,
      'payments': (await BillingRepository.instance.getAllPayments()).length,
      'releases': (await GoodsReleaseRepository.instance.getAll()).length,
    };

Future<int> cloudRows(String uid, String table) async =>
    (await cloud.collection('companies').doc(uid).collection(table).get())
        .docs
        .length;

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() async {
    scratch = Directory.systemTemp.createTempSync('godown-tenant');
    cloud = FakeFirebaseFirestore();
    CompanyFirestoreSyncService.firestoreOverride = cloud;
    DocumentCloudSyncService.firestoreOverride = cloud;
    CompanyFirestoreSyncService.currentUidOverride = null;
    DocumentCloudSyncService.currentUidOverride = null;
    TenantBootstrap.currentUidOverride = () => signedIn;
    // The services read the signed-in account the same way.
    CompanyFirestoreSyncService.currentUidOverride = '';
    DocumentCloudSyncService.currentUidOverride = '';
    await freshInstall('phone-1');
  });

  tearDown(() async {
    await current?.close();
    current = null;
    CompanyFirestoreSyncService.firestoreOverride = null;
    DocumentCloudSyncService.firestoreOverride = null;
    CompanyFirestoreSyncService.currentUidOverride = null;
    DocumentCloudSyncService.currentUidOverride = null;
    TenantBootstrap.currentUidOverride = null;
    TenantScope.clear();
    AuthScope.clear();
    if (scratch.existsSync()) scratch.deleteSync(recursive: true);
  });

  /// The sync services take the account from their own override; keep
  /// it in step with the pretend sign-in.
  void asAccount(String? uid) {
    signIn(uid ?? '');
    signedIn = uid;
    CompanyFirestoreSyncService.currentUidOverride = uid ?? '';
    DocumentCloudSyncService.currentUidOverride = uid ?? '';
  }

  test('a fresh install creates nothing before anybody signs in', () async {
    await TenantBootstrap.loadAtStartup();
    expect(TenantScope.isReady, isFalse);
    expect(await CompanyController.instance.getCompany(), isNull);
  });

  test('A: fresh install + existing account restores company and documents',
      () async {
    // Phone 1: account A sets up and works, and the backup runs.
    asAccount(uidA);
    final first = await TenantBootstrap.bootstrapAfterLogin(uidA);
    expect(first.outcome, TenantBootstrapOutcome.createdNew);
    await makeCompanyAndData(companyName: 'Sharma Packers');
    final companyId = TenantScope.companyId;
    final before = await counts();
    expect(before.values.every((n) => n == 1), isTrue, reason: '$before');

    final backup = await DocumentCloudSyncService.instance.syncNow();
    expect(backup.succeeded, isTrue, reason: backup.error);
    expect(await cloudRows(uidA, 'customers'), 1);
    expect(await cloudRows(uidA, 'invoices'), 1);
    expect(await cloudRows(uidA, 'goods_releases'), 1);

    // Phone 2 (or the same phone after uninstall): nothing on disk.
    await freshInstall('phone-2');
    await TenantBootstrap.loadAtStartup();
    expect(TenantScope.isReady, isFalse, reason: 'nothing before sign-in');

    asAccount(uidA);
    final restored = await TenantBootstrap.bootstrapAfterLogin(uidA);
    expect(restored.outcome, TenantBootstrapOutcome.restoredFromCloud);
    expect(restored.companyId, companyId, reason: 'same company id');
    expect(restored.error, isNull);
    expect(TenantScope.companyId, companyId);

    final company = (await CompanyController.instance.getCompany())!;
    expect(company.companyName, 'Sharma Packers');
    expect(company.companyId, companyId);

    expect(await counts(), before);
    final customer = (await CustomerRepository.instance.getAll()).single;
    final statement =
        await BillingRepository.instance.statementForCustomer(customer.id);
    expect(statement.map((e) => e.runningBalance), [3500, 2500]);
    final bookingAfter = (await StorageBookingRepository.instance.getAll()).single;
    expect(bookingAfter.remainingQuantity, 7);

    // Nothing in the cloud was deleted by restoring, and a backup pass
    // right after has nothing to push and nothing to delete.
    expect(await cloudRows(uidA, 'customers'), 1);
    final again = await DocumentCloudSyncService.instance.syncNow();
    expect(again.pushed, 0);
    expect(again.deleted, 0);
    expect(await cloudRows(uidA, 'invoices'), 1);

    // A restart keeps the restored company without touching the cloud.
    TenantScope.clear();
    await TenantBootstrap.loadAtStartup();
    expect(TenantScope.companyId, companyId);
  });

  test('B: fresh install + new account starts a new company, pushes nothing',
      () async {
    asAccount(uidB);
    final result = await TenantBootstrap.bootstrapAfterLogin(uidB);
    expect(result.outcome, TenantBootstrapOutcome.createdNew);
    expect(TenantScope.isReady, isTrue);

    final company = (await CompanyController.instance.getCompany())!;
    expect(company.companyId, isNotEmpty);
    expect(company.companyName, isEmpty);
    expect((await counts()).values, everyElement(0));

    // The empty shell never reaches the cloud.
    expect((await cloud.collection('companies').doc(uidB).get()).exists, isFalse);

    // Filling in the name is what publishes it.
    await CompanyController.instance
        .saveCompany(company.copyWith(companyName: 'New Movers', mobile1: '9', address: 'x'));
    final doc = await cloud.collection('companies').doc(uidB).get();
    expect(doc.exists, isTrue);
    expect(doc.data()!['companyId'], company.companyId);
  });

  test('C and D: two accounts on one phone never see each other, and each '
      'gets its own data back', () async {
    // Account A works on this phone.
    asAccount(uidA);
    await TenantBootstrap.bootstrapAfterLogin(uidA);
    await makeCompanyAndData(companyName: 'Sharma Packers');
    final companyA = TenantScope.companyId;
    final dataA = await counts();

    // A signs out: latest work backed up, active tenant gone.
    final backup = await TenantBootstrap.beforeSignOut();
    expect(backup.succeeded, isTrue, reason: backup.error);
    TenantBootstrap.clearActiveTenant();
    asAccount(null);
    expect(TenantScope.isReady, isFalse);

    // B signs in on the same phone: a company of their own, empty.
    asAccount(uidB);
    final forB = await TenantBootstrap.bootstrapAfterLogin(uidB);
    expect(forB.outcome, TenantBootstrapOutcome.createdNew);
    final companyB = TenantScope.companyId;
    expect(companyB, isNot(companyA));
    expect((await counts()).values, everyElement(0), reason: 'B must not see A');
    expect((await CompanyController.instance.getCompany())!.companyName, isEmpty);

    // B works, and the backup goes under B's own path only.
    await makeCompanyAndData(companyName: 'Verma Storage');
    final pushB = await DocumentCloudSyncService.instance.syncNow();
    expect(pushB.succeeded, isTrue, reason: pushB.error);
    expect(pushB.deleted, 0, reason: "A's rows on this phone are not deletions");
    expect(await cloudRows(uidB, 'customers'), 1);
    expect(await cloudRows(uidA, 'customers'), 1, reason: 'A untouched');
    final cloudCustomerB =
        (await cloud.collection('companies').doc(uidB).collection('customers').get())
            .docs
            .single
            .data();
    expect(cloudCustomerB['company_id'], companyB);
    expect(cloudCustomerB['customer_name'], 'Verma Storage customer');

    // B signs out, A signs back in: A's company and data are back.
    await TenantBootstrap.beforeSignOut();
    TenantBootstrap.clearActiveTenant();
    asAccount(null);

    asAccount(uidA);
    final backToA = await TenantBootstrap.bootstrapAfterLogin(uidA);
    expect(backToA.outcome, TenantBootstrapOutcome.restoredFromCloud);
    expect(TenantScope.companyId, companyA);
    expect((await CompanyController.instance.getCompany())!.companyName, 'Sharma Packers');
    expect(await counts(), dataA);
    expect((await CustomerRepository.instance.getAll()).single.customerName,
        'Sharma Packers customer');

    // And A's backup is still whole after the round trip.
    final afterRoundTrip = await DocumentCloudSyncService.instance.syncNow();
    expect(afterRoundTrip.deleted, 0);
    expect(await cloudRows(uidA, 'invoices'), 1);
    expect(await cloudRows(uidB, 'invoices'), 1);
  });

  test('an install from before ownership was recorded keeps its company',
      () async {
    // What every existing phone looks like: a company saved earlier,
    // no owner recorded, the account signed in.
    asAccount(uidA);
    await CompanyController.instance.saveCompany(const CompanyModel(
        companyName: 'Old Install Movers', address: 'x', mobile1: '9'));
    final companyId = TenantScope.companyId;
    TenantScope.clear();
    SharedPreferences.setMockInitialValues({});

    await TenantBootstrap.loadAtStartup();
    expect(TenantScope.companyId, companyId);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(TenantBootstrap.ownerUidKey), uidA);
  });

  test('the pre-login shell of an old install gives way to the cloud company',
      () async {
    // The bug itself: an old startup created an empty shell before
    // sign-in while the account's real company sat in the cloud.
    cloud.collection('companies').doc(uidA).set({
      'companyId': 'real-company-id',
      'companyName': 'Sharma Packers',
      'address': 'GT Road',
      'mobile1': '9999999999',
    });
    cloud
        .collection('companies')
        .doc(uidA)
        .collection('customers')
        .doc('cust-1')
        .set({
      'id': 'cust-1',
      'company_id': 'real-company-id',
      'customer_name': 'Cloud Customer',
      'mobile_number': '9876500001',
      'is_active': 1,
      'created_at': '2026-09-01T00:00:00',
    });

    asAccount(null);
    await CompanyController.instance.saveCompany(const CompanyModel(companyName: ''));
    final shellId = TenantScope.companyId;
    expect(shellId, isNot('real-company-id'));
    TenantScope.clear();
    SharedPreferences.setMockInitialValues({});

    asAccount(uidA);
    AuthScope.set(true);
    await TenantBootstrap.loadAtStartup();
    expect(TenantScope.companyId, 'real-company-id');
    expect((await CompanyController.instance.getCompany())!.companyName, 'Sharma Packers');
    expect((await CustomerRepository.instance.getAll()).single.customerName,
        'Cloud Customer');
  });

  test('a shell never overwrites a real cloud company', () async {
    cloud.collection('companies').doc(uidA).set({
      'companyId': 'real-company-id',
      'companyName': 'Sharma Packers',
    });
    asAccount(uidA);

    // An empty shell is never pushed.
    expect(
      await CompanyFirestoreSyncService.instance
          .pushToCloud(const CompanyModel(companyId: 'other-id', companyName: '')),
      isFalse,
    );
    // A named company with a different id is refused too.
    expect(
      await CompanyFirestoreSyncService.instance.pushToCloud(
          const CompanyModel(companyId: 'other-id', companyName: 'Impostor')),
      isFalse,
    );
    final doc = await cloud.collection('companies').doc(uidA).get();
    expect(doc.data()!['companyName'], 'Sharma Packers');
    expect(doc.data()!['companyId'], 'real-company-id');

    // The real company's own update goes through.
    expect(
      await CompanyFirestoreSyncService.instance.pushToCloud(const CompanyModel(
          companyId: 'real-company-id', companyName: 'Sharma Packers Pvt Ltd')),
      isTrue,
    );
  });

  test('a cloud that cannot be reached is a failure, never a new company',
      () async {
    asAccount(uidA);
    CompanyFirestoreSyncService.firestoreOverride = _BrokenFirestore();
    final result = await TenantBootstrap.bootstrapAfterLogin(uidA);
    expect(result.outcome, TenantBootstrapOutcome.failed);
    expect(TenantScope.isReady, isFalse);
    expect(await CompanyController.instance.getCompany(), isNull);
  });

  test('restore skips rows of another company and deletes nothing', () async {
    asAccount(uidA);
    cloud.collection('companies').doc(uidA).set({
      'companyId': 'real-company-id',
      'companyName': 'Sharma Packers',
    });
    for (final (id, companyId) in [('mine', 'real-company-id'), ('theirs', 'someone-else')]) {
      await cloud.collection('companies').doc(uidA).collection('customers').doc(id).set({
        'id': id,
        'company_id': companyId,
        'customer_name': id,
        'mobile_number': '1',
        'is_active': 1,
        'created_at': '2026-09-01T00:00:00',
      });
    }

    final result = await TenantBootstrap.bootstrapAfterLogin(uidA);
    expect(result.restoredRows, 1);
    expect((await CustomerRepository.instance.getAll()).single.id, 'mine');

    final sync = await DocumentCloudSyncService.instance.syncNow();
    expect(sync.deleted, 0);
    expect(await cloudRows(uidA, 'customers'), 2);
  });
}

/// A Firestore whose every read fails - the cloud out of reach.
class _BrokenFirestore extends FakeFirebaseFirestore {
  @override
  CollectionReference<Map<String, dynamic>> collection(String path) {
    throw StateError('network unreachable');
  }
}
