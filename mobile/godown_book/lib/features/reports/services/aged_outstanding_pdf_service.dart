import 'dart:typed_data';

import 'package:pdf/widgets.dart' as pw;

import '../../../core/document_theme/document_theme.dart';
import '../../../core/document_theme/pdf_page_kit.dart';
import '../../company/models/company_model.dart';
import 'report_builder.dart';

/// The aged outstanding report - who owes what, and for how long. The
/// oldest debt is at the top, because that is who to call first.
class AgedOutstandingPdfService {
  AgedOutstandingPdfService._();

  static final AgedOutstandingPdfService instance = AgedOutstandingPdfService._();

  DocumentThemeStyle _style = DocumentThemeStyle.of(DocumentTheme.classic);

  Future<Uint8List> build(
    AgeingReport report,
    CompanyModel? company, {
    bool showWatermark = false,
    String watermarkText = '',
    double watermarkOpacity = 0.05,
  }) async {
    _style = DocumentThemeStyle.of(company?.documentTheme ?? DocumentTheme.classic);

    final document = pw.Document();
    final logo = await PdfPageKit.loadImage(company?.logoPath ?? '');

    document.addPage(
      pw.MultiPage(
        pageTheme: PdfPageKit.pageTheme(
          style: _style,
          showWatermark: showWatermark,
          watermarkText: watermarkText,
          watermarkOpacity: watermarkOpacity,
        ),
        footer: (context) =>
            PdfPageKit.footer(context, company, leftLabel: 'Aged Outstanding'),
        build: (context) => [
          ...PdfPageKit.top(company, logo, _style, 'AGED OUTSTANDING'),
          _summary(report),
          pw.SizedBox(height: 8),
          if (report.rows.isEmpty)
            pw.Padding(
              padding: const pw.EdgeInsets.all(12),
              child: pw.Text('Nothing is outstanding. Every bill is paid.',
                  style: const pw.TextStyle(fontSize: 9)),
            )
          else
            _table(report),
          pw.SizedBox(height: 8),
          pw.Text(
            'Age is counted from the due date on each bill, or from the bill '
            'date when no due date was set. Amounts are the balance still '
            'unpaid after receipts and credit notes.',
            style: const pw.TextStyle(fontSize: 6.5),
          ),
        ],
      ),
    );

    return document.save();
  }

  pw.Widget _summary(AgeingReport report) {
    return pw.Container(
      decoration: pw.BoxDecoration(
        border: pw.Border.all(color: PdfPageKit.black, width: 0.7),
      ),
      child: pw.Column(
        children: [
          PdfPageKit.gridRow('As On', PdfPageKit.date(report.asOn.toIso8601String()),
              _style, bold: true),
          PdfPageKit.gridRow('Customers With Dues', '${report.customers}', _style),
          for (final bucket in AgeBucket.values)
            PdfPageKit.gridRow(bucket.label, PdfPageKit.money(report.totalIn(bucket)), _style),
          PdfPageKit.gridRow('Total Outstanding', PdfPageKit.money(report.grandTotal), _style,
              bold: true, isLast: true),
        ],
      ),
    );
  }

  pw.Widget _table(AgeingReport report) {
    return PdfPageKit.table(
      const ['#', 'Customer', 'Mobile', 'Bills', '0-30', '31-60', '61-90', '90+', 'Total'],
      [
        for (var i = 0; i < report.rows.length; i++)
          [
            '${i + 1}',
            report.rows[i].customerName,
            report.rows[i].customerPhone,
            '${report.rows[i].bills}',
            for (final bucket in AgeBucket.values)
              report.rows[i].amountIn(bucket) > 0.004
                  ? PdfPageKit.money(report.rows[i].amountIn(bucket))
                  : '-',
            PdfPageKit.money(report.rows[i].total),
          ],
      ],
      _style,
      columnWidths: {
        0: const pw.FixedColumnWidth(16),
        1: const pw.FlexColumnWidth(2.2),
        2: const pw.FlexColumnWidth(1.3),
        3: const pw.FixedColumnWidth(26),
        4: const pw.FlexColumnWidth(1.2),
        5: const pw.FlexColumnWidth(1.2),
        6: const pw.FlexColumnWidth(1.2),
        7: const pw.FlexColumnWidth(1.2),
        8: const pw.FlexColumnWidth(1.3),
      },
      aligns: const [
        pw.TextAlign.left, pw.TextAlign.left, pw.TextAlign.left, pw.TextAlign.right,
        pw.TextAlign.right, pw.TextAlign.right, pw.TextAlign.right, pw.TextAlign.right,
        pw.TextAlign.right,
      ],
      totals: [
        '', 'Total', '', '',
        for (final bucket in AgeBucket.values) PdfPageKit.money(report.totalIn(bucket)),
        PdfPageKit.money(report.grandTotal),
      ],
    );
  }
}
