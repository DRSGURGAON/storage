import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/customer/customer_lookup_service.dart';
import 'package:godown_book/features/billing/models/bill_model.dart';
import 'package:godown_book/features/billing/models/payment_model.dart';
import 'package:godown_book/features/billing/repositories/billing_repository.dart';
import 'package:godown_book/features/billing/services/storage_charge_calculator.dart';
import 'package:godown_book/features/customers/models/customer_model.dart';
import 'package:godown_book/features/customers/repositories/customer_repository.dart';
import 'package:godown_book/features/dashboard/services/dashboard_stats_service.dart';
import 'package:godown_book/features/quotation/models/quotation_model.dart';
import 'package:godown_book/features/quotation/repositories/quotation_repository.dart';
import 'package:godown_book/features/release/repositories/goods_release_repository.dart';
import 'package:godown_book/features/storage_booking/models/booking_item_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_booking_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_status.dart';
import 'package:godown_book/features/storage_booking/repositories/storage_booking_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

/// The V1 audit's P0 fixes around customers and money: an explicitly
/// picked customer stays picked, rent stops the day the goods go out,
/// a receipt can never exceed what a bill owes, and money received
/// from a customer settles their bills.
Future<StorageBookingModel> storedGoods({
  String customerId = '',
  String name = 'Rajesh Kumar',
  String phone = '9876500001',
  RentBasis basis = RentBasis.monthly,
  double rate = 3500,
  List<BookingItemModel>? items,
}) {
  return StorageBookingRepository.instance.save(StorageBookingModel(
    id: '',
    bookingDate: '2026-09-01T00:00:00',
    customerId: customerId,
    customerName: name,
    customerPhone: phone,
    customerCity: 'Karnal',
    customerState: 'Haryana',
    storageStartDate: '2026-09-01T00:00:00',
    rentBasis: basis,
    rentRate: rate,
    items: items ??
        const [
          BookingItemModel(id: '', bookingId: '', itemName: 'Sofa', quantity: 1),
          BookingItemModel(
              id: '', bookingId: '', itemName: 'Cartons', quantity: 40),
        ],
    createdAt: '',
  ));
}

Future<BillModel> billUpto(StorageBookingModel booking, DateTime upto) async {
  final draft =
      await BillingRepository.instance.draftForBooking(booking, upto: upto);
  return BillingRepository.instance.saveBill(draft);
}

PaymentModel receipt(
  BillModel bill,
  double amount, {
  PaymentType type = PaymentType.fullPayment,
  String date = '2026-10-02T00:00:00',
}) {
  return PaymentModel(
    id: '',
    billId: bill.id,
    customerId: bill.customerId,
    bookingId: bill.bookingId,
    payerName: bill.customerName,
    amount: amount,
    mode: PaymentMode.cash,
    paymentType: type,
    paymentDate: date,
    createdAt: '',
  );
}

Future<StorageBookingModel> releaseAll(
  StorageBookingModel booking, {
  required DateTime on,
  List<double>? quantities,
}) async {
  final fresh = (await StorageBookingRepository.instance.getById(booking.id))!;
  var draft = GoodsReleaseRepository.instance.draftForBooking(fresh);
  if (quantities != null) {
    draft = draft.copyWith(items: [
      for (var i = 0; i < draft.items.length; i++)
        draft.items[i].copyWith(quantity: quantities[i]),
    ]);
  }
  await GoodsReleaseRepository.instance
      .save(draft.copyWith(releaseDate: on.toIso8601String()));
  return (await StorageBookingRepository.instance.getById(booking.id))!;
}

void main() {
  late Database db;
  final billing = BillingRepository.instance;
  final customers = CustomerRepository.instance;

  setUp(() async {
    db = await openTestDatabase();
    CustomerLookupService.instance.invalidate();
  });

  tearDown(() async => db.close());

  group('customer reference integrity', () {
    test('two customers with the same name: the picked one is kept',
        () async {
      final first = await customers.create(const CustomerModel(
          id: '', customerName: 'Rajesh Kumar', mobileNumber: '9876500001', createdAt: ''));
      final second = await customers.create(const CustomerModel(
          id: '', customerName: 'Rajesh Kumar', mobileNumber: '9876500009', createdAt: ''));

      // The operator picked the second Rajesh, but typed the first
      // one's phone on the receipt - the pick wins.
      final booking =
          await storedGoods(customerId: second.id, phone: first.mobileNumber);
      expect(booking.customerId, second.id);

      final quotation = await QuotationRepository.instance.save(QuotationModel(
        id: '',
        quotationDate: '2026-09-01',
        customerId: second.id,
        customerName: 'Rajesh Kumar',
        customerPhone: first.mobileNumber,
        createdAt: '',
        lines: const [
          QuotationLineModel(id: '', serviceName: 'Packing', rate: 100, amount: 100),
        ],
      ));
      expect(quotation.customerId, second.id);

      final bill = await billUpto(booking, DateTime(2026, 9, 30));
      expect(bill.customerId, second.id);
    });

    test('editing the name and phone on a bill keeps it on its customer',
        () async {
      final owner = await customers.create(const CustomerModel(
          id: '', customerName: 'Rajesh Kumar', mobileNumber: '9876500001', createdAt: ''));
      final other = await customers.create(const CustomerModel(
          id: '', customerName: 'Suresh Verma', mobileNumber: '9876500002', createdAt: ''));

      final booking = await storedGoods(customerId: owner.id);
      final bill = await billUpto(booking, DateTime(2026, 9, 30));
      final paid = await billing.recordPayment(receipt(bill, 1000,
          type: PaymentType.partPayment));

      // Correcting a typo on the bill to the other customer's exact
      // name and phone must not move the bill to that customer.
      final edited = await billing.saveBill(bill.copyWith(
        customerName: other.customerName,
        customerPhone: other.mobileNumber,
      ));
      expect(edited.customerId, owner.id);
      expect(edited.customerName, 'Suresh Verma');

      final receiptAgain = (await billing.getPaymentById(paid.id))!;
      expect(receiptAgain.customerId, owner.id);
      expect(receiptAgain.billId, bill.id);
      expect((await billing.balanceForCustomer(owner.id)).outstanding, 2500);
      expect((await billing.balanceForCustomer(other.id)).billed, 0);
    });

    test('with no explicit customer the master is still matched or created',
        () async {
      final existing = await customers.create(const CustomerModel(
          id: '', customerName: 'Rajesh Kumar', mobileNumber: '9876500001', createdAt: ''));
      final matched = await storedGoods();
      expect(matched.customerId, existing.id);

      final created = await storedGoods(name: 'New Person', phone: '9000000000');
      expect(created.customerId, isNotEmpty);
      expect(created.customerId, isNot(existing.id));
      expect((await customers.getAll()).length, 2);
    });

    test('a link to a customer that no longer exists falls back to matching',
        () async {
      final existing = await customers.create(const CustomerModel(
          id: '', customerName: 'Rajesh Kumar', mobileNumber: '9876500001', createdAt: ''));
      final booking = await storedGoods(customerId: 'gone-id');
      expect(booking.customerId, existing.id);
    });
  });

  group('billing after release', () {
    test('full release: the bill stops on the release day and nothing after',
        () async {
      final booking = await storedGoods();
      await billUpto(booking, DateTime(2026, 9, 30));
      final closed = await releaseAll(booking, on: DateTime(2026, 10, 10));
      expect(closed.status, StorageStatus.released);
      expect(StorageChargeCalculator.hasUnbilledRent(closed), isTrue);

      // The operator bills "up to today" weeks later: the period is
      // pulled back to the day the goods went out.
      final finalDraft =
          await billing.draftForBooking(closed, upto: DateTime(2026, 11, 30));
      expect(finalDraft.periodFrom, '2026-10-01');
      expect(finalDraft.periodTo, '2026-10-10');
      expect(finalDraft.lines.single.quantity, 1);
      expect(finalDraft.lines.single.amount, 3500);

      await billing.saveBill(finalDraft);
      final billed = (await StorageBookingRepository.instance.getById(booking.id))!;
      expect(billed.rentBilledUpto, '2026-10-10');
      expect(StorageChargeCalculator.hasUnbilledRent(billed), isFalse);

      // No further rent: a later draft has nothing to charge.
      final later =
          await billing.draftForBooking(billed, upto: DateTime(2027, 1, 31));
      expect(later.lines, isEmpty);
    });

    test('release before the first billing period ends', () async {
      final booking = await storedGoods();
      final closed = await releaseAll(booking, on: DateTime(2026, 9, 20));

      final draft =
          await billing.draftForBooking(closed, upto: DateTime(2026, 9, 30));
      expect(draft.periodFrom, '2026-09-01');
      expect(draft.periodTo, '2026-09-20');
      expect(draft.lines.single.amount, 3500);
    });

    test('partial release: per-box rent continues only for what is left',
        () async {
      final booking = await storedGoods(
        basis: RentBasis.perBoxMonthly,
        rate: 100,
        items: const [
          BookingItemModel(id: '', bookingId: '', itemName: 'Cartons', quantity: 40),
        ],
      );
      await billUpto(booking, DateTime(2026, 9, 30));

      final partly = await releaseAll(booking, on: DateTime(2026, 10, 5), quantities: [15]);
      expect(partly.status, StorageStatus.partiallyReleased);
      expect(partly.remainingQuantity, 25);

      final draft =
          await billing.draftForBooking(partly, upto: DateTime(2026, 10, 31));
      expect(draft.periodTo, '2026-10-31');
      expect(draft.lines.single.quantity, 25);
      expect(draft.lines.single.amount, 2500);
      expect(StorageChargeCalculator.hasUnbilledRent(partly), isTrue);
    });

    test('partial release: flat monthly rent keeps running for the record',
        () async {
      final booking = await storedGoods();
      final partly = await releaseAll(booking, on: DateTime(2026, 9, 15), quantities: [0, 10]);
      expect(partly.status, StorageStatus.partiallyReleased);

      final draft =
          await billing.draftForBooking(partly, upto: DateTime(2026, 10, 31));
      expect(draft.periodTo, '2026-10-31');
      expect(draft.lines.single.amount, 7000);
    });
  });

  group('overpayment', () {
    test('a receipt for more than the bill owes is refused', () async {
      final booking = await storedGoods();
      final bill = await billUpto(booking, DateTime(2026, 9, 30));

      expect(
        () => billing.recordPayment(receipt(bill, 5000)),
        throwsA(isA<OverpaymentException>()
            .having((e) => e.outstanding, 'outstanding', 3500)
            .having((e) => e.excess, 'excess', 1500)),
      );

      final untouched = (await billing.getBillById(bill.id))!;
      expect(untouched.amountPaid, 0);
      expect(await billing.getPaymentsForCustomer(bill.customerId), isEmpty);
    });

    test('split: the bill closes at its total and the rest is an advance',
        () async {
      final booking = await storedGoods();
      final bill = await billUpto(booking, DateTime(2026, 9, 30));

      final result = await billing.recordPaymentSplittingExcess(receipt(bill, 5000));
      expect(result.applied.amount, 3500);
      expect(result.applied.billId, bill.id);
      expect(result.advance, isNotNull);
      expect(result.advance!.amount, 1500);
      expect(result.advance!.billId, isEmpty);
      expect(result.advance!.paymentType, PaymentType.advance);
      expect(result.advance!.customerId, bill.customerId);

      final settled = (await billing.getBillById(bill.id))!;
      expect(settled.amountPaid, 3500);
      expect(settled.balanceDue, 0);
      expect(settled.derivedStatus, BillStatus.paid);

      final balance = await billing.balanceForCustomer(bill.customerId);
      expect(balance.received, 5000);
      expect(balance.outstanding, 0);
      expect(balance.advance, 1500);

      final statement = await billing.statementForCustomer(bill.customerId);
      expect(statement.last.runningBalance, -1500);
      expect(statement.map((e) => e.credit).fold(0.0, (a, b) => a + b), 5000);

      final stats = await DashboardStatsService.load();
      expect(stats.totalOutstanding, 0);
      expect(stats.unpaidBills, isEmpty);
    });

    test('split with an amount within the balance makes no advance', () async {
      final booking = await storedGoods();
      final bill = await billUpto(booking, DateTime(2026, 9, 30));

      final result = await billing.recordPaymentSplittingExcess(
          receipt(bill, 2000, type: PaymentType.partPayment));
      expect(result.advance, isNull);
      expect(result.applied.amount, 2000);
      expect((await billing.getBillById(bill.id))!.derivedStatus, BillStatus.partlyPaid);
    });
  });

  group('payment from the customer screen', () {
    test('open bills come oldest first and a receipt against one settles it',
        () async {
      final booking = await storedGoods();
      final first = await billing.saveBill(
        (await billing.draftForBooking(booking, upto: DateTime(2026, 9, 30)))
            .copyWith(billDate: '2026-10-01T00:00:00'),
      );
      final reloaded = (await StorageBookingRepository.instance.getById(booking.id))!;
      final second = await billing.saveBill(
        (await billing.draftForBooking(reloaded, upto: DateTime(2026, 10, 31)))
            .copyWith(billDate: '2026-11-01T00:00:00'),
      );

      final open = await billing.openBillsForCustomer(booking.customerId);
      expect(open.map((b) => b.id), [first.id, second.id]);

      // What the Receive Payment screen does when opened for the
      // customer: settle the oldest bill.
      await billing.recordPayment(receipt(open.first, 3500));

      expect((await billing.getBillById(first.id))!.derivedStatus, BillStatus.paid);
      expect((await billing.getBillById(second.id))!.balanceDue, 3500);
      expect((await billing.openBillsForCustomer(booking.customerId)).map((b) => b.id),
          [second.id]);

      // Bill status, customer balance, dashboard and statement agree.
      final balance = await billing.balanceForCustomer(booking.customerId);
      expect(balance.outstanding, 3500);
      final stats = await DashboardStatsService.load();
      expect(stats.totalOutstanding, 3500);
      expect(stats.unpaidBills.map((b) => b.id), [second.id]);
      final statement = await billing.statementForCustomer(booking.customerId);
      expect(statement.last.runningBalance, 3500);
    });

    test('a part payment against the oldest bill leaves the right balances',
        () async {
      final booking = await storedGoods();
      final bill = await billUpto(booking, DateTime(2026, 9, 30));
      final open = await billing.openBillsForCustomer(booking.customerId);

      await billing.recordPayment(
          receipt(open.single, 1000, type: PaymentType.partPayment));

      final after = (await billing.getBillById(bill.id))!;
      expect(after.derivedStatus, BillStatus.partlyPaid);
      expect(after.balanceDue, 2500);
      expect((await billing.balanceForCustomer(bill.customerId)).outstanding, 2500);
      expect((await DashboardStatsService.load()).totalOutstanding, 2500);
    });

    test('an advance with no bill stays on account', () async {
      final customer = await customers.create(const CustomerModel(
          id: '', customerName: 'Rajesh Kumar', mobileNumber: '9876500001', createdAt: ''));
      expect(await billing.openBillsForCustomer(customer.id), isEmpty);

      final advance = await billing.recordPayment(PaymentModel(
        id: '',
        billId: '',
        customerId: customer.id,
        bookingId: '',
        payerName: 'Rajesh Kumar',
        amount: 2000,
        mode: PaymentMode.upi,
        paymentType: PaymentType.advance,
        paymentDate: '2026-09-01T00:00:00',
        createdAt: '',
      ));
      expect(advance.isOnAccount, isTrue);
      final balance = await billing.balanceForCustomer(customer.id);
      expect(balance.advance, 2000);
      expect(balance.outstanding, 0);
    });
  });
}
