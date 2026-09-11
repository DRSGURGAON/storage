import 'dart:typed_data';

import 'package:pdf/widgets.dart' as pw;

import '../../../core/document_theme/document_theme.dart';
import '../../../core/document_theme/pdf_box_row.dart';
import '../../../core/document_theme/pdf_page_kit.dart';
import '../../../core/utils/amount_in_words.dart';
import '../../company/models/company_model.dart';
import '../../customers/models/customer_model.dart';
import '../repositories/billing_repository.dart';

/// The customer statement - bills, receipts and what is left, in date
/// order. A business statement, not an accounting ledger.
class StatementPdfService {
  StatementPdfService._();

  static final StatementPdfService instance = StatementPdfService._();

  DocumentThemeStyle _style = DocumentThemeStyle.of(DocumentTheme.classic);

  Future<Uint8List> build({
    required CustomerModel customer,
    required List<StatementEntry> entries,
    required double openingBalance,
    CompanyModel? company,
    DateTime? from,
    DateTime? to,
    bool showWatermark = false,
    String watermarkText = '',
    double watermarkOpacity = 0.05,
  }) async {
    _style = DocumentThemeStyle.of(company?.documentTheme ?? DocumentTheme.classic);

    final document = pw.Document();
    final logo = await PdfPageKit.loadImage(company?.logoPath ?? '');
    final signature = await PdfPageKit.loadImage(company?.signaturePath ?? '');

    final closing = entries.isEmpty ? openingBalance : entries.last.runningBalance;
    final billed = entries.fold(0.0, (sum, e) => sum + e.debit);
    final received = entries.fold(0.0, (sum, e) => sum + e.credit);

    document.addPage(
      pw.MultiPage(
        pageTheme: PdfPageKit.pageTheme(
          style: _style,
          showWatermark: showWatermark,
          watermarkText: watermarkText,
          watermarkOpacity: watermarkOpacity,
        ),
        footer: (context) =>
            PdfPageKit.footer(context, company, leftLabel: 'Customer Statement'),
        build: (context) => [
          ...PdfPageKit.top(company, logo, _style, 'CUSTOMER STATEMENT'),
          _infoRow(customer, from, to, openingBalance),
          pw.SizedBox(height: 6),
          _entriesTable(entries, openingBalance, billed, received),
          pw.SizedBox(height: 6),
          _closingBand(closing),
          pw.SizedBox(height: 8),
          PdfPageKit.bankDetails(company, _style),
          pw.SizedBox(height: 14),
          PdfPageKit.signatures(company, signature, _style, otherParties: const []),
        ],
      ),
    );

    return document.save();
  }

  pw.Widget _infoRow(
    CustomerModel customer,
    DateTime? from,
    DateTime? to,
    double openingBalance,
  ) {
    String periodText() {
      if (from == null && to == null) return 'All entries to date';
      final start = from == null ? 'Beginning' : PdfPageKit.date(from.toIso8601String());
      final end = to == null ? 'today' : PdfPageKit.date(to.toIso8601String());
      return '$start to $end';
    }

    return PdfBoxRow.equal(gap: 4, [
      PdfPageKit.box(
        'CUSTOMER',
        _style,
        pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.kv('Name', customer.customerName, _style),
            PdfPageKit.kv('Mobile', customer.mobileNumber, _style),
            if (customer.gstNumber.trim().isNotEmpty)
              PdfPageKit.kv('GST No.', customer.gstNumber, _style),
            PdfPageKit.kv('Address', customer.fullAddress, _style),
          ],
        ),
      ),
      pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.boxHead('STATEMENT', _style),
            PdfPageKit.gridRow('Period', periodText(), _style, bold: true),
            PdfPageKit.gridRow(
              'Printed On',
              PdfPageKit.date(DateTime.now().toIso8601String()),
              _style,
            ),
            PdfPageKit.gridRow(
              'Opening Balance',
              PdfPageKit.money(openingBalance.abs()) +
                  (openingBalance < 0 ? ' (advance)' : ''),
              _style,
              bold: true,
              isLast: true,
            ),
          ],
        ),
      ),
    ]);
  }

  pw.Widget _entriesTable(
    List<StatementEntry> entries,
    double openingBalance,
    double billed,
    double received,
  ) {
    final rows = <List<String>>[
      [
        '',
        '',
        'Opening balance',
        '',
        '',
        PdfPageKit.money(openingBalance.abs()) + (openingBalance < 0 ? ' Cr' : ''),
      ],
    ];

    for (var i = 0; i < entries.length; i++) {
      final e = entries[i];
      rows.add([
        '${i + 1}',
        PdfPageKit.date(e.date),
        '${e.particulars}${e.reference.isEmpty ? '' : '  (${e.reference})'}',
        e.debit > 0 ? e.debit.toStringAsFixed(2) : '',
        e.credit > 0 ? e.credit.toStringAsFixed(2) : '',
        PdfPageKit.money(e.runningBalance.abs()) + (e.runningBalance < 0 ? ' Cr' : ''),
      ]);
    }

    return PdfPageKit.table(
      const ['Sr.', 'Date', 'Particulars', 'Billed', 'Received', 'Balance'],
      rows,
      _style,
      columnWidths: const {
        0: pw.FixedColumnWidth(22),
        1: pw.FixedColumnWidth(58),
        2: pw.FlexColumnWidth(4),
        3: pw.FixedColumnWidth(56),
        4: pw.FixedColumnWidth(56),
        5: pw.FixedColumnWidth(70),
      },
      aligns: const [
        pw.TextAlign.center,
        pw.TextAlign.left,
        pw.TextAlign.left,
        pw.TextAlign.right,
        pw.TextAlign.right,
        pw.TextAlign.right,
      ],
      totals: [
        '',
        '',
        'Total for the period',
        billed.toStringAsFixed(2),
        received.toStringAsFixed(2),
        '',
      ],
    );
  }

  pw.Widget _closingBand(double closing) {
    final owed = closing >= 0;
    return pw.Container(
      width: double.infinity,
      color: _style.primary,
      padding: const pw.EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      child: pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: [
          pw.Text(
            owed ? 'AMOUNT PAYABLE BY CUSTOMER' : 'ADVANCE WITH US',
            style: pw.TextStyle(
                fontSize: 10, fontWeight: pw.FontWeight.bold, color: _style.onPrimary),
          ),
          pw.Text(
            '${PdfPageKit.money(closing.abs())}   (${AmountInWords.convert(closing.abs())})',
            style: pw.TextStyle(
                fontSize: 9, fontWeight: pw.FontWeight.bold, color: _style.onPrimary),
          ),
        ],
      ),
    );
  }
}
