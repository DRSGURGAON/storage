import 'dart:typed_data';

import 'package:pdf/widgets.dart' as pw;

import '../../../core/constants/default_terms.dart';
import '../../../core/constants/sac_codes.dart';
import '../../../core/document_terms/document_terms_repository.dart';
import '../../../core/document_theme/document_theme.dart';
import '../../../core/document_theme/pdf_box_row.dart';
import '../../../core/document_theme/pdf_page_kit.dart';
import '../../../core/utils/amount_in_words.dart';
import '../../company/models/company_model.dart';
import '../models/bill_model.dart';

/// The storage bill - what the customer owes for a period, and what is
/// still outstanding after whatever they have already paid.
///
/// When the company is registered under GST the same paper is its tax
/// invoice, and carries every particular Rule 46 of the CGST Rules,
/// 2017 asks for: the GSTINs, a serial number, the date, the SAC of
/// each service, the taxable value, the rate and amount of each tax,
/// the place of supply, whether tax is on reverse charge, and the
/// signature. A registered supplier with no tax on the bill issues a
/// bill of supply instead, and the title says which it is.
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
    final title = !hasGst
        ? 'STORAGE BILL'
        : bill.gstAmount > 0
            ? 'TAX INVOICE'
            : 'BILL OF SUPPLY';

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
          _infoRow(bill, company, hasGst),
          pw.SizedBox(height: 6),
          _linesTable(bill, hasGst),
          pw.SizedBox(height: 6),
          _totalsRow(bill, previousBalance),
          pw.SizedBox(height: 6),
          PdfPageKit.terms('Terms & Conditions :-', _termsText(bill, company), _style),
          pw.SizedBox(height: 6),
          _declaration(hasGst),
          pw.SizedBox(height: 6),
          PdfPageKit.bankDetails(
            company,
            _style,
            amount: bill.balanceDue,
            reference: 'Bill ${bill.billNo}',
          ),
          pw.SizedBox(height: 12),
          PdfPageKit.signatures(company, signature, _style, otherParties: const []),
        ],
      ),
    );

    return document.save();
  }

  String _termsText(BillModel bill, CompanyModel? company) {
    if (_customTerms.isNotEmpty) return _customTerms;
    final own = (company?.defaultTerms ?? '').trim();
    return own.isNotEmpty ? own : DefaultStorageTerms.billTerms.join('\n');
  }

  /// Where the service is supplied - the customer's state, with its GST
  /// state code when the customer's GSTIN gives one; else the godown's
  /// own state, because the goods sit there.
  String _placeOfSupply(BillModel bill, CompanyModel? company) {
    final state = bill.customerState.trim().isNotEmpty
        ? bill.customerState.trim()
        : (company?.state ?? '').trim();
    final code = SacCodes.stateCodeOf(bill.customerGst).isNotEmpty
        ? SacCodes.stateCodeOf(bill.customerGst)
        : SacCodes.stateCodeOf(company?.gstNumber ?? '');
    if (state.isEmpty) return '-';
    return code.isEmpty ? state : '$state ($code)';
  }

  pw.Widget _declaration(bool hasGst) {
    return pw.Text(
      hasGst
          ? 'Declaration: We declare that this invoice shows the actual price '
              'of the services described and that all particulars are true and '
              'correct. Original for Recipient. E. & O. E.'
          : 'Declaration: This bill shows the actual charges for the services '
              'described and all particulars are true and correct. E. & O. E.',
      style: const pw.TextStyle(fontSize: 6.5),
    );
  }

  pw.Widget _infoRow(BillModel bill, CompanyModel? company, bool hasGst) {
    return PdfBoxRow.equal(gap: 4, [
      pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.boxHead(hasGst ? 'INVOICE' : 'BILL', _style),
            PdfPageKit.gridRow(hasGst ? 'Invoice No.' : 'Bill No.', bill.billNo, _style, bold: true),
            PdfPageKit.gridRow(hasGst ? 'Invoice Date' : 'Bill Date',
                PdfPageKit.date(bill.billDate), _style, bold: true),
            PdfPageKit.gridRow(
              'Due Date',
              bill.dueDate.isEmpty ? 'On receipt' : PdfPageKit.date(bill.dueDate),
              _style,
            ),
            if (hasGst) ...[
              PdfPageKit.gridRow('Place of Supply', _placeOfSupply(bill, company), _style),
              PdfPageKit.gridRow('Reverse Charge', 'No', _style),
            ],
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
            PdfPageKit.kv(
              'GSTIN',
              bill.customerGst.trim().isEmpty ? 'Unregistered' : bill.customerGst,
              _style,
            ),
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

  pw.Widget _linesTable(BillModel bill, bool hasGst) {
    final rows = <List<String>>[];
    for (var i = 0; i < bill.lines.length; i++) {
      final line = bill.lines[i];
      rows.add([
        '${i + 1}',
        line.chargeName,
        line.description,
        if (hasGst) SacCodes.forCharge(line.chargeName),
        PdfPageKit.qty(line.quantity),
        line.rate.toStringAsFixed(2),
        line.amount.toStringAsFixed(2),
      ]);
    }

    return PdfPageKit.table(
      ['Sr.', 'Charge', 'Details', if (hasGst) 'SAC', 'Qty', 'Rate', 'Amount'],
      rows,
      _style,
      columnWidths: hasGst
          ? const {
              0: pw.FixedColumnWidth(22),
              1: pw.FlexColumnWidth(2),
              2: pw.FlexColumnWidth(3),
              3: pw.FixedColumnWidth(40),
              4: pw.FixedColumnWidth(34),
              5: pw.FixedColumnWidth(52),
              6: pw.FixedColumnWidth(62),
            }
          : const {
              0: pw.FixedColumnWidth(22),
              1: pw.FlexColumnWidth(2),
              2: pw.FlexColumnWidth(3.4),
              3: pw.FixedColumnWidth(38),
              4: pw.FixedColumnWidth(52),
              5: pw.FixedColumnWidth(62),
            },
      aligns: [
        pw.TextAlign.center,
        pw.TextAlign.left,
        pw.TextAlign.left,
        if (hasGst) pw.TextAlign.center,
        pw.TextAlign.right,
        pw.TextAlign.right,
        pw.TextAlign.right,
      ],
      totals: [
        '', 'Subtotal', '', if (hasGst) '', '', '',
        bill.subtotal.toStringAsFixed(2),
      ],
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
            if (bill.gstAmount > 0)
              PdfPageKit.gridRow('Taxable Value', PdfPageKit.money(bill.taxableBase), _style),
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
