import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/customer/customer_lookup_service.dart';
import 'package:godown_book/core/tenant/tenant_scope.dart';
import 'package:godown_book/core/utils/financial_year.dart';
import 'package:godown_book/features/company/models/company_model.dart';
import 'package:godown_book/features/customers/repositories/customer_repository.dart';
import 'package:godown_book/features/storage_booking/models/booking_item_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_booking_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_status.dart';
import 'package:godown_book/features/storage_booking/repositories/storage_booking_repository.dart';
import 'package:godown_book/features/storage_booking/services/goods_list_pdf_service.dart';
import 'package:godown_book/features/storage_booking/services/storage_agreement_pdf_service.dart';
import 'package:godown_book/features/storage_booking/services/storage_receipt_pdf_service.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

StorageBookingModel draft({
  String name = 'Sharma Cold Store',
  String phone = '9876543210',
  List<BookingItemModel> items = const [],
}) {
  final now = DateTime.now().toIso8601String();
  return StorageBookingModel(
    id: '',
    bookingDate: now,
    customerName: name,
    customerPhone: phone,
    customerCity: 'Karnal',
    storageStartDate: now,
    rentRate: 5000,
    securityDeposit: 10000,
    locationName: 'Hall A',
    items: items,
    createdAt: '',
  );
}

BookingItemModel item(String name, double qty, {String unit = 'Bags'}) =>
    BookingItemModel(id: '', bookingId: '', itemName: name, quantity: qty, unit: unit);

void main() {
  late Database db;
  final repo = StorageBookingRepository.instance;

  setUp(() async {
    db = await openTestDatabase();
    CustomerLookupService.instance.invalidate();
  });

  tearDown(() async {
    await db.close();
  });

  test('numbers receipts sequentially within the financial year', () async {
    final fy = FinancialYear.startYear(DateTime.now());
    final a = await repo.save(draft(items: [item('Wheat', 100)]));
    final b = await repo.save(draft(name: 'Gupta Agro', phone: '9000000001'));

    expect(a.bookingNo, 'WR/$fy/0001');
    expect(b.bookingNo, 'WR/$fy/0002');
    expect(a.status, StorageStatus.inStorage);
    expect(a.items.single.bookingId, a.id);
    expect(a.items.single.id, isNotEmpty);
  });

  test('saving creates the customer in the master and links it', () async {
    final saved = await repo.save(draft());
    final customers = await CustomerRepository.instance.getAll();

    expect(customers.single.customerName, 'Sharma Cold Store');
    expect(customers.single.city, 'Karnal');
    expect(saved.customerId, customers.single.id);

    // A second receipt for the same phone reuses the customer.
    final again = await repo.save(draft(name: 'Sharma Cold Store Pvt Ltd'));
    expect(again.customerId, saved.customerId);
    expect((await CustomerRepository.instance.getAll()).length, 1);

    // ...and both the master row and the receipts feed suggestions,
    // the master row first because it carries the customer id.
    final suggestions = await CustomerLookupService.instance.search('sharma');
    expect(suggestions.length, 2);
    final fromMaster =
        suggestions.firstWhere((s) => s.name == 'Sharma Cold Store');
    expect(fromMaster.source, 'Customer');
    expect(fromMaster.customerId, saved.customerId);
    expect(
      suggestions.any((s) => s.source == 'Storage Receipt'),
      isTrue,
    );
  });

  test('editing keeps the number, replaces items and keeps released qty', () async {
    final saved = await repo.save(draft(items: [item('Wheat', 100), item('Rice', 50)]));
    final wheat = saved.items.firstWhere((i) => i.itemName == 'Wheat');

    await repo.applyRelease(saved.id, {wheat.id: 30});

    final edited = await repo.save(saved.copyWith(
      customerName: 'Sharma Cold Store (Renamed)',
      rentRate: 6000,
      items: [
        wheat.copyWith(quantity: 120),
        item('Maize', 10),
      ],
    ));

    expect(edited.bookingNo, saved.bookingNo);
    expect(edited.rentRate, 6000);
    expect(edited.items.map((i) => i.itemName), ['Wheat', 'Maize']);
    expect(edited.items.first.releasedQty, 30);
    expect(edited.items.first.remainingQty, 90);
    expect(edited.status, StorageStatus.partiallyReleased);

    final reloaded = await repo.getById(saved.id);
    expect(reloaded!.customerName, 'Sharma Cold Store (Renamed)');
    expect(reloaded.items.length, 2);
  });

  test('releases move the status and refuse over-release', () async {
    final saved = await repo.save(draft(items: [item('Wheat', 100), item('Rice', 50)]));
    final wheat = saved.items[0];
    final rice = saved.items[1];

    var b = await repo.applyRelease(saved.id, {wheat.id: 40});
    expect(b.status, StorageStatus.partiallyReleased);
    expect(b.remainingQuantity, 110);

    await expectLater(
      repo.applyRelease(saved.id, {wheat.id: 61}),
      throwsA(isA<StateError>()),
    );

    b = await repo.applyRelease(saved.id, {wheat.id: 60, rice.id: 50}, actualEndDate: '2026-09-11');
    expect(b.status, StorageStatus.released);
    expect(b.actualEndDate, '2026-09-11');
    expect(b.remainingQuantity, 0);

    // Undoing a release (deleting the delivery order) reopens it.
    b = await repo.applyRelease(saved.id, {rice.id: -50});
    expect(b.status, StorageStatus.partiallyReleased);
    expect((await repo.getOpen()).single.id, saved.id);
  });

  test('rent watermark and cancel', () async {
    final saved = await repo.save(draft());
    await repo.setRentBilledUpto(saved.id, '2026-09-30');
    expect((await repo.getById(saved.id))!.rentBilledUpto, '2026-09-30');

    await repo.cancel(saved.id);
    expect((await repo.getById(saved.id))!.status, StorageStatus.cancelled);
    expect(await repo.getOpen(), isEmpty);
  });

  test('receipts never cross companies', () async {
    await repo.save(draft());
    TenantScope.set('another-company');
    expect(await repo.getAll(), isEmpty);
    final fy = FinancialYear.startYear(DateTime.now());
    final other = await repo.save(draft(name: 'Other'));
    expect(other.bookingNo, 'WR/$fy/0001');
  });

  test('all three papers render as PDFs', () async {
    final saved = await repo.save(draft(items: [item('Wheat', 100), item('Rice', 50)]));
    await repo.applyRelease(saved.id, {saved.items.first.id: 25});
    final booking = (await repo.getById(saved.id))!;

    const company = CompanyModel(
      companyId: 'company-test',
      companyName: 'Test Godown',
      address: 'GT Road',
      city: 'Karnal',
      state: 'Haryana',
      mobile1: '9999999999',
      gstNumber: '06AAAAA0000A1Z5',
      upiId1: 'testgodown@upi',
      isoCertificate: 'ISO 9001:2015',
    );

    final receipt = await StorageReceiptPdfService.instance.build(
      booking,
      company,
      showWatermark: true,
    );
    final singleCopy = await StorageReceiptPdfService.instance.build(
      booking,
      company,
      copies: const ['OFFICE COPY'],
    );
    final inventory = await GoodsListPdfService.instance.build(booking, company);
    final agreement = await StorageAgreementPdfService.instance.build(booking, company);

    for (final bytes in [receipt, singleCopy, inventory, agreement]) {
      expect(bytes.length, greaterThan(1000));
      expect(String.fromCharCodes(bytes.take(5)), '%PDF-');
    }
    // Two copies produce more pages than one.
    expect(_pageCount(receipt), 2);
    expect(_pageCount(singleCopy), 1);
  });
}

int _pageCount(List<int> bytes) {
  final text = String.fromCharCodes(bytes);
  return RegExp(r'/Type\s*/Page[^s]').allMatches(text).length;
}
