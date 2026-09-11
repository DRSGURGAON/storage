import 'dart:typed_data';

import 'package:pdf/widgets.dart' as pw;

import '../../../core/document_terms/document_terms_repository.dart';
import '../../../core/document_theme/document_theme.dart';
import '../../../core/document_theme/pdf_box_row.dart';
import '../../../core/document_theme/pdf_page_kit.dart';
import '../../../core/utils/amount_in_words.dart';
import '../../company/models/company_model.dart';
import '../models/bill_model.dart';

/// The storage bill - what the customer owes for a period, and what is
/// still outstanding after whatever they have already paid.
class BillPdfService {
  BillPdfService._();

  static final BillPdfService instance = BillPdfService._();

  DocumentThemeStyle _style = DocumentThemeStyle.of(DocumentTheme.classic);
  String _customTerms = '';

  Future<Uint8List> build(
    BillModel bill,
    CompanyModel? company, {
    bool showWatermark = false,
    String watermarkText = '',
    double watermarkOpacity = 0.05,

    /// What the customer owed before this bill - printed only when the
    /// caller supplies it, never invented.
    double? previousBalance,
  }) async {
    _style = DocumentThemeStyle.of(company?.documentTheme ?? DocumentTheme.classic);
    _customTerms =
        await DocumentTermsRepository.instance.getTerms(DocumentTermsType.bill);

    final document = pw.Document();
    final logo = await PdfPageKit.loadImage(company?.logoPath ?? '');
    final signature = await PdfPageKit.loadImage(company?.signaturePath ?? '');

    final hasGst = (company?.gstNumber ?? '').trim().isNotEmpty;
    final title = hasGst && bill.gstAmount > 0 ? 'TAX INVOICE' : 'STORAGE BILL';

    document.addPage(
      pw.MultiPage(
        pageTheme: PdfPageKit.pageTheme(
          style: _style,
          showWatermark: showWatermark,
          watermarkText: watermarkText,
          watermarkOpacity: watermarkOpacity,
        ),
        footer: (context) => PdfPageKit.footer(context, company, leftLabel: 'Storage Bill'),
        build: (context) => [
          ...PdfPageKit.top(company, logo, _style, title),
          _infoRow(bill),
          pw.SizedBox(height: 6),
          _linesTable(bill),
          pw.SizedBox(height: 6),
          _totalsRow(bill, previousBalance),
          pw.SizedBox(height: 6),
          if (_termsText(bill, company).isNotEmpty) ...[
            PdfPageKit.terms('Terms & Conditions :-', _termsText(bill, company), _style),
            pw.SizedBox(height: 6),
          ],
          PdfPageKit.bankDetails(company, _style),
          pw.SizedBox(height: 12),
          PdfPageKit.signatures(company, signature, _style, otherParties: const []),
        ],
      ),
    );

    return document.save();
  }

  String _termsText(BillModel bill, CompanyModel? company) {
    if (_customTerms.isNotEmpty) return _customTerms;
    return (company?.defaultTerms ?? '').trim();
  }

  pw.Widget _infoRow(BillModel bill) {
    return PdfBoxRow.equal(gap: 4, [
      pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.boxHead('BILL', _style),
            PdfPageKit.gridRow('Bill No.', bill.billNo, _style, bold: true),
            PdfPageKit.gridRow('Bill Date', PdfPageKit.date(bill.billDate), _style, bold: true),
            PdfPageKit.gridRow(
              'Due Date',
              bill.dueDate.isEmpty ? 'On receipt' : PdfPageKit.date(bill.dueDate),
              _style,
            ),
            PdfPageKit.gridRow('Status', bill.derivedStatus.label, _style, isLast: true),
          ],
        ),
      ),
      PdfPageKit.box(
        'BILL TO',
        _style,
        pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.kv('Name', bill.customerName, _style),
            PdfPageKit.kv('Mobile', bill.customerPhone, _style),
            if (bill.customerGst.trim().isNotEmpty)
              PdfPageKit.kv('GST No.', bill.customerGst, _style),
            PdfPageKit.kv('Address', bill.customerFullAddress, _style),
          ],
        ),
      ),
      pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.boxHead('STORAGE', _style),
            PdfPageKit.gridRow(
              'Storage Receipt',
              bill.bookingNo.isEmpty ? 'Not linked' : bill.bookingNo,
              _style,
              bold: bill.bookingNo.isNotEmpty,
            ),
            PdfPageKit.gridRow(
              'Period From',
              bill.periodFrom.isEmpty ? '-' : PdfPageKit.date(bill.periodFrom),
              _style,
            ),
            PdfPageKit.gridRow(
              'Period To',
              bill.periodTo.isEmpty ? '-' : PdfPageKit.date(bill.periodTo),
              _style,
              isLast: true,
            ),
          ],
        ),
      ),
    ]);
  }

  pw.Widget _linesTable(BillModel bill) {
    final rows = <List<String>>[];
    for (var i = 0; i < bill.lines.length; i++) {
      final line = bill.lines[i];
      rows.add([
        '${i + 1}',
        line.chargeName,
        line.description,
        PdfPageKit.qty(line.quantity),
        line.rate.toStringAsFixed(2),
        line.amount.toStringAsFixed(2),
      ]);
    }

    return PdfPageKit.table(
      const ['Sr.', 'Charge', 'Details', 'Qty', 'Rate', 'Amount'],
      rows,
      _style,
      columnWidths: const {
        0: pw.FixedColumnWidth(22),
        1: pw.FlexColumnWidth(2),
        2: pw.FlexColumnWidth(3.4),
        3: pw.FixedColumnWidth(38),
        4: pw.FixedColumnWidth(52),
        5: pw.FixedColumnWidth(62),
      },
      aligns: const [
        pw.TextAlign.center,
        pw.TextAlign.left,
        pw.TextAlign.left,
        pw.TextAlign.right,
        pw.TextAlign.right,
        pw.TextAlign.right,
      ],
      totals: ['', 'Subtotal', '', '', '', bill.subtotal.toStringAsFixed(2)],
    );
  }

  pw.Widget _totalsRow(BillModel bill, double? previousBalance) {
    return PdfBoxRow.equal(gap: 4, [
      pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        padding: const pw.EdgeInsets.all(6),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Text(
              'Amount in words',
              style: pw.TextStyle(fontSize: 7.5, fontWeight: pw.FontWeight.bold, color: _style.primary),
            ),
            pw.SizedBox(height: 2),
            pw.Text(
              AmountInWords.convert(bill.grandTotal),
              style: pw.TextStyle(fontSize: 8.5, fontWeight: pw.FontWeight.bold),
            ),
            if (previousBalance != null && previousBalance.abs() > 0.004) ...[
              pw.SizedBox(height: 6),
              pw.Text(
                previousBalance > 0
                    ? 'Previous outstanding: ${PdfPageKit.money(previousBalance)}. '
                        'Total payable including this bill: '
                        '${PdfPageKit.money(previousBalance + bill.balanceDue)}.'
                    : 'Advance with us before this bill: '
                        '${PdfPageKit.money(-previousBalance)}.',
                style: const pw.TextStyle(fontSize: 7.5),
              ),
            ],
            if (bill.notes.trim().isNotEmpty) ...[
              pw.SizedBox(height: 6),
              pw.Text(bill.notes.trim(), style: const pw.TextStyle(fontSize: 7.5)),
            ],
          ],
        ),
      ),
      pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          children: [
            PdfPageKit.gridRow('Subtotal', PdfPageKit.money(bill.subtotal), _style),
            if (bill.discountValue > 0)
              PdfPageKit.gridRow('Discount', '- ${PdfPageKit.money(bill.discountValue)}', _style),
            if (bill.cgstAmount > 0) ...[
              PdfPageKit.gridRow('CGST (${(bill.gstPercent / 2).toStringAsFixed(2)}%)',
                  PdfPageKit.money(bill.cgstAmount), _style),
              PdfPageKit.gridRow('SGST (${(bill.gstPercent / 2).toStringAsFixed(2)}%)',
                  PdfPageKit.money(bill.sgstAmount), _style),
            ],
            if (bill.igstAmount > 0)
              PdfPageKit.gridRow('IGST (${bill.gstPercent.toStringAsFixed(2)}%)',
                  PdfPageKit.money(bill.igstAmount), _style),
            pw.Container(
              width: double.infinity,
              color: _style.primary,
              padding: const pw.EdgeInsets.symmetric(horizontal: 6, vertical: 5),
              child: pw.Row(
                mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                children: [
                  pw.Text('BILL TOTAL',
                      style: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold, color: _style.onPrimary)),
                  pw.Text(PdfPageKit.money(bill.grandTotal),
                      style: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold, color: _style.onPrimary)),
                ],
              ),
            ),
            if (bill.amountPaid > 0) ...[
              PdfPageKit.gridRow('Received', PdfPageKit.money(bill.amountPaid), _style),
              PdfPageKit.gridRow('Balance Due', PdfPageKit.money(bill.balanceDue), _style,
                  bold: true, isLast: true),
            ],
          ],
        ),
      ),
    ]);
  }
}
