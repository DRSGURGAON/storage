import 'dart:typed_data';

import 'package:pdf/widgets.dart' as pw;

import '../../../core/document_terms/document_terms_repository.dart';
import '../../../core/document_theme/document_theme.dart';
import '../../../core/document_theme/pdf_box_row.dart';
import '../../../core/document_theme/pdf_page_kit.dart';
import '../../company/models/company_model.dart';
import '../models/goods_release_model.dart';

/// The release record - what went out, who took it and in which
/// vehicle. Printed as two copies: one for the customer and one the
/// gate keeps.
class ReleasePdfService {
  ReleasePdfService._();

  static final ReleasePdfService instance = ReleasePdfService._();

  static const List<String> copyLabels = ['CUSTOMER COPY', 'GATE COPY'];

  DocumentThemeStyle _style = DocumentThemeStyle.of(DocumentTheme.classic);
  String _customTerms = '';

  Future<Uint8List> build(
    GoodsReleaseModel release,
    CompanyModel? company, {
    bool showWatermark = false,
    String watermarkText = '',
    double watermarkOpacity = 0.05,

    /// The signature the customer gave from their own phone, and the
    /// note printed under it.
    Uint8List? customerSignature,
    String customerSignatureNote = '',
    List<String>? copies,
  }) async {
    _style = DocumentThemeStyle.of(company?.documentTheme ?? DocumentTheme.classic);
    _customTerms = await DocumentTermsRepository.instance
        .getTerms(DocumentTermsType.releaseRecord);

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
          footer: (context) =>
              PdfPageKit.footer(context, company, leftLabel: copyLabel),
          build: (context) => [
            ...PdfPageKit.top(
                company, logo, _style, 'GOODS RELEASE RECORD  -  $copyLabel'),
            _infoRow(release),
            pw.SizedBox(height: 6),
            _itemsTable(release),
            pw.SizedBox(height: 6),
            _duesBand(release),
            if (release.remarks.trim().isNotEmpty) ...[
              pw.SizedBox(height: 6),
              PdfPageKit.box(
                'REMARKS',
                _style,
                pw.Text(release.remarks.trim(), style: const pw.TextStyle(fontSize: 7.5)),
              ),
            ],
            if (_customTerms.isNotEmpty) ...[
              pw.SizedBox(height: 6),
              PdfPageKit.terms('Terms :-', _customTerms, _style),
            ],
            pw.SizedBox(height: 8),
            _acknowledgement(),
            pw.SizedBox(height: 16),
            PdfPageKit.signatures(
              company,
              signature,
              _style,
              otherParties: const ['Collected By (Signature)', 'Gate / Security'],
              partySignature: customerSignature,
              partyNote: customerSignatureNote,
            ),
          ],
        ),
      );
    }

    return document.save();
  }

  pw.Widget _infoRow(GoodsReleaseModel r) {
    return PdfBoxRow.equal(gap: 4, [
      pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.boxHead('RELEASE', _style),
            PdfPageKit.gridRow('Release No.', r.releaseNo, _style, bold: true),
            PdfPageKit.gridRow('Date', PdfPageKit.date(r.releaseDate), _style, bold: true),
            PdfPageKit.gridRow('Against Receipt', r.bookingNo, _style),
            PdfPageKit.gridRow('Going Out', r.releaseType.label, _style, isLast: true),
          ],
        ),
      ),
      PdfPageKit.box(
        'CUSTOMER',
        _style,
        pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.kv('Name', r.customerName, _style),
            PdfPageKit.kv('Mobile', r.customerPhone, _style),
            PdfPageKit.kv('Collected By', r.collectedByName, _style),
            PdfPageKit.kv('Collector Mobile', r.collectedByPhone, _style),
            PdfPageKit.kv('ID Shown', r.collectedByIdProof, _style),
          ],
        ),
      ),
      pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.boxHead('TAKEN AWAY IN', _style),
            PdfPageKit.gridRow('Vehicle No.', r.vehicleNumber, _style),
            PdfPageKit.gridRow('Driver', r.driverName, _style),
            PdfPageKit.gridRow('Gate Out Time', r.gateOutTime, _style),
            PdfPageKit.gridRow(
              'Total Going Out',
              PdfPageKit.qty(r.totalQuantity),
              _style,
              bold: true,
              isLast: true,
            ),
          ],
        ),
      ),
    ]);
  }

  pw.Widget _itemsTable(GoodsReleaseModel r) {
    final rows = <List<String>>[];
    for (var i = 0; i < r.items.length; i++) {
      final item = r.items[i];
      rows.add([
        '${i + 1}',
        item.itemName,
        PdfPageKit.qty(item.quantity),
        item.unit,
      ]);
    }

    return PdfPageKit.table(
      const ['Sr.', 'Item', 'Qty', 'Unit'],
      rows,
      _style,
      columnWidths: const {
        0: pw.FixedColumnWidth(22),
        1: pw.FlexColumnWidth(6),
        2: pw.FixedColumnWidth(50),
        3: pw.FixedColumnWidth(50),
      },
      aligns: const [
        pw.TextAlign.center,
        pw.TextAlign.left,
        pw.TextAlign.right,
        pw.TextAlign.center,
      ],
      totals: ['', 'Total', PdfPageKit.qty(r.totalQuantity), ''],
    );
  }

  pw.Widget _duesBand(GoodsReleaseModel r) {
    final owed = r.outstandingAtRelease > 0.004;
    return pw.Container(
      width: double.infinity,
      decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.5)),
      padding: const pw.EdgeInsets.all(6),
      child: pw.Text(
        owed
            ? 'Outstanding at the time of release: '
                '${PdfPageKit.money(r.outstandingAtRelease)}'
            : 'No dues outstanding at the time of release.',
        style: pw.TextStyle(
          fontSize: 8.5,
          fontWeight: pw.FontWeight.bold,
          color: _style.primary,
        ),
      ),
    );
  }

  pw.Widget _acknowledgement() {
    return pw.Text(
      'I ACKNOWLEDGE RECEIPT OF THE GOODS LISTED ABOVE IN GOOD ORDER AND CONDITION, '
      'AND CONFIRM THAT I AM AUTHORISED BY THE CUSTOMER TO COLLECT THEM.',
      style: pw.TextStyle(fontSize: 7, fontWeight: pw.FontWeight.bold),
    );
  }
}
