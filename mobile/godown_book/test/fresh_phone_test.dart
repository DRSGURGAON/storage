import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/database/app_database.dart';
import 'package:godown_book/core/database/database_constants.dart';
import 'package:godown_book/core/tenant/tenant_scope.dart';
import 'package:godown_book/features/billing/models/bill_model.dart';
import 'package:godown_book/features/billing/models/payment_model.dart';
import 'package:godown_book/features/billing/repositories/billing_repository.dart';
import 'package:godown_book/features/company/controllers/company_controller.dart';
import 'package:godown_book/features/company/models/company_model.dart';
import 'package:godown_book/features/customers/models/customer_model.dart';
import 'package:godown_book/features/customers/repositories/customer_repository.dart';
import 'package:godown_book/features/quotation/models/quotation_model.dart';
import 'package:godown_book/features/quotation/repositories/quotation_repository.dart';
import 'package:godown_book/features/storage_booking/models/booking_item_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_booking_model.dart';
import 'package:godown_book/features/storage_booking/repositories/storage_booking_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// What a brand-new phone goes through: an empty database, no company
/// yet, the shell company main() creates before the first frame, and
/// then the operator's first four saves. Every other test hands the
/// repositories a ready-made tenant; this one earns it the way the app
/// does.
void main() {
  late Directory scratch;

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() async {
    TenantScope.clear();
    // A real file per test: the in-memory database is shared within
    // the process, so one test would see another's rows.
    scratch = Directory.systemTemp.createTempSync('godown-fresh');
    final db = await databaseFactory.openDatabase(
      '${scratch.path}/app.db',
      options: OpenDatabaseOptions(
        version: DatabaseConstants.databaseVersion,
        onCreate: AppDatabase.instance.onCreate,
        onUpgrade: AppDatabase.instance.onUpgrade,
      ),
    );
    AppDatabase.overrideForTesting(db);
  });

  tearDown(() {
    if (scratch.existsSync()) scratch.deleteSync(recursive: true);
  });

  test('the first saves on a fresh phone all land', () async {
    // main._loadTenant(): no company, nothing in the cloud, so a shell.
    await CompanyController.instance.saveCompany(
      const CompanyModel(companyName: ''),
    );
    expect(TenantScope.isReady, isTrue);

    final customer = await CustomerRepository.instance.create(
      const CustomerModel(
        id: '',
        customerName: 'Rajesh Kumar',
        mobileNumber: '9876500001',
        createdAt: '',
      ),
    );
    expect(customer.id, isNotEmpty);
    expect(await CustomerRepository.instance.getAll(), hasLength(1));

    final booking = await StorageBookingRepository.instance.save(
      StorageBookingModel(
        id: 'booking-1',
        bookingDate: DateTime(2026, 9, 12).toIso8601String(),
        customerName: 'Rajesh Kumar',
        customerPhone: '9876500001',
        storageStartDate: DateTime(2026, 9, 12).toIso8601String(),
        rentRate: 3000,
        createdAt: '',
        items: const [
          BookingItemModel(id: '', bookingId: 'booking-1', itemName: 'Almirah'),
        ],
      ),
    );
    expect(booking.bookingNo, isNotEmpty);
    expect(await StorageBookingRepository.instance.getAll(), hasLength(1));

    final bill = await BillingRepository.instance.saveBill(
      BillModel(
        id: 'bill-1',
        billDate: DateTime(2026, 10, 1).toIso8601String(),
        customerName: 'Rajesh Kumar',
        createdAt: '',
        lines: const [
          BillLineModel(
            id: 'line-1',
            chargeName: 'Storage Charge',
            quantity: 1,
            rate: 3000,
            amount: 3000,
          ),
        ],
      ),
    );
    expect(bill.billNo, isNotEmpty);

    final payment = await BillingRepository.instance.recordPayment(
      PaymentModel(
        id: 'pay-1',
        billId: bill.id,
        customerId: customer.id,
        payerName: 'Rajesh Kumar',
        amount: 3000,
        mode: PaymentMode.cash,
        paymentType: PaymentType.fullPayment,
        paymentDate: DateTime(2026, 10, 2).toIso8601String(),
        createdAt: '',
      ),
    );
    expect(payment.receiptNo, isNotEmpty);

    final quotation = await QuotationRepository.instance.save(
      QuotationModel(
        id: 'q-1',
        quotationDate: DateTime(2026, 9, 12).toIso8601String(),
        customerName: 'Anil Sharma',
        createdAt: '',
      ),
    );
    expect(quotation.quotationNo, isNotEmpty);
  });

  test('a second launch keeps the same company, so the data is still there',
      () async {
    await CompanyController.instance.saveCompany(
      const CompanyModel(companyName: ''),
    );
    final first = TenantScope.companyId;
    await CustomerRepository.instance.create(const CustomerModel(
      id: '',
      customerName: 'Sunita Devi',
      mobileNumber: '9812345678',
      createdAt: '',
    ));

    // Next launch: _loadTenant() finds the company and reuses it.
    TenantScope.clear();
    final again = await CompanyController.instance.getCompany();
    expect(again?.companyId, first);
    TenantScope.set(again!.companyId);
    expect(await CustomerRepository.instance.getAll(), hasLength(1));
  });
}
