import 'dart:typed_data';

import 'package:pdf/widgets.dart' as pw;

import '../../../core/constants/default_terms.dart';
import '../../../core/document_terms/document_terms_repository.dart';
import '../../../core/document_theme/document_theme.dart';
import '../../../core/document_theme/pdf_box_row.dart';
import '../../../core/document_theme/pdf_page_kit.dart';
import '../../../core/utils/amount_in_words.dart';
import '../../company/models/company_model.dart';
import '../../master/models/charge_head_model.dart';
import '../models/quotation_model.dart';

/// The quotation the operator sends before the goods move - services,
/// storage and the price, on the company's own letterhead.
class QuotationPdfService {
  QuotationPdfService._();

  static final QuotationPdfService instance = QuotationPdfService._();

  DocumentThemeStyle _style = DocumentThemeStyle.of(DocumentTheme.classic);
  String _customTerms = '';

  Future<Uint8List> build(
    QuotationModel quotation,
    CompanyModel? company, {
    bool showWatermark = false,
    String watermarkText = '',
    double watermarkOpacity = 0.05,
  }) async {
    _style = DocumentThemeStyle.of(company?.documentTheme ?? DocumentTheme.classic);
    _customTerms =
        await DocumentTermsRepository.instance.getTerms(DocumentTermsType.quotation);

    final document = pw.Document();
    final logo = await PdfPageKit.loadImage(company?.logoPath ?? '');
    final signature = await PdfPageKit.loadImage(company?.signaturePath ?? '');

    document.addPage(
      pw.MultiPage(
        pageTheme: PdfPageKit.pageTheme(
          style: _style,
          showWatermark: showWatermark,
          watermarkText: watermarkText,
          watermarkOpacity: watermarkOpacity,
        ),
        footer: (context) => PdfPageKit.footer(context, company, leftLabel: 'Quotation'),
        build: (context) => [
          ...PdfPageKit.top(company, logo, _style, 'QUOTATION'),
          _infoRow(quotation),
          pw.SizedBox(height: 6),
          if (quotation.goodsDescription.trim().isNotEmpty) ...[
            PdfPageKit.box(
              'GOODS',
              _style,
              pw.Text(quotation.goodsDescription.trim(), style: const pw.TextStyle(fontSize: 7.5)),
            ),
            pw.SizedBox(height: 6),
          ],
          _linesTable(quotation),
          pw.SizedBox(height: 6),
          _totalsRow(quotation),
          pw.SizedBox(height: 6),
          _termsBlock(quotation, company),
          pw.SizedBox(height: 8),
          PdfPageKit.bankDetails(company, _style),
          pw.SizedBox(height: 12),
          PdfPageKit.signatures(
            company,
            signature,
            _style,
            otherParties: const ['Customer Acceptance'],
          ),
        ],
      ),
    );

    return document.save();
  }

  pw.Widget _infoRow(QuotationModel q) {
    final hasMove = q.fromCity.trim().isNotEmpty || q.toCity.trim().isNotEmpty;

    return PdfBoxRow.equal(gap: 4, [
      pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.boxHead('QUOTATION', _style),
            PdfPageKit.gridRow('Quotation No.', q.quotationNo, _style, bold: true),
            PdfPageKit.gridRow('Date', PdfPageKit.date(q.quotationDate), _style, bold: true),
            PdfPageKit.gridRow(
              'Valid Upto',
              q.validUpto.isEmpty ? 'As discussed' : PdfPageKit.date(q.validUpto),
              _style,
            ),
            PdfPageKit.gridRow('Status', q.status.label, _style, isLast: true),
          ],
        ),
      ),
      PdfPageKit.box(
        'CUSTOMER',
        _style,
        pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.kv('Name', q.customerName, _style),
            PdfPageKit.kv('Mobile', q.customerPhone, _style),
            if (q.customerGst.trim().isNotEmpty)
              PdfPageKit.kv('GST No.', q.customerGst, _style),
            PdfPageKit.kv('Address', q.customerFullAddress, _style),
          ],
        ),
      ),
      pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.boxHead(hasMove ? 'MOVE & STORAGE' : 'STORAGE', _style),
            if (hasMove) ...[
              PdfPageKit.gridRow('From', q.fromCity, _style),
              PdfPageKit.gridRow('To', q.toCity, _style),
              PdfPageKit.gridRow(
                'Move Date',
                q.moveDate.isEmpty ? 'To be confirmed' : PdfPageKit.date(q.moveDate),
                _style,
              ),
            ],
            PdfPageKit.gridRow(
              'Storage',
              q.storageMonths > 0
                  ? '${PdfPageKit.qty(q.storageMonths)} month(s)'
                  : (q.storageNote.trim().isEmpty ? 'Not quoted' : 'As noted'),
              _style,
              bold: q.storageMonths > 0,
              isLast: q.storageNote.trim().isEmpty,
            ),
            if (q.storageNote.trim().isNotEmpty)
              PdfPageKit.gridRow('Note', q.storageNote.trim(), _style, isLast: true),
          ],
        ),
      ),
    ]);
  }

  pw.Widget _linesTable(QuotationModel q) {
    final rows = <List<String>>[];
    for (var i = 0; i < q.lines.length; i++) {
      final line = q.lines[i];
      rows.add([
        '${i + 1}',
        line.serviceName,
        line.description,
        line.mode == ChargeMode.amount ? PdfPageKit.qty(line.quantity) : '',
        line.mode == ChargeMode.amount ? line.rate.toStringAsFixed(2) : '',
        line.printedAmount,
      ]);
    }

    return PdfPageKit.table(
      const ['Sr.', 'Service', 'Details', 'Qty', 'Rate', 'Amount'],
      rows,
      _style,
      columnWidths: const {
        0: pw.FixedColumnWidth(22),
        1: pw.FlexColumnWidth(2.4),
        2: pw.FlexColumnWidth(3),
        3: pw.FixedColumnWidth(34),
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
      totals: ['', 'Subtotal', '', '', '', q.subtotal.toStringAsFixed(2)],
    );
  }

  pw.Widget _totalsRow(QuotationModel q) {
    return PdfBoxRow.equal(gap: 4, [
      pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        alignment: pw.Alignment.centerLeft,
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
              AmountInWords.convert(q.grandTotal),
              style: pw.TextStyle(fontSize: 8.5, fontWeight: pw.FontWeight.bold),
            ),
            if (q.notes.trim().isNotEmpty) ...[
              pw.SizedBox(height: 6),
              pw.Text(q.notes.trim(), style: const pw.TextStyle(fontSize: 7.5)),
            ],
          ],
        ),
      ),
      pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          children: [
            PdfPageKit.gridRow('Subtotal', PdfPageKit.money(q.subtotal), _style),
            if (q.discountValue > 0)
              PdfPageKit.gridRow('Discount', '- ${PdfPageKit.money(q.discountValue)}', _style),
            if (q.cgstAmount > 0) ...[
              PdfPageKit.gridRow('CGST (${(q.gstPercent / 2).toStringAsFixed(2)}%)',
                  PdfPageKit.money(q.cgstAmount), _style),
              PdfPageKit.gridRow('SGST (${(q.gstPercent / 2).toStringAsFixed(2)}%)',
                  PdfPageKit.money(q.sgstAmount), _style),
            ],
            if (q.igstAmount > 0)
              PdfPageKit.gridRow('IGST (${q.gstPercent.toStringAsFixed(2)}%)',
                  PdfPageKit.money(q.igstAmount), _style),
            pw.Container(
              width: double.infinity,
              color: _style.primary,
              padding: const pw.EdgeInsets.symmetric(horizontal: 6, vertical: 5),
              child: pw.Row(
                mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                children: [
                  pw.Text('TOTAL',
                      style: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold, color: _style.onPrimary)),
                  pw.Text(PdfPageKit.money(q.grandTotal),
                      style: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold, color: _style.onPrimary)),
                ],
              ),
            ),
          ],
        ),
      ),
    ]);
  }

  pw.Widget _termsBlock(QuotationModel q, CompanyModel? company) {
    final terms = q.terms.trim().isNotEmpty
        ? q.terms.trim()
        : _customTerms.isNotEmpty
            ? _customTerms
            : (company?.defaultTerms.trim().isNotEmpty ?? false)
                ? company!.defaultTerms.trim()
                : DefaultStorageTerms.quotationTerms.join('\n');
    return PdfPageKit.terms('Terms & Conditions :-', terms, _style);
  }
}
