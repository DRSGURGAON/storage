import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/customer/customer_lookup_service.dart';
import 'package:godown_book/features/billing/models/bill_model.dart';
import 'package:godown_book/features/billing/models/payment_model.dart';
import 'package:godown_book/features/billing/repositories/billing_repository.dart';
import 'package:godown_book/features/notices/models/notice_model.dart';
import 'package:godown_book/features/notices/repositories/notice_repository.dart';
import 'package:godown_book/features/release/repositories/goods_release_repository.dart';
import 'package:godown_book/features/storage_booking/models/booking_item_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_booking_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_status.dart';
import 'package:godown_book/features/storage_booking/repositories/storage_booking_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

/// A wrong entry can be corrected on every issued paper: a receipt, a
/// credit note, a release record and a notice each keep their number
/// and everything that depends on them is restated.
Future<StorageBookingModel> storedGoods() {
  return StorageBookingRepository.instance.save(StorageBookingModel(
    id: '',
    bookingDate: '2026-09-01T00:00:00',
    customerName: 'Rajesh Kumar',
    customerPhone: '9876500001',
    storageStartDate: '2026-09-01T00:00:00',
    rentRate: 3500,
    items: const [
      BookingItemModel(id: '', bookingId: '', itemName: 'Sofa', quantity: 1),
      BookingItemModel(id: '', bookingId: '', itemName: 'Cartons', quantity: 40),
    ],
    createdAt: '',
  ));
}

Future<BillModel> billed(StorageBookingModel booking) async {
  final draft = await BillingRepository.instance
      .draftForBooking(booking, upto: DateTime(2026, 9, 30));
  return BillingRepository.instance.saveBill(draft);
}

PaymentModel receipt(BillModel bill, double amount, {PaymentType type = PaymentType.partPayment}) {
  return PaymentModel(
    id: '',
    billId: bill.id,
    customerId: bill.customerId,
    bookingId: bill.bookingId,
    payerName: bill.customerName,
    amount: amount,
    mode: PaymentMode.cash,
    paymentType: type,
    paymentDate: '2026-10-02T00:00:00',
    createdAt: '',
  );
}

void main() {
  late Database db;
  final billing = BillingRepository.instance;

  setUp(() async {
    db = await openTestDatabase();
    CustomerLookupService.instance.invalidate();
  });

  tearDown(() async => db.close());

  group('receipt', () {
    test('a corrected amount keeps the number and restates the bill', () async {
      final bill = await billed(await storedGoods());
      final saved = await billing.recordPayment(receipt(bill, 1000));
      expect((await billing.getBillById(bill.id))!.balanceDue, 2500);

      await billing.updatePayment(saved.copyWith(
        amount: 1500,
        mode: PaymentMode.upi,
        referenceNo: 'UTR123',
        paymentDate: '2026-10-03T00:00:00',
      ));

      final after = (await billing.getPaymentById(saved.id))!;
      expect(after.receiptNo, saved.receiptNo);
      expect(after.amount, 1500);
      expect(after.mode, PaymentMode.upi);
      expect(after.referenceNo, 'UTR123');

      final restated = (await billing.getBillById(bill.id))!;
      expect(restated.amountPaid, 1500);
      expect(restated.balanceDue, 2000);
      expect(restated.derivedStatus, BillStatus.partlyPaid);
      expect((await billing.balanceForCustomer(bill.customerId)).outstanding, 2000);
    });

    test('the correction may use the receipt\'s own earlier amount, not more',
        () async {
      final bill = await billed(await storedGoods());
      final saved = await billing.recordPayment(receipt(bill, 3000));
      // 500 is still due; this receipt's own 3000 is available again,
      // so 3500 is fine and 3501 is not.
      await billing.updatePayment(saved.copyWith(amount: 3500));
      expect((await billing.getBillById(bill.id))!.derivedStatus, BillStatus.paid);

      expect(
        () => billing.updatePayment(saved.copyWith(amount: 3501)),
        throwsA(isA<OverpaymentException>()
            .having((e) => e.outstanding, 'outstanding', closeTo(3500, 0.001))),
      );
      expect((await billing.getPaymentById(saved.id))!.amount, 3500);
    });

    test('a corrected credit note is capped the same way', () async {
      final bill = await billed(await storedGoods());
      final note = await billing.recordPayment(PaymentModel(
        id: '',
        billId: bill.id,
        customerId: bill.customerId,
        payerName: bill.customerName,
        amount: 500,
        mode: PaymentMode.other,
        paymentType: PaymentType.creditNote,
        paymentDate: '2026-10-02T00:00:00',
        notes: 'Goodwill',
        createdAt: '',
      ));
      await billing.updatePayment(note.copyWith(amount: 800, notes: 'Damage'));
      final after = (await billing.getPaymentById(note.id))!;
      expect(after.amount, 800);
      expect(after.notes, 'Damage');
      expect(after.receiptNo, note.receiptNo);
      expect((await billing.getBillById(bill.id))!.balanceDue, 2700);
      expect(
        () => billing.updatePayment(note.copyWith(amount: 3600)),
        throwsA(isA<OverpaymentException>()),
      );
    });
  });

  group('release', () {
    test('a corrected quantity moves the goods and keeps the number', () async {
      final booking = await storedGoods();
      final repo = GoodsReleaseRepository.instance;
      final draft = repo.draftForBooking(booking);
      final saved = await repo.save(draft.copyWith(
        items: [draft.items[1].copyWith(quantity: 15)],
        collectedByName: 'Rajesh Kumar',
      ));
      expect((await StorageBookingRepository.instance.getById(booking.id))!.remainingQuantity, 26);

      // It was 10 cartons and the sofa, not 15 cartons.
      final reloaded = (await repo.getById(saved.id))!;
      final updated = await repo.update(reloaded.copyWith(
        collectedByName: 'Suresh (son)',
        vehicleNumber: 'HR05AB1234',
        items: [
          draft.items[0].copyWith(quantity: 1),
          draft.items[1].copyWith(quantity: 10),
        ],
      ));

      expect(updated.releaseNo, saved.releaseNo);
      final again = (await repo.getById(saved.id))!;
      expect(again.collectedByName, 'Suresh (son)');
      expect(again.vehicleNumber, 'HR05AB1234');
      expect(again.items.map((i) => i.quantity), [1, 10]);
      expect(again.totalQuantity, 11);

      final after = (await StorageBookingRepository.instance.getById(booking.id))!;
      expect(after.remainingQuantity, 30);
      expect(after.status, StorageStatus.partiallyReleased);
      expect((await repo.getAll()).length, 1);
    });

    test('a correction beyond what exists is refused and nothing changes',
        () async {
      final booking = await storedGoods();
      final repo = GoodsReleaseRepository.instance;
      final draft = repo.draftForBooking(booking);
      final saved = await repo.save(draft.copyWith(
        items: [draft.items[1].copyWith(quantity: 15)],
      ));

      await expectLater(
        repo.update(saved.copyWith(items: [draft.items[1].copyWith(quantity: 41)])),
        throwsA(isA<StateError>()),
      );

      final after = (await StorageBookingRepository.instance.getById(booking.id))!;
      expect(after.remainingQuantity, 26);
      expect((await repo.getById(saved.id))!.items.single.quantity, 15);
    });

    test('correcting a full release to a partial one reopens the record',
        () async {
      final booking = await storedGoods();
      final repo = GoodsReleaseRepository.instance;
      final saved = await repo.save(
        repo.draftForBooking(booking).copyWith(releaseDate: '2026-10-10T00:00:00'),
      );
      expect((await StorageBookingRepository.instance.getById(booking.id))!.status,
          StorageStatus.released);

      final reloaded = (await repo.getById(saved.id))!;
      await repo.update(reloaded.copyWith(
        items: [reloaded.items[1].copyWith(quantity: 20)],
      ));

      final after = (await StorageBookingRepository.instance.getById(booking.id))!;
      expect(after.status, StorageStatus.partiallyReleased);
      expect(after.remainingQuantity, 21);
      expect(after.actualEndDate, isEmpty);
    });
  });

  group('notice', () {
    test('a corrected notice keeps its number and how it was sent', () async {
      final booking = await storedGoods();
      final repo = NoticeRepository.instance;
      final first = await repo.save(NoticeModel(
        id: '',
        noticeDate: '2026-11-01T00:00:00',
        kind: NoticeKind.reminder,
        customerId: booking.customerId,
        bookingId: booking.id,
        customerName: booking.customerName,
        customerPhone: booking.customerPhone,
        bookingNo: booking.bookingNo,
        amountDue: 3500,
        payByDate: '2026-11-08T00:00:00',
        createdAt: '',
      ));
      await repo.markSent(first.id, 'WhatsApp');

      final updated = await repo.update(first.copyWith(
        kind: NoticeKind.finalNotice,
        amountDue: 7000,
        payByDate: '2026-11-15T00:00:00',
        bodyNote: 'Second month added.',
      ));

      expect(updated.noticeNo, first.noticeNo);
      final reloaded = (await repo.getById(first.id))!;
      expect(reloaded.kind, NoticeKind.finalNotice);
      expect(reloaded.amountDue, 7000);
      expect(reloaded.payByDate, '2026-11-15T00:00:00');
      expect(reloaded.bodyNote, 'Second month added.');
      expect(reloaded.sentVia, 'WhatsApp');
      expect((await repo.getAll()).length, 1);
    });
  });
}
