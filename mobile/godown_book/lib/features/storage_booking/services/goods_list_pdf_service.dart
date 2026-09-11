import 'dart:typed_data';

import 'package:pdf/widgets.dart' as pw;

import '../../../core/document_theme/document_theme.dart';
import '../../../core/document_theme/pdf_box_row.dart';
import '../../../core/document_theme/pdf_page_kit.dart';
import '../../company/models/company_model.dart';
import '../models/storage_booking_model.dart';

/// The Goods List - every item a customer has with us: what came in,
/// what has gone out and what is still in the godown.
class GoodsListPdfService {
  GoodsListPdfService._();

  static final GoodsListPdfService instance = GoodsListPdfService._();

  DocumentThemeStyle _style = DocumentThemeStyle.of(DocumentTheme.classic);

  Future<Uint8List> build(
    StorageBookingModel booking,
    CompanyModel? company, {
    bool showWatermark = false,
    String watermarkText = '',
    double watermarkOpacity = 0.05,
  }) async {
    _style = DocumentThemeStyle.of(company?.documentTheme ?? DocumentTheme.classic);

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
        footer: (context) => PdfPageKit.footer(context, company, leftLabel: 'Goods List'),
        build: (context) => [
          ...PdfPageKit.top(company, logo, _style, 'GOODS LIST'),
          _referenceRow(booking),
          pw.SizedBox(height: 6),
          _itemsTable(booking),
          pw.SizedBox(height: 6),
          _summary(booking),
          if (booking.notes.trim().isNotEmpty) ...[
            pw.SizedBox(height: 6),
            PdfPageKit.box(
              'NOTES',
              _style,
              pw.Text(booking.notes.trim(), style: const pw.TextStyle(fontSize: 7.5)),
            ),
          ],
          pw.SizedBox(height: 14),
          PdfPageKit.signatures(
            company,
            signature,
            _style,
            otherParties: const ['Customer Signature', 'Checked By'],
          ),
        ],
      ),
    );

    return document.save();
  }

  pw.Widget _referenceRow(StorageBookingModel b) {
    return PdfBoxRow.equal(gap: 4, [
      pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.boxHead('AGAINST STORAGE RECEIPT', _style),
            PdfPageKit.gridRow('Receipt No.', b.bookingNo, _style, bold: true),
            PdfPageKit.gridRow('Entry Date', PdfPageKit.date(b.bookingDate), _style),
            PdfPageKit.gridRow('Storage From', PdfPageKit.date(b.storageStartDate), _style),
            PdfPageKit.gridRow('Location', b.locationName, _style),
            PdfPageKit.gridRow('Status', b.status.label, _style, bold: true, isLast: true),
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
            PdfPageKit.kv('Address', b.customerFullAddress, _style),
            PdfPageKit.kv('List Date', PdfPageKit.date(DateTime.now().toIso8601String()), _style),
          ],
        ),
      ),
    ]);
  }

  pw.Widget _itemsTable(StorageBookingModel b) {
    if (b.items.isEmpty) {
      return PdfPageKit.box(
        'ITEMS',
        _style,
        pw.Text(
          b.goodsDescription.trim().isEmpty ? 'No items recorded.' : b.goodsDescription.trim(),
          style: const pw.TextStyle(fontSize: 7.5),
        ),
      );
    }

    final rows = <List<String>>[];
    for (var i = 0; i < b.items.length; i++) {
      final item = b.items[i];
      rows.add([
        '${i + 1}',
        item.itemName,
        item.description,
        item.unit,
        PdfPageKit.qty(item.quantity),
        PdfPageKit.qty(item.releasedQty),
        PdfPageKit.qty(item.remainingQty),
        [item.weight, item.marks, item.conditionNote].where((s) => s.trim().isNotEmpty).join(' / '),
      ]);
    }

    final released = b.items.fold(0.0, (sum, i) => sum + i.releasedQty);

    return PdfPageKit.table(
      const ['Sr.', 'Item', 'Description', 'Unit', 'Received', 'Given Out', 'With Us', 'Weight / Marks / Condition'],
      rows,
      _style,
      columnWidths: const {
        0: pw.FixedColumnWidth(22),
        1: pw.FlexColumnWidth(3),
        2: pw.FlexColumnWidth(2.6),
        3: pw.FixedColumnWidth(32),
        4: pw.FixedColumnWidth(42),
        5: pw.FixedColumnWidth(42),
        6: pw.FixedColumnWidth(42),
        7: pw.FlexColumnWidth(2.6),
      },
      aligns: const [
        pw.TextAlign.center,
        pw.TextAlign.left,
        pw.TextAlign.left,
        pw.TextAlign.center,
        pw.TextAlign.right,
        pw.TextAlign.right,
        pw.TextAlign.right,
        pw.TextAlign.left,
      ],
      totals: [
        '',
        'Total',
        '',
        '',
        PdfPageKit.qty(b.totalQuantity),
        PdfPageKit.qty(released),
        PdfPageKit.qty(b.remainingQuantity),
        '',
      ],
    );
  }

  pw.Widget _summary(StorageBookingModel b) {
    final remaining = b.remainingQuantity;
    final text = remaining <= 0 && b.items.isNotEmpty
        ? 'All goods on this receipt have been released.'
        : '${PdfPageKit.qty(remaining)} of ${PdfPageKit.qty(b.totalQuantity)} units are still in storage'
            '${b.locationName.trim().isEmpty ? '' : ' at ${b.locationName.trim()}'}.';

    return pw.Container(
      width: double.infinity,
      decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.5)),
      padding: const pw.EdgeInsets.all(6),
      child: pw.Text(
        text,
        style: pw.TextStyle(fontSize: 8, fontWeight: pw.FontWeight.bold, color: _style.primary),
      ),
    );
  }
}
