import 'dart:typed_data';

import 'package:pdf/widgets.dart' as pw;

import '../../../core/constants/default_terms.dart';
import '../../../core/document_terms/document_terms_repository.dart';
import '../../../core/document_theme/document_theme.dart';
import '../../../core/document_theme/pdf_box_row.dart';
import '../../../core/document_theme/pdf_page_kit.dart';
import '../../../core/utils/amount_in_words.dart';
import '../../company/models/company_model.dart';
import '../models/storage_booking_model.dart';
import '../models/storage_status.dart';

/// The Storage Receipt - the customer's acknowledgement that their
/// household goods were received into storage. Two labelled copies
/// (Customer / Office) from one saved record.
///
/// This is an operational acknowledgement between the storage operator
/// and their customer. It is deliberately NOT a negotiable or
/// regulatory warehouse receipt.
class StorageReceiptPdfService {
  StorageReceiptPdfService._();

  static final StorageReceiptPdfService instance = StorageReceiptPdfService._();

  static const List<String> copyLabels = ['CUSTOMER COPY', 'OFFICE COPY'];

  DocumentThemeStyle _style = DocumentThemeStyle.of(DocumentTheme.classic);
  String _customTerms = '';

  Future<Uint8List> build(
    StorageBookingModel booking,
    CompanyModel? company, {
    bool showWatermark = false,
    String watermarkText = '',
    double watermarkOpacity = 0.05,
    List<String>? copies,
  }) async {
    _style = DocumentThemeStyle.of(company?.documentTheme ?? DocumentTheme.classic);
    _customTerms = await DocumentTermsRepository.instance
        .getTerms(DocumentTermsType.storageReceipt);

    final document = pw.Document();
    final logo = await PdfPageKit.loadImage(company?.logoPath ?? '');
    final signature = await PdfPageKit.loadImage(company?.signaturePath ?? '');

    final selected = copies == null || copies.isEmpty
        ? copyLabels
        : copyLabels.where(copies.contains).toList();

    for (final copyLabel in selected) {
      document.addPage(
        pw.MultiPage(
          pageTheme: PdfPageKit.pageTheme(
            style: _style,
            showWatermark: showWatermark,
            watermarkText: watermarkText,
            watermarkOpacity: watermarkOpacity,
          ),
          footer: (context) => PdfPageKit.footer(context, company, leftLabel: copyLabel),
          build: (context) => [
            ...PdfPageKit.top(company, logo, _style, 'STORAGE RECEIPT  -  $copyLabel'),
            _infoRow(booking),
            pw.SizedBox(height: 6),
            _goodsBlock(booking),
            pw.SizedBox(height: 6),
            _itemsTable(booking),
            pw.SizedBox(height: 6),
            _rentBlock(booking),
            pw.SizedBox(height: 6),
            _termsBlock(booking, company),
            pw.SizedBox(height: 6),
            _acknowledgement(),
            pw.SizedBox(height: 8),
            PdfPageKit.bankDetails(company, _style),
            pw.SizedBox(height: 12),
            PdfPageKit.signatures(
              company,
              signature,
              _style,
              otherParties: const ['Customer Signature', 'Received By'],
            ),
          ],
        ),
      );
    }

    return document.save();
  }

  pw.Widget _infoRow(StorageBookingModel b) {
    return PdfBoxRow.equal(gap: 4, [
      pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.boxHead('STORAGE', _style),
            PdfPageKit.gridRow('Receipt No.', b.bookingNo, _style, bold: true),
            PdfPageKit.gridRow('Entry Date', PdfPageKit.date(b.bookingDate), _style, bold: true),
            PdfPageKit.gridRow('Storage From', PdfPageKit.date(b.storageStartDate), _style),
            PdfPageKit.gridRow(
              'Expected Upto',
              b.expectedEndDate.isEmpty ? 'Open' : PdfPageKit.date(b.expectedEndDate),
              _style,
            ),
            PdfPageKit.gridRow('Location', b.locationName, _style, isLast: true),
          ],
        ),
      ),
      PdfPageKit.box(
        'CUSTOMER',
        _style,
        pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.kv('Name', b.customerName, _style),
            PdfPageKit.kv('Mobile', b.customerPhone, _style),
            PdfPageKit.kv('GST No.', b.customerGst.isEmpty ? 'N/A' : b.customerGst, _style),
            PdfPageKit.kv('Address', b.customerFullAddress, _style),
            PdfPageKit.kv('ID Proof', b.customerIdProof, _style),
          ],
        ),
      ),
      pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.boxHead('RECEIVED VIA', _style),
            PdfPageKit.gridRow('Vehicle No.', b.vehicleNumber, _style),
            PdfPageKit.gridRow('Driver', b.driverName, _style),
            PdfPageKit.gridRow('Received By', b.receivedBy, _style),
            PdfPageKit.gridRow(
              'Total Packages',
              b.totalPackages > 0 ? '${b.totalPackages}' : PdfPageKit.qty(b.totalQuantity),
              _style,
              bold: true,
              isLast: true,
            ),
          ],
        ),
      ),
    ]);
  }

  pw.Widget _goodsBlock(StorageBookingModel b) {
    return PdfPageKit.box(
      'DESCRIPTION OF GOODS',
      _style,
      pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.Text(
            b.goodsDescription.trim().isEmpty ? 'As per the item list below.' : b.goodsDescription.trim(),
            style: const pw.TextStyle(fontSize: 7.5),
          ),
          pw.SizedBox(height: 3),
          pw.Row(
            children: [
              pw.Expanded(
                child: PdfPageKit.kv(
                  'Declared Value',
                  b.declaredValue > 0 ? PdfPageKit.money(b.declaredValue) : 'Not declared',
                  _style,
                ),
              ),
              pw.Expanded(
                child: PdfPageKit.kv(
                  'Insurance',
                  b.insuranceNote.trim().isEmpty ? "At owner's risk - not insured by the godown" : b.insuranceNote.trim(),
                  _style,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  pw.Widget _itemsTable(StorageBookingModel b) {
    if (b.items.isEmpty) return pw.SizedBox.shrink();

    final rows = <List<String>>[];
    for (var i = 0; i < b.items.length; i++) {
      final item = b.items[i];
      rows.add([
        '${i + 1}',
        item.itemName,
        item.description,
        PdfPageKit.qty(item.quantity),
        item.unit,
        item.weight,
        [item.marks, item.conditionNote].where((s) => s.trim().isNotEmpty).join(' / '),
      ]);
    }

    return PdfPageKit.table(
      const ['Sr.', 'Item', 'Description', 'Qty', 'Unit', 'Weight', 'Marks / Condition'],
      rows,
      _style,
      columnWidths: const {
        0: pw.FixedColumnWidth(22),
        1: pw.FlexColumnWidth(3),
        2: pw.FlexColumnWidth(3),
        3: pw.FixedColumnWidth(34),
        4: pw.FixedColumnWidth(34),
        5: pw.FlexColumnWidth(1.4),
        6: pw.FlexColumnWidth(2.6),
      },
      aligns: const [
        pw.TextAlign.center,
        pw.TextAlign.left,
        pw.TextAlign.left,
        pw.TextAlign.right,
        pw.TextAlign.center,
        pw.TextAlign.left,
        pw.TextAlign.left,
      ],
      totals: ['', 'Total', '', PdfPageKit.qty(b.totalQuantity), '', '', ''],
    );
  }

  pw.Widget _rentBlock(StorageBookingModel b) {
    final rate = b.rentRate > 0
        ? '${PdfPageKit.money(b.rentRate)} ${b.rentUnitLabel.trim().isEmpty ? b.rentBasis.label.toLowerCase() : b.rentUnitLabel.trim()}'
        : 'As agreed';

    return PdfBoxRow.equal(gap: 4, [
      pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.boxHead('STORAGE RENT', _style),
            PdfPageKit.gridRow('Rent', rate, _style, bold: true),
            if (b.areaSqft > 0)
              PdfPageKit.gridRow('Area', '${PdfPageKit.qty(b.areaSqft)} sq.ft', _style),
            PdfPageKit.gridRow(
              'Security Deposit',
              b.securityDeposit > 0 ? PdfPageKit.money(b.securityDeposit) : 'Nil',
              _style,
              isLast: true,
            ),
          ],
        ),
      ),
      pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        alignment: pw.Alignment.center,
        padding: const pw.EdgeInsets.symmetric(vertical: 12, horizontal: 6),
        child: pw.Text(
          b.securityDeposit > 0
              ? 'Deposit received: ${AmountInWords.convert(b.securityDeposit)}'
              : 'Rent is billed ${b.rentBasis == RentBasis.daily ? 'per day' : 'monthly'} from ${PdfPageKit.date(b.storageStartDate)}',
          textAlign: pw.TextAlign.center,
          style: pw.TextStyle(fontSize: 8.5, fontWeight: pw.FontWeight.bold, color: _style.primary),
        ),
      ),
    ]);
  }

  pw.Widget _termsBlock(StorageBookingModel b, CompanyModel? company) {
    // This receipt's own terms -> customised Warehouse Receipt terms ->
    // company-wide default terms -> the built-in standard terms.
    final terms = b.terms.trim().isNotEmpty
        ? b.terms.trim()
        : _customTerms.isNotEmpty
            ? _customTerms
            : (company?.defaultTerms.trim().isNotEmpty ?? false)
                ? company!.defaultTerms.trim()
                : DefaultStorageTerms.terms.join('\n');
    return PdfPageKit.terms('Terms & Conditions :-', terms, _style);
  }

  pw.Widget _acknowledgement() {
    return pw.Text(
      'RECEIVED THE ABOVE GOODS IN APPARENT GOOD ORDER AND CONDITION, CONTENTS NOT VERIFIED, '
      'FOR STORAGE ON THE TERMS PRINTED ABOVE. GOODS WILL BE RELEASED ONLY AGAINST THIS RECEIPT '
      'AFTER SETTLEMENT OF ALL DUES.',
      style: pw.TextStyle(fontSize: 7, fontWeight: pw.FontWeight.bold),
    );
  }
}
