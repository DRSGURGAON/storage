import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/customer/customer_lookup_service.dart';
import 'package:godown_book/features/billing/models/bill_model.dart';
import 'package:godown_book/features/billing/models/payment_model.dart';
import 'package:godown_book/features/billing/repositories/billing_repository.dart';
import 'package:godown_book/features/customers/models/customer_model.dart';
import 'package:godown_book/features/customers/repositories/customer_repository.dart';
import 'package:godown_book/features/dashboard/services/dashboard_stats_service.dart';
import 'package:godown_book/features/master/repositories/storage_location_repository.dart';
import 'package:godown_book/features/quotation/models/quotation_model.dart';
import 'package:godown_book/features/quotation/repositories/quotation_repository.dart';
import 'package:godown_book/features/release/repositories/goods_release_repository.dart';
import 'package:godown_book/features/storage_booking/models/booking_item_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_booking_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_status.dart';
import 'package:godown_book/features/storage_booking/repositories/storage_booking_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

/// The whole job, end to end: the twelve steps an operator walks
/// through for one customer, from adding them to handing the goods
/// back. If this stops working, the product does.
void main() {
  late Database db;

  setUp(() async {
    db = await openTestDatabase();
    CustomerLookupService.instance.invalidate();
  });

  tearDown(() async {
    await db.close();
  });

  test('a customer is added, stores goods, is billed, pays and collects',
      () async {
    // 1. Add the customer.
    final customer = await CustomerRepository.instance.create(const CustomerModel(
      id: '',
      customerName: 'Rajesh Kumar',
      mobileNumber: '9876500001',
      address: 'B-42, Sector 9',
      city: 'Karnal',
      state: 'Haryana',
      pincode: '132001',
      createdAt: '',
    ));

    // 2. Quote the job. The customer's details are already known.
    final suggestion =
        (await CustomerLookupService.instance.search('rajesh')).first;
    expect(suggestion.customerId, customer.id);
    expect(suggestion.city, 'Karnal');

    final quotation = await QuotationRepository.instance.save(QuotationModel(
      id: '',
      quotationDate: DateTime(2026, 8, 25).toIso8601String(),
      customerId: suggestion.customerId,
      customerName: suggestion.name,
      customerPhone: suggestion.phone,
      customerCity: suggestion.city,
      customerState: suggestion.state,
      fromCity: 'Karnal',
      toCity: 'Pune',
      storageMonths: 2,
      createdAt: '',
      lines: [
        const QuotationLineModel(
            id: '', serviceName: 'Packing', rate: 6000, amount: 6000),
        const QuotationLineModel(
            id: '', serviceName: 'Storage Rent', quantity: 2, rate: 3500, amount: 7000),
      ],
    ));
    expect(quotation.grandTotal, 13000);

    await QuotationRepository.instance
        .setStatus(quotation.id, QuotationStatus.accepted);

    // 3. Give the goods a place to live.
    final location =
        await StorageLocationRepository.instance.create(name: 'Hall A');

    // 4-6. Record the goods coming in, with an item list and a location.
    final booking = await StorageBookingRepository.instance.save(StorageBookingModel(
      id: '',
      bookingDate: DateTime(2026, 9, 1).toIso8601String(),
      customerId: customer.id,
      customerName: customer.customerName,
      customerPhone: customer.mobileNumber,
      customerCity: customer.city,
      customerState: customer.state,
      locationId: location.id,
      locationName: location.name,
      storageStartDate: DateTime(2026, 9, 1).toIso8601String(),
      rentBasis: RentBasis.monthly,
      rentRate: 3500,
      securityDeposit: 5000,
      createdAt: '',
      items: const [
        BookingItemModel(id: '', bookingId: '', itemName: 'Sofa set', quantity: 1, unit: 'Set'),
        BookingItemModel(id: '', bookingId: '', itemName: 'Cartons', quantity: 39),
      ],
    ));

    // 7. The storage receipt is numbered and the goods are in.
    expect(booking.bookingNo, isNotEmpty);
    expect(booking.status, StorageStatus.inStorage);
    expect(booking.remainingQuantity, 40);

    // 8. Bill the first month.
    final bill = await BillingRepository.instance.saveBill(
      await BillingRepository.instance
          .draftForBooking(booking, upto: DateTime(2026, 9, 30)),
    );
    expect(bill.grandTotal, 3500);
    expect(bill.customerId, customer.id);

    // 9-10. Take the money and issue the receipt.
    final receipt = await BillingRepository.instance.recordPayment(PaymentModel(
      id: '',
      billId: bill.id,
      customerId: customer.id,
      bookingId: booking.id,
      payerName: customer.customerName,
      amount: 3500,
      mode: PaymentMode.upi,
      paymentDate: DateTime(2026, 10, 2).toIso8601String(),
      createdAt: '',
    ));
    expect(receipt.receiptNo, isNotEmpty);

    final settled = (await BillingRepository.instance.getBillById(bill.id))!;
    expect(settled.derivedStatus, BillStatus.paid);

    // 11. The customer asks what they owe.
    final balance = await BillingRepository.instance.balanceForCustomer(customer.id);
    expect(balance.billed, 3500);
    expect(balance.received, 3500);
    expect(balance.outstanding, 0);

    final statement =
        await BillingRepository.instance.statementForCustomer(customer.id);
    expect(statement.map((e) => e.runningBalance), [3500, 0]);

    // 12. The goods go back.
    final reloaded = (await StorageBookingRepository.instance.getById(booking.id))!;
    final release = await GoodsReleaseRepository.instance
        .save(GoodsReleaseRepository.instance.draftForBooking(reloaded));
    expect(release.releaseNo, isNotEmpty);
    expect(release.outstandingAtRelease, 0);

    final closed = (await StorageBookingRepository.instance.getById(booking.id))!;
    expect(closed.status, StorageStatus.released);
    expect(closed.remainingQuantity, 0);

    // And the home screen tells the truth about all of it.
    final stats = await DashboardStatsService.load();
    expect(stats.activeCustomers, 1);
    expect(stats.activeStorage, 0);
    expect(stats.customersStoring, 0);
    expect(stats.unpaidBills, isEmpty);
    expect(stats.rentDue, isEmpty);
    expect(stats.totalOutstanding, 0);
  });
}
