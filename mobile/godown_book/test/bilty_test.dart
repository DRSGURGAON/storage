import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/features/company/models/company_model.dart';
import 'package:godown_book/features/consignment/models/consignment_model.dart';
import 'package:godown_book/features/consignment/repositories/consignment_repository.dart';
import 'package:godown_book/features/consignment/services/consignment_pdf_service.dart';
import 'package:godown_book/features/customers/models/customer_model.dart';
import 'package:godown_book/features/customers/repositories/customer_repository.dart';
import 'package:godown_book/features/storage_booking/models/booking_item_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_booking_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_status.dart';
import 'package:godown_book/features/storage_booking/repositories/storage_booking_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

const _company = CompanyModel(
  companyId: 'company-test',
  companyName: 'Sharma Packers & Storage',
  address: 'Plot 14, Industrial Area',
  city: 'Karnal',
  state: 'Haryana',
  mobile1: '9810000000',
);

ConsignmentModel _draft({String consignor = 'Rajesh Kumar'}) => ConsignmentModel(
      id: '',
      lrDate: DateTime(2026, 9, 1).toIso8601String(),
      consignorName: consignor,
      consignorPhone: '9876500001',
      consigneeName: consignor,
      fromPlace: 'Karnal',
      toPlace: 'Pune',
      vehicleNumber: 'HR 45 A 1234',
      driverName: 'Balwinder Singh',
      declaredValue: 250000,
      freightAmount: 24000,
      otherCharges: 2500,
      advancePaid: 5000,
      createdAt: '',
      items: const [
        ConsignmentItemModel(id: '', itemName: 'Sofa set', quantity: 1, unit: 'Set'),
        ConsignmentItemModel(id: '', itemName: 'Cartons', quantity: 39),
      ],
    );

void main() {
  late Database db;

  setUp(() async {
    db = await openTestDatabase();
  });

  tearDown(() async {
    await db.close();
  });

  test('bilties are numbered in order and keep their number when edited',
      () async {
    final first = await ConsignmentRepository.instance.save(_draft());
    final second =
        await ConsignmentRepository.instance.save(_draft(consignor: 'Anita Rao'));

    expect(first.lrNo, startsWith('LR/'));
    expect(first.lrNo, endsWith('/0001'));
    expect(second.lrNo, endsWith('/0002'));

    final edited = await ConsignmentRepository.instance
        .save(first.copyWith(vehicleNumber: 'HR 45 B 9999'));
    expect(edited.lrNo, first.lrNo);

    final reloaded = await ConsignmentRepository.instance.getById(first.id);
    expect(reloaded!.vehicleNumber, 'HR 45 B 9999');
    expect(reloaded.items, hasLength(2));
  });

  test('freight adds up and the balance is what is collected on delivery',
      () async {
    final bilty = await ConsignmentRepository.instance.save(_draft());

    expect(bilty.freightTotal, 26500);
    expect(bilty.freightBalance, 21500);
    expect(bilty.totalPackages, 40);
  });

  test('the challan number is issued only when a challan is asked for',
      () async {
    final bilty = await ConsignmentRepository.instance.save(_draft());
    expect(bilty.challanNo, isEmpty);

    final numbered =
        await ConsignmentRepository.instance.ensureChallanNumber(bilty.id);
    expect(numbered.challanNo, startsWith('DC/'));
    expect(numbered.challanNo, endsWith('/0001'));

    // Asking again returns the same number, never a second one.
    final again =
        await ConsignmentRepository.instance.ensureChallanNumber(bilty.id);
    expect(again.challanNo, numbered.challanNo);

    // A second bilty that needs a challan gets the next number in that
    // series, not the next LR number.
    final other =
        await ConsignmentRepository.instance.save(_draft(consignor: 'Anita Rao'));
    final otherChallan =
        await ConsignmentRepository.instance.ensureChallanNumber(other.id);
    expect(otherChallan.challanNo, endsWith('/0002'));
  });

  test('a bilty started from a storage record carries the goods over',
      () async {
    final customer = await CustomerRepository.instance.create(const CustomerModel(
      id: '',
      customerName: 'Rajesh Kumar',
      mobileNumber: '9876500001',
      address: 'B-42, Sector 9',
      city: 'Karnal',
      state: 'Haryana',
      createdAt: '',
    ));

    final booking = await StorageBookingRepository.instance.save(StorageBookingModel(
      id: '',
      bookingDate: DateTime(2026, 9, 1).toIso8601String(),
      customerId: customer.id,
      customerName: customer.customerName,
      customerPhone: customer.mobileNumber,
      storageStartDate: DateTime(2026, 9, 1).toIso8601String(),
      rentBasis: RentBasis.monthly,
      rentRate: 3500,
      declaredValue: 250000,
      createdAt: '',
      items: const [
        BookingItemModel(id: '', bookingId: '', itemName: 'Sofa set', quantity: 1),
        BookingItemModel(id: '', bookingId: '', itemName: 'Cartons', quantity: 39),
      ],
    ));

    final draft = ConsignmentRepository.instance.draftForBooking(booking);
    expect(draft.consignorName, 'Rajesh Kumar');
    expect(draft.declaredValue, 250000);
    expect(draft.items, hasLength(2));
    expect(draft.bookingNo, booking.bookingNo);

    final saved = await ConsignmentRepository.instance.save(draft);
    final forBooking =
        await ConsignmentRepository.instance.getForBooking(booking.id);
    expect(forBooking.single.id, saved.id);
  });

  test('marking it delivered records who took it, and when', () async {
    final bilty = await ConsignmentRepository.instance.save(_draft());

    final delivered = await ConsignmentRepository.instance.markDelivered(
      bilty.id,
      receivedBy: 'Rajesh Kumar',
      deliveredOn: DateTime(2026, 9, 4),
      remarks: 'One carton torn at the corner',
    );

    expect(delivered!.status, ConsignmentStatus.delivered);
    expect(delivered.isDelivered, isTrue);
    expect(delivered.receivedBy, 'Rajesh Kumar');
    expect(delivered.deliveryRemarks, 'One carton torn at the corner');
  });

  test('all three papers render, and the bilty prints its four copies',
      () async {
    final bilty = await ConsignmentRepository.instance.save(_draft());
    final withChallan =
        await ConsignmentRepository.instance.ensureChallanNumber(bilty.id);

    for (final paper in BiltyPaper.values) {
      final bytes = await ConsignmentPdfService.instance
          .build(withChallan, _company, paper: paper);
      expect(String.fromCharCodes(bytes.take(5)), '%PDF-', reason: paper.name);
      expect(bytes.length, greaterThan(1000), reason: paper.name);
    }

    final oneCopy = await ConsignmentPdfService.instance.build(
      withChallan,
      _company,
      paper: BiltyPaper.lorryReceipt,
      copies: const ['DRIVER COPY'],
    );
    final allCopies = await ConsignmentPdfService.instance
        .build(withChallan, _company, paper: BiltyPaper.lorryReceipt);
    expect(allCopies.length, greaterThan(oneCopy.length));
  });

  test('deleting a bilty takes its item lines with it', () async {
    final bilty = await ConsignmentRepository.instance.save(_draft());
    await ConsignmentRepository.instance.delete(bilty.id);

    expect(await ConsignmentRepository.instance.getById(bilty.id), isNull);
    expect(await db.query('consignment_items'), isEmpty);
  });
}
