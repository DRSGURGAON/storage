import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/customer/customer_lookup_service.dart';
import 'package:godown_book/core/document_theme/pdf_fonts.dart';
import 'package:godown_book/features/billing/models/bill_model.dart';
import 'package:godown_book/features/billing/repositories/billing_repository.dart';
import 'package:godown_book/features/billing/services/bill_pdf_service.dart';
import 'package:godown_book/features/company/models/company_model.dart';
import 'package:godown_book/features/quotation/models/quotation_model.dart';
import 'package:godown_book/features/quotation/repositories/quotation_repository.dart';
import 'package:godown_book/features/quotation/services/quotation_pdf_service.dart';
import 'package:godown_book/features/storage_booking/models/booking_item_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_booking_model.dart';
import 'package:godown_book/features/storage_booking/repositories/storage_booking_repository.dart';
import 'package:godown_book/features/storage_booking/services/storage_receipt_pdf_service.dart';
import 'package:pdf/pdf.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

/// Documents typed in Hindi - or in Hindi and English together - must
/// print. The pdf package's standard fonts know Latin only, so every
/// document is set in the bundled Noto Sans Devanagari through
/// PdfFonts; this proves the font is bundled, covers what a godown
/// types, and that the three everyday documents build with it.
const _hindiName = 'राजेश कुमार शर्मा';
const _hindiAddress = 'मकान नं. 42, सेक्टर 9, करनाल';
const _hindiGoods = 'सोफ़ा सेट, डबल बेड, फ्रिज और 40 कार्टन';
const _hindiTerms = 'भंडारण शुल्क हर महीने की 1 तारीख को देय है।\n'
    'माल छुड़ाने से पहले पूरा भुगतान आवश्यक है।';
const _mixed = 'Rajesh Kumar (राजेश कुमार) - Sector 9, करनाल - Rs. 3,500.00';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Database db;

  setUp(() async {
    db = await openTestDatabase();
    CustomerLookupService.instance.invalidate();
  });

  tearDown(() async => db.close());

  test('the bundled font is loaded once and carries the theme', () async {
    PdfFonts.resetForTesting();
    expect(PdfFonts.isLoaded, isFalse);
    expect(PdfFonts.theme, isNull);

    await Future.wait([PdfFonts.ensureLoaded(), PdfFonts.ensureLoaded()]);
    expect(PdfFonts.isLoaded, isTrue);
    expect(PdfFonts.theme, isNotNull);

    final document = await PdfFonts.document();
    expect(document.theme, isNotNull);
  });

  test('the font has a glyph for every character a godown types', () async {
    for (final asset in [PdfFonts.regularAsset, PdfFonts.boldAsset]) {
      final parser = TtfParser(await rootBundle.load(asset));
      final missing = <String>{};
      for (final text in [
        _hindiName,
        _hindiAddress,
        _hindiGoods,
        _hindiTerms,
        _mixed,
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789',
        'Rs. 12,345.67 % & / ( ) - : ; * # @',
      ]) {
        for (final rune in text.runes) {
          if (rune == 0x0A) continue;
          if (!parser.charToGlyphIndexMap.containsKey(rune)) {
            missing.add('${String.fromCharCode(rune)} (U+${rune.toRadixString(16)})');
          }
        }
      }
      expect(missing, isEmpty, reason: '$asset lacks $missing');
    }
  });

  test('bill, storage receipt and quotation build with Hindi text', () async {
    const company = CompanyModel(
      companyId: 'company-test',
      companyName: 'शर्मा पैकर्स एंड मूवर्स',
      tagLine: 'Sharma Packers & Movers',
      address: _hindiAddress,
      city: 'करनाल',
      state: 'Haryana',
      mobile1: '9999999999',
      gstNumber: '06AAAAA0000A1Z5',
      defaultTerms: _hindiTerms,
    );

    final booking = await StorageBookingRepository.instance.save(StorageBookingModel(
      id: '',
      bookingDate: '2026-09-01T00:00:00',
      customerName: _hindiName,
      customerPhone: '9876500001',
      customerAddress: _hindiAddress,
      customerCity: 'करनाल',
      customerState: 'Haryana',
      storageStartDate: '2026-09-01T00:00:00',
      rentRate: 3500,
      goodsDescription: _hindiGoods,
      terms: _hindiTerms,
      items: const [
        BookingItemModel(id: '', bookingId: '', itemName: 'सोफ़ा सेट', quantity: 1, unit: 'सेट'),
        BookingItemModel(id: '', bookingId: '', itemName: 'कार्टन', quantity: 40, conditionNote: 'ठीक हालत'),
      ],
      createdAt: '',
    ));

    final receipt = await StorageReceiptPdfService.instance.build(booking, company);
    expect(receipt, isNotEmpty);
    expect(String.fromCharCodes(receipt.take(5)), '%PDF-');

    final draft = await BillingRepository.instance
        .draftForBooking(booking, upto: DateTime(2026, 9, 30));
    final bill = await BillingRepository.instance.saveBill(draft.copyWith(
      notes: _mixed,
      lines: [
        ...draft.lines,
        const BillLineModel(
          id: '',
          chargeName: 'पैकिंग',
          description: 'सामान की पैकिंग',
          quantity: 1,
          rate: 500,
          amount: 500,
        ),
      ],
    ));
    final billBytes = await BillPdfService.instance.build(bill, company);
    expect(billBytes, isNotEmpty);
    expect(String.fromCharCodes(billBytes.take(5)), '%PDF-');

    final quotation = await QuotationRepository.instance.save(QuotationModel(
      id: '',
      quotationDate: '2026-09-01',
      customerName: _hindiName,
      customerPhone: '9876500001',
      customerAddress: _hindiAddress,
      goodsDescription: _hindiGoods,
      notes: _mixed,
      createdAt: '',
      lines: const [
        QuotationLineModel(id: '', serviceName: 'पैकिंग और लोडिंग', rate: 6000, amount: 6000),
      ],
    ));
    final quotationBytes = await QuotationPdfService.instance.build(quotation, company);
    expect(quotationBytes, isNotEmpty);
    expect(String.fromCharCodes(quotationBytes.take(5)), '%PDF-');

    // The bundled face, not a standard font, is what went into the file.
    expect(PdfFonts.isLoaded, isTrue);
    final text = String.fromCharCodes(billBytes.where((b) => b < 128));
    expect(text, contains('NotoSansDevanagari'));
  });
}
