import 'dart:typed_data';

import 'package:pdf/widgets.dart' as pw;

import '../../../core/document_theme/document_theme.dart';
import '../../../core/document_theme/pdf_page_kit.dart';
import '../../company/models/company_model.dart';
import 'report_builder.dart';

/// The rent roll - every storage record still open, where it sits, and
/// what it earns a month. The page an owner reads at month end.
class RentRollPdfService {
  RentRollPdfService._();

  static final RentRollPdfService instance = RentRollPdfService._();

  DocumentThemeStyle _style = DocumentThemeStyle.of(DocumentTheme.classic);

  Future<Uint8List> build(
    RentRoll roll,
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
            PdfPageKit.footer(context, company, leftLabel: 'Rent Roll'),
        build: (context) => [
          ...PdfPageKit.top(company, logo, _style, 'RENT ROLL'),
          _summary(roll),
          pw.SizedBox(height: 8),
          if (roll.rows.isEmpty)
            pw.Padding(
              padding: const pw.EdgeInsets.all(12),
              child: pw.Text('Nothing is in storage right now.',
                  style: const pw.TextStyle(fontSize: 9)),
            )
          else
            _table(roll),
          pw.SizedBox(height: 8),
          pw.Text(
            'Monthly rent is the agreed rate taken over a month: a daily rate '
            'over 30 days, a per-box rate over the boxes still inside. It is '
            'a running figure for the owner, not a bill.',
            style: const pw.TextStyle(fontSize: 6.5),
          ),
        ],
      ),
    );

    return document.save();
  }

  pw.Widget _summary(RentRoll roll) {
    return pw.Container(
      decoration: pw.BoxDecoration(
        border: pw.Border.all(color: PdfPageKit.black, width: 0.7),
      ),
      child: pw.Column(
        children: [
          PdfPageKit.gridRow('As On', PdfPageKit.date(roll.asOn.toIso8601String()),
              _style, bold: true),
          PdfPageKit.gridRow('Records In Storage', '${roll.count}', _style),
          PdfPageKit.gridRow('Packages / Items Inside', PdfPageKit.qty(roll.packagesLeft), _style),
          PdfPageKit.gridRow('Rent Per Month', PdfPageKit.money(roll.monthlyRent), _style,
              bold: true, isLast: true),
        ],
      ),
    );
  }

  pw.Widget _table(RentRoll roll) {
    return PdfPageKit.table(
      const ['#', 'Storage No.', 'Customer', 'Location', 'Since', 'Days', 'Rate', 'Left', 'Billed Upto', 'Per Month'],
      [
        for (var i = 0; i < roll.rows.length; i++)
          [
            '${i + 1}',
            roll.rows[i].bookingNo,
            roll.rows[i].customerName,
            roll.rows[i].locationName.isEmpty ? '-' : roll.rows[i].locationName,
            PdfPageKit.date(roll.rows[i].since),
            '${roll.rows[i].daysInside(roll.asOn)}',
            roll.rows[i].rate > 0
                ? '${PdfPageKit.qty(roll.rows[i].rate)} ${roll.rows[i].rateUnit}'
                : 'As agreed',
            PdfPageKit.qty(roll.rows[i].packagesLeft),
            roll.rows[i].billedUpto.isEmpty ? 'Not yet' : PdfPageKit.date(roll.rows[i].billedUpto),
            PdfPageKit.money(roll.rows[i].monthlyRent),
          ],
      ],
      _style,
      columnWidths: {
        0: const pw.FixedColumnWidth(16),
        1: const pw.FlexColumnWidth(1.3),
        2: const pw.FlexColumnWidth(2),
        3: const pw.FlexColumnWidth(1.3),
        4: const pw.FlexColumnWidth(1.2),
        5: const pw.FixedColumnWidth(26),
        6: const pw.FlexColumnWidth(1.4),
        7: const pw.FixedColumnWidth(28),
        8: const pw.FlexColumnWidth(1.2),
        9: const pw.FlexColumnWidth(1.3),
      },
      aligns: const [
        pw.TextAlign.left, pw.TextAlign.left, pw.TextAlign.left, pw.TextAlign.left,
        pw.TextAlign.left, pw.TextAlign.right, pw.TextAlign.left, pw.TextAlign.right,
        pw.TextAlign.left, pw.TextAlign.right,
      ],
      totals: [
        '', 'Total', '${roll.count} records', '', '', '', '',
        PdfPageKit.qty(roll.packagesLeft), '', PdfPageKit.money(roll.monthlyRent),
      ],
    );
  }
}
