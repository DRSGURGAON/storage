import 'dart:typed_data';

import 'package:pdf/widgets.dart' as pw;

import '../../../core/document_theme/document_theme.dart';
import '../../../core/document_theme/pdf_page_kit.dart';
import '../../../core/utils/amount_in_words.dart';
import '../../billing/repositories/billing_repository.dart';
import '../../company/models/company_model.dart';
import '../models/storage_booking_model.dart';

/// The no-dues certificate - the letter a customer takes away when the
/// goods are collected and nothing is owed either way. It closes the
/// storage record on paper, so neither side can raise it again.
///
/// It is written from the record, not typed in: the dates, the total
/// billed, what was received and what was credited all come from what
/// the app already holds, and it is only issued when [NoDuesCheck] is
/// clear.
class NoDuesPdfService {
  NoDuesPdfService._();

  static final NoDuesPdfService instance = NoDuesPdfService._();

  DocumentThemeStyle _style = DocumentThemeStyle.of(DocumentTheme.classic);

  Future<Uint8List> build(
    StorageBookingModel booking,
    CompanyModel? company, {
    required CustomerBalance balance,
    required DepositSummary deposit,
    String issuedOn = '',
    String collectedOn = '',
    bool showWatermark = false,
    String watermarkText = '',
    double watermarkOpacity = 0.05,
  }) async {
    _style = DocumentThemeStyle.of(company?.documentTheme ?? DocumentTheme.classic);

    final document = pw.Document();
    final logo = await PdfPageKit.loadImage(company?.logoPath ?? '');
    final signature = await PdfPageKit.loadImage(company?.signaturePath ?? '');
    final dated = issuedOn.isEmpty ? DateTime.now().toIso8601String() : issuedOn;

    document.addPage(
      pw.MultiPage(
        pageTheme: PdfPageKit.pageTheme(
          style: _style,
          showWatermark: showWatermark,
          watermarkText: watermarkText,
          watermarkOpacity: watermarkOpacity,
        ),
        footer: (context) =>
            PdfPageKit.footer(context, company, leftLabel: 'No Dues Certificate'),
        build: (context) => [
          ...PdfPageKit.top(company, logo, _style, 'NO DUES CERTIFICATE'),
          _referenceRow(booking, dated),
          pw.SizedBox(height: 12),
          pw.Center(
            child: pw.Text(
              'TO WHOMSOEVER IT MAY CONCERN',
              style: pw.TextStyle(
                fontSize: 10,
                fontWeight: pw.FontWeight.bold,
                color: _style.primary,
              ),
            ),
          ),
          pw.SizedBox(height: 10),
          ..._body(booking, company, balance, deposit, collectedOn),
          pw.SizedBox(height: 10),
          _summaryBox(balance, deposit),
          pw.SizedBox(height: 18),
          PdfPageKit.signatures(
            company,
            signature,
            _style,
            otherParties: const ['Customer (Received)'],
          ),
          pw.SizedBox(height: 10),
          pw.Text(
            'This certificate is issued on the customer\'s request for their '
            'records, on the basis of the bills, receipts and release records '
            'held by us against the storage receipt named above.',
            style: const pw.TextStyle(fontSize: 6.5),
          ),
        ],
      ),
    );

    return document.save();
  }

  pw.Widget _referenceRow(StorageBookingModel b, String dated) {
    return pw.Row(
      mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
      children: [
        pw.Text('Ref. No.: NDC/${b.bookingNo}',
            style: pw.TextStyle(fontSize: 8.5, fontWeight: pw.FontWeight.bold)),
        pw.Text('Date: ${PdfPageKit.date(dated)}',
            style: const pw.TextStyle(fontSize: 8.5)),
      ],
    );
  }

  List<pw.Widget> _body(
    StorageBookingModel b,
    CompanyModel? company,
    CustomerBalance balance,
    DepositSummary deposit,
    String collectedOn,
  ) {
    final godown = (company?.companyName ?? '').trim();
    final who = godown.isEmpty ? 'us' : godown;
    final address = b.customerFullAddress.trim();
    final from = PdfPageKit.date(b.storageStartDate);
    final until = collectedOn.isNotEmpty
        ? PdfPageKit.date(collectedOn)
        : b.actualEndDate.trim().isNotEmpty
            ? PdfPageKit.date(b.actualEndDate)
            : '';

    final paragraphs = <String>[
      'This is to certify that ${b.customerName}'
          '${b.customerPhone.trim().isEmpty ? '' : ' (Mobile ${b.customerPhone})'}'
          '${address.isEmpty ? '' : ', $address,'} stored household goods '
          'with $who under Storage Receipt No. ${b.bookingNo}'
          '${from.isEmpty ? '' : ' from $from'}'
          '${until.isEmpty ? '' : ' to $until'}.',
    ];

    if (balance.billed > 0.004) {
      final settledBy = <String>[
        if (balance.received > 0.004)
          'payments of ${PdfPageKit.money(balance.received)}',
        if (balance.credited > 0.004)
          'credit notes of ${PdfPageKit.money(balance.credited)}',
      ];
      paragraphs.add(
        'All storage charges and other charges for this period, totalling '
        '${PdfPageKit.money(balance.billed)} '
        '(${AmountInWords.convert(balance.billed)}), have been settled in '
        'full${settledBy.isEmpty ? '' : ' by ${settledBy.join(' and ')}'}. '
        'As on the date of this certificate, no amount is outstanding from '
        'the customer, and no amount is payable by us to the customer.',
      );
    } else {
      paragraphs.add(
        'No storage charges were raised against this record. As on the date '
        'of this certificate, no amount is outstanding from the customer, and '
        'no amount is payable by us to the customer.',
      );
    }

    if (deposit.received > 0.004) {
      final how = deposit.returned > 0.004 && deposit.adjusted > 0.004
          ? 'partly returned to the customer and partly adjusted against the '
              'charges'
          : deposit.adjusted > 0.004
              ? 'adjusted in full against the charges'
              : 'returned to the customer in full';
      paragraphs.add(
        'The security deposit of ${PdfPageKit.money(deposit.received)} taken '
        'at the start of storage has been $how, and nothing remains held '
        'by us.',
      );
    } else {
      paragraphs.add('No security deposit was held against this record.');
    }

    paragraphs.add(
      'All goods held under this storage record have been released and '
      'collected. We have no further claim on the customer, and the customer '
      'has no claim on us, in respect of this storage record.',
    );

    return [
      for (final text in paragraphs)
        pw.Padding(
          padding: const pw.EdgeInsets.only(bottom: 6),
          child: pw.Text(
            text,
            textAlign: pw.TextAlign.justify,
            style: const pw.TextStyle(fontSize: 9, lineSpacing: 1.6),
          ),
        ),
    ];
  }

  pw.Widget _summaryBox(CustomerBalance balance, DepositSummary deposit) {
    return pw.Container(
      decoration: pw.BoxDecoration(
        border: pw.Border.all(color: PdfPageKit.black, width: 0.7),
      ),
      child: pw.Column(
        children: [
          PdfPageKit.boxHead('ACCOUNT SUMMARY', _style),
          PdfPageKit.gridRow('Total Billed', PdfPageKit.money(balance.billed), _style),
          PdfPageKit.gridRow('Total Received', PdfPageKit.money(balance.received), _style),
          if (balance.credited > 0.004)
            PdfPageKit.gridRow('Credit Notes', PdfPageKit.money(balance.credited), _style),
          if (deposit.received > 0.004) ...[
            PdfPageKit.gridRow('Deposit Taken', PdfPageKit.money(deposit.received), _style),
            PdfPageKit.gridRow(
                'Deposit Returned / Adjusted',
                PdfPageKit.money(deposit.returned + deposit.adjusted),
                _style),
          ],
          PdfPageKit.gridRow('Amount Outstanding', PdfPageKit.money(0), _style,
              bold: true, isLast: true),
        ],
      ),
    );
  }
}
