import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/subscription/document_type.dart';
import 'package:godown_book/features/billing/models/payment_model.dart';
import 'package:godown_book/features/billing/repositories/billing_repository.dart';
import 'package:godown_book/features/billing/services/payment_receipt_pdf_service.dart';
import 'package:godown_book/features/company/models/company_model.dart';
import 'package:godown_book/features/customers/models/customer_model.dart';
import 'package:godown_book/features/customers/repositories/customer_repository.dart';
import 'package:godown_book/features/incidents/models/incident_model.dart';
import 'package:godown_book/features/incidents/repositories/incident_repository.dart';
import 'package:godown_book/features/incidents/services/incident_pdf_service.dart';
import 'package:godown_book/features/notices/models/notice_model.dart';
import 'package:godown_book/features/notices/repositories/notice_repository.dart';
import 'package:godown_book/features/notices/services/notice_pdf_service.dart';
import 'package:godown_book/features/storage_booking/models/booking_item_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_booking_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_status.dart';
import 'package:godown_book/features/storage_booking/repositories/storage_booking_repository.dart';
import 'package:godown_book/features/storage_booking/repositories/storage_photo_repository.dart';
import 'package:godown_book/features/storage_booking/services/authority_letter_pdf_service.dart';
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

/// The smallest valid PNG - a single transparent pixel. Enough for the
/// PDF layer to treat it as a real photograph.
final _onePixelPng = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM'
  'IQAAAABJRU5ErkJggg==',
);

void main() {
  late Database db;

  setUp(() async {
    db = await openTestDatabase();
  });

  tearDown(() async {
    await db.close();
  });

  Future<CustomerModel> customer() => CustomerRepository.instance.create(
        const CustomerModel(
          id: '',
          customerName: 'Rajesh Kumar',
          mobileNumber: '9876500001',
          address: 'B-42, Sector 9',
          city: 'Karnal',
          state: 'Haryana',
          createdAt: '',
        ),
      );

  Future<StorageBookingModel> booking(CustomerModel c) =>
      StorageBookingRepository.instance.save(StorageBookingModel(
        id: '',
        bookingDate: DateTime(2026, 9, 1).toIso8601String(),
        customerId: c.id,
        customerName: c.customerName,
        customerPhone: c.mobileNumber,
        storageStartDate: DateTime(2026, 9, 1).toIso8601String(),
        rentBasis: RentBasis.monthly,
        rentRate: 3500,
        securityDeposit: 5000,
        createdAt: '',
        items: const [
          BookingItemModel(id: '', bookingId: '', itemName: 'Sofa set', quantity: 1),
        ],
      ));

  group('security deposit', () {
    test('is held, not counted as rent received', () async {
      final c = await customer();
      final b = await booking(c);

      await BillingRepository.instance.recordPayment(PaymentModel(
        id: '',
        customerId: c.id,
        bookingId: b.id,
        payerName: c.customerName,
        amount: 5000,
        paymentType: PaymentType.securityDeposit,
        paymentDate: DateTime(2026, 9, 1).toIso8601String(),
        createdAt: '',
      ));

      // A bill, unpaid: the deposit must not settle it.
      final bill = await BillingRepository.instance.saveBill(
        await BillingRepository.instance
            .draftForBooking(b, upto: DateTime(2026, 9, 30)),
      );
      expect(bill.grandTotal, 3500);

      final balance = await BillingRepository.instance.balanceForCustomer(c.id);
      expect(balance.received, 0);
      expect(balance.outstanding, 3500);
      expect(balance.depositHeld, 5000);

      final deposit = await BillingRepository.instance
          .depositForBooking(b.id, agreed: b.securityDeposit);
      expect(deposit.received, 5000);
      expect(deposit.held, 5000);
      expect(deposit.notYetTaken, 0);
    });

    test('adjusting it against the dues settles the bill and lowers the deposit',
        () async {
      final c = await customer();
      final b = await booking(c);

      await BillingRepository.instance.recordPayment(PaymentModel(
        id: '',
        customerId: c.id,
        bookingId: b.id,
        payerName: c.customerName,
        amount: 5000,
        paymentType: PaymentType.securityDeposit,
        paymentDate: DateTime(2026, 9, 1).toIso8601String(),
        createdAt: '',
      ));

      final bill = await BillingRepository.instance.saveBill(
        await BillingRepository.instance
            .draftForBooking(b, upto: DateTime(2026, 9, 30)),
      );

      await BillingRepository.instance.recordPayment(PaymentModel(
        id: '',
        billId: bill.id,
        customerId: c.id,
        bookingId: b.id,
        payerName: c.customerName,
        amount: 3500,
        paymentType: PaymentType.depositAdjusted,
        paymentDate: DateTime(2026, 10, 1).toIso8601String(),
        createdAt: '',
      ));

      final settled = (await BillingRepository.instance.getBillById(bill.id))!;
      expect(settled.amountPaid, 3500);

      final balance = await BillingRepository.instance.balanceForCustomer(c.id);
      expect(balance.outstanding, 0);
      expect(balance.depositHeld, 1500);

      // And the rest goes back.
      await BillingRepository.instance.recordPayment(PaymentModel(
        id: '',
        customerId: c.id,
        bookingId: b.id,
        payerName: c.customerName,
        amount: 1500,
        paymentType: PaymentType.depositRefund,
        paymentDate: DateTime(2026, 10, 2).toIso8601String(),
        createdAt: '',
      ));

      final after = await BillingRepository.instance.balanceForCustomer(c.id);
      expect(after.depositHeld, 0);
      expect(after.outstanding, 0);
    });

    test('deposit entries never appear in the statement as payments', () async {
      final c = await customer();
      final b = await booking(c);

      await BillingRepository.instance.recordPayment(PaymentModel(
        id: '',
        customerId: c.id,
        bookingId: b.id,
        payerName: c.customerName,
        amount: 5000,
        paymentType: PaymentType.securityDeposit,
        paymentDate: DateTime(2026, 9, 1).toIso8601String(),
        createdAt: '',
      ));

      final entries = await BillingRepository.instance.statementForCustomer(c.id);
      expect(entries.where((e) => e.credit > 0), isEmpty);
    });

    test('the receipt says which kind of money it is', () async {
      final c = await customer();
      final b = await booking(c);

      final payment = await BillingRepository.instance.recordPayment(PaymentModel(
        id: '',
        customerId: c.id,
        bookingId: b.id,
        payerName: c.customerName,
        amount: 5000,
        paymentType: PaymentType.securityDeposit,
        paymentDate: DateTime(2026, 9, 1).toIso8601String(),
        createdAt: '',
      ));

      final bytes =
          await PaymentReceiptPdfService.instance.build(payment, _company);
      expect(String.fromCharCodes(bytes.take(5)), '%PDF-');
    });
  });

  group('notices', () {
    test('are numbered in order and keep the record of how they were sent',
        () async {
      final c = await customer();
      final b = await booking(c);

      final first = await NoticeRepository.instance.save(NoticeModel(
        id: '',
        noticeDate: DateTime(2026, 11, 1).toIso8601String(),
        kind: NoticeKind.reminder,
        customerId: c.id,
        bookingId: b.id,
        customerName: c.customerName,
        customerPhone: c.mobileNumber,
        bookingNo: b.bookingNo,
        amountDue: 3500,
        payByDate: DateTime(2026, 11, 8).toIso8601String(),
        createdAt: '',
      ));

      final second = await NoticeRepository.instance.save(first.copyWith(
        id: '',
        kind: NoticeKind.finalNotice,
        noticeNo: '',
        noticeDate: DateTime(2026, 11, 20).toIso8601String(),
      ));

      expect(first.noticeNo, endsWith('/0001'));
      expect(second.noticeNo, endsWith('/0002'));
      expect(first.noticeNo, startsWith('NT/'));

      await NoticeRepository.instance.markSent(first.id, 'WhatsApp');
      final reloaded = await NoticeRepository.instance.getById(first.id);
      expect(reloaded!.sentVia, 'WhatsApp');

      final forBooking = await NoticeRepository.instance.getForBooking(b.id);
      expect(forBooking, hasLength(2));
    });

    test('every kind of letter renders', () async {
      final c = await customer();

      for (final kind in NoticeKind.values) {
        final notice = await NoticeRepository.instance.save(NoticeModel(
          id: '',
          noticeDate: DateTime(2026, 11, 1).toIso8601String(),
          kind: kind,
          customerId: c.id,
          customerName: c.customerName,
          customerPhone: c.mobileNumber,
          customerAddress: 'B-42, Sector 9, Karnal',
          bookingNo: 'SR/2026/0001',
          amountDue: 7850,
          payByDate: DateTime(2026, 11, 20).toIso8601String(),
          createdAt: '',
        ));

        final bytes = await NoticePdfService.instance.build(notice, _company);
        expect(String.fromCharCodes(bytes.take(5)), '%PDF-', reason: kind.name);
        expect(bytes.length, greaterThan(1000), reason: kind.name);
      }
    });
  });

  group('damage and loss reports', () {
    test('are numbered, keep their number when edited, and carry photos',
        () async {
      final c = await customer();
      final b = await booking(c);

      final report = await IncidentRepository.instance.save(IncidentModel(
        id: '',
        reportDate: DateTime(2026, 10, 12).toIso8601String(),
        kind: IncidentKind.water,
        bookingId: b.id,
        bookingNo: b.bookingNo,
        customerId: c.id,
        customerName: c.customerName,
        happenedOn: DateTime(2026, 10, 11).toIso8601String(),
        goodsAffected: 'Two cartons of books',
        whatHappened: 'Rain came in through the roof overnight.',
        estimatedLoss: 4000,
        createdAt: '',
      ));

      expect(report.reportNo, startsWith('DR/'));
      expect(report.reportNo, endsWith('/0001'));

      final edited = await IncidentRepository.instance.save(
        report.copyWith(actionTaken: 'Roof repaired the same day.'),
      );
      expect(edited.reportNo, report.reportNo);

      final reloaded = await IncidentRepository.instance.getById(report.id);
      expect(reloaded!.actionTaken, 'Roof repaired the same day.');

      // A photo on the report is not a photo of the goods, and the
      // other way round.
      final file = File('${Directory.systemTemp.path}/incident-test.png')
        ..writeAsBytesSync(_onePixelPng);
      await StoragePhotoRepository.instance.attachFile(
        bookingId: b.id,
        incidentId: report.id,
        filePath: file.path,
        caption: 'Wet carton',
      );
      await StoragePhotoRepository.instance
          .attachFile(bookingId: b.id, filePath: file.path);

      expect(await StoragePhotoRepository.instance.getForIncident(report.id),
          hasLength(1));
      expect(await StoragePhotoRepository.instance.getForBooking(b.id),
          hasLength(1));

      final bytes = await IncidentPdfService.instance.build(
        reloaded,
        _company,
        photos: await StoragePhotoRepository.instance.getForIncident(report.id),
      );
      expect(String.fromCharCodes(bytes.take(5)), '%PDF-');
    });
  });

  group('photos of one item', () {
    test('sit next to the item, and the whole-load photos stay separate',
        () async {
      final c = await customer();
      final b = await StorageBookingRepository.instance.save(StorageBookingModel(
        id: '',
        bookingDate: DateTime(2026, 9, 1).toIso8601String(),
        customerId: c.id,
        customerName: c.customerName,
        customerPhone: c.mobileNumber,
        storageStartDate: DateTime(2026, 9, 1).toIso8601String(),
        createdAt: '',
        items: const [
          BookingItemModel(id: '', bookingId: '', itemName: 'Sofa', quantity: 1),
          BookingItemModel(id: '', bookingId: '', itemName: 'Fridge', quantity: 1),
        ],
      ));
      final sofa = b.items.firstWhere((i) => i.itemName == 'Sofa');

      final file = File('${Directory.systemTemp.path}/item-photo-test.png')
        ..writeAsBytesSync(_onePixelPng);
      await StoragePhotoRepository.instance.attachFile(
        bookingId: b.id,
        filePath: file.path,
        itemId: sofa.id,
        caption: 'Tear on the left arm',
      );
      await StoragePhotoRepository.instance
          .attachFile(bookingId: b.id, filePath: file.path, itemId: sofa.id);
      await StoragePhotoRepository.instance
          .attachFile(bookingId: b.id, filePath: file.path);

      final repo = StoragePhotoRepository.instance;
      expect(await repo.getForItem(sofa.id), hasLength(2));
      expect((await repo.getForItem(sofa.id)).first.caption, 'Tear on the left arm');
      // Every goods photo, item or not, is still a photo of the record.
      expect(await repo.getForBooking(b.id), hasLength(3));
      expect(await repo.countByItem(b.id), {sofa.id: 2, '': 1});
    });
  });

  group('handover papers', () {
    test('the authority letter and the indemnity bond both render', () async {
      final c = await customer();
      final b = await booking(c);

      for (final paper in HandoverPaper.values) {
        final bytes = await AuthorityLetterPdfService.instance.build(
          b,
          _company,
          paper: paper,
          details: const HandoverDetails(
            personName: 'Suresh Kumar',
            personPhone: '9876500002',
            personIdProof: 'Aadhaar XXXX 1234',
            relation: 'Brother',
          ),
        );
        expect(String.fromCharCodes(bytes.take(5)), '%PDF-', reason: paper.name);
        expect(bytes.length, greaterThan(1000), reason: paper.name);
      }
    });
  });

  test('every document type the app counts has a label', () {
    for (final type in DocumentType.all) {
      expect(DocumentType.label(type), isNot(type), reason: type);
    }
  });
}
