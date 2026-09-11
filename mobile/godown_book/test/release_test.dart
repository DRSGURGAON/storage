import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/customer/customer_lookup_service.dart';
import 'package:godown_book/core/utils/financial_year.dart';
import 'package:godown_book/features/company/models/company_model.dart';
import 'package:godown_book/features/release/repositories/goods_release_repository.dart';
import 'package:godown_book/features/release/services/release_pdf_service.dart';
import 'package:godown_book/features/storage_booking/models/booking_item_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_booking_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_status.dart';
import 'package:godown_book/features/storage_booking/repositories/storage_booking_repository.dart';
import 'package:godown_book/features/storage_booking/repositories/storage_photo_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

Future<StorageBookingModel> storedGoods() {
  return StorageBookingRepository.instance.save(StorageBookingModel(
    id: '',
    bookingDate: DateTime(2026, 9, 1).toIso8601String(),
    customerName: 'Rajesh Kumar',
    customerPhone: '9876500001',
    storageStartDate: DateTime(2026, 9, 1).toIso8601String(),
    rentRate: 3500,
    items: const [
      BookingItemModel(id: '', bookingId: '', itemName: 'Sofa', quantity: 1),
      BookingItemModel(id: '', bookingId: '', itemName: 'Cartons', quantity: 40, unit: 'Nos'),
    ],
    createdAt: '',
  ));
}

void main() {
  late Database db;
  final repo = GoodsReleaseRepository.instance;

  setUp(() async {
    db = await openTestDatabase();
    CustomerLookupService.instance.invalidate();
  });

  tearDown(() async {
    await db.close();
  });

  test('a draft release lists everything still in storage', () async {
    final booking = await storedGoods();
    final draft = repo.draftForBooking(booking);

    expect(draft.items.length, 2);
    expect(draft.items.map((i) => i.quantity), [1, 40]);
    expect(draft.collectedByName, 'Rajesh Kumar');
  });

  test('releasing takes the goods off the storage record', () async {
    final booking = await storedGoods();
    final draft = repo.draftForBooking(booking);
    final fy = FinancialYear.startYear(DateTime.now());

    final partial = await repo.save(draft.copyWith(
      items: [draft.items[1].copyWith(quantity: 15)],
      collectedByName: 'Rajesh Kumar',
      vehicleNumber: 'hr 05 ab 1234',
    ));

    expect(partial.releaseNo, 'RL/$fy/0001');
    expect(partial.totalQuantity, 15);

    var reloaded = (await StorageBookingRepository.instance.getById(booking.id))!;
    expect(reloaded.status, StorageStatus.partiallyReleased);
    expect(reloaded.remainingQuantity, 26);

    // Everything else goes: the record closes.
    final rest = repo.draftForBooking(reloaded);
    await repo.save(rest);

    reloaded = (await StorageBookingRepository.instance.getById(booking.id))!;
    expect(reloaded.status, StorageStatus.released);
    expect(reloaded.remainingQuantity, 0);
    expect(await StorageBookingRepository.instance.getOpen(), isEmpty);
  });

  test('a release beyond what is left is refused and nothing is recorded', () async {
    final booking = await storedGoods();
    final draft = repo.draftForBooking(booking);

    await expectLater(
      repo.save(draft.copyWith(items: [draft.items[0].copyWith(quantity: 5)])),
      throwsA(isA<StateError>()),
    );

    expect(await repo.getAll(), isEmpty);
    final reloaded = (await StorageBookingRepository.instance.getById(booking.id))!;
    expect(reloaded.remainingQuantity, 41);
    expect(reloaded.status, StorageStatus.inStorage);
  });

  test('deleting a release puts the goods back', () async {
    final booking = await storedGoods();
    final draft = repo.draftForBooking(booking);
    final release = await repo.save(draft.copyWith(
      items: [draft.items[1].copyWith(quantity: 40)],
    ));

    var reloaded = (await StorageBookingRepository.instance.getById(booking.id))!;
    expect(reloaded.remainingQuantity, 1);

    await repo.delete(release.id);

    reloaded = (await StorageBookingRepository.instance.getById(booking.id))!;
    expect(reloaded.remainingQuantity, 41);
    expect(reloaded.status, StorageStatus.inStorage);
    expect(await repo.getAll(), isEmpty);
    expect(await db.query('release_items'), isEmpty);
  });

  test('photos attach to a storage record and come back in order', () async {
    final booking = await storedGoods();
    final photos = StoragePhotoRepository.instance;

    final first = await photos.attachFile(
      bookingId: booking.id,
      filePath: '/tmp/godown-test-1.jpg',
      caption: 'Sofa before wrapping',
    );
    await photos.attachFile(bookingId: booking.id, filePath: '/tmp/godown-test-2.jpg');

    final all = await photos.getForBooking(booking.id);
    expect(all.length, 2);
    expect(all.first.caption, 'Sofa before wrapping');
    expect(all.last.sortOrder, greaterThan(all.first.sortOrder));
    expect(await photos.countForBooking(booking.id), 2);

    await photos.updateCaption(first, 'Sofa - tear on left arm');
    expect((await photos.getForBooking(booking.id)).first.caption,
        'Sofa - tear on left arm');

    await photos.delete(first);
    expect(await photos.countForBooking(booking.id), 1);
  });

  test('renders the release record PDF', () async {
    final booking = await storedGoods();
    final draft = repo.draftForBooking(booking);
    final release = await repo.save(draft.copyWith(
      collectedByName: 'Rajesh Kumar',
      collectedByIdProof: 'Aadhaar 1234',
      vehicleNumber: 'HR05AB1234',
    ));

    const company = CompanyModel(
      companyId: 'company-test',
      companyName: 'Test Movers',
      address: 'GT Road',
      city: 'Karnal',
      state: 'Haryana',
      mobile1: '9999999999',
    );

    final both = await ReleasePdfService.instance.build(release, company);
    final gateOnly = await ReleasePdfService.instance
        .build(release, company, copies: const ['GATE COPY']);

    for (final bytes in [both, gateOnly]) {
      expect(String.fromCharCodes(bytes.take(5)), '%PDF-');
    }
    expect(_pageCount(both), 2);
    expect(_pageCount(gateOnly), 1);
  });
}

int _pageCount(List<int> bytes) {
  final text = String.fromCharCodes(bytes);
  return RegExp(r'/Type\s*/Page[^s]').allMatches(text).length;
}
