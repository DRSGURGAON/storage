import 'dart:typed_data';

import 'package:pdf/widgets.dart' as pw;

import '../../../core/document_theme/document_theme.dart';
import '../../../core/document_theme/pdf_box_row.dart';
import '../../../core/document_theme/pdf_page_kit.dart';
import '../../company/models/company_model.dart';
import '../../storage_booking/models/storage_photo_model.dart';
import '../models/incident_model.dart';

/// The damage / loss report, with its photographs on the same paper.
///
/// It states what was seen and what was done, and nothing more: no
/// admission of liability and no promise of compensation, both of which
/// are for the operator and their insurer to settle later.
class IncidentPdfService {
  IncidentPdfService._();

  static final IncidentPdfService instance = IncidentPdfService._();

  DocumentThemeStyle _style = DocumentThemeStyle.of(DocumentTheme.classic);

  Future<Uint8List> build(
    IncidentModel incident,
    CompanyModel? company, {
    List<StoragePhotoModel> photos = const [],
    bool showWatermark = false,
    String watermarkText = '',
    double watermarkOpacity = 0.05,
  }) async {
    _style = DocumentThemeStyle.of(company?.documentTheme ?? DocumentTheme.classic);

    final document = pw.Document();
    final logo = await PdfPageKit.loadImage(company?.logoPath ?? '');
    final signature = await PdfPageKit.loadImage(company?.signaturePath ?? '');

    // Photographs are the point of this report, so they travel with it.
    // A photo the phone can no longer read is skipped rather than
    // taking the whole report down with it.
    final images = <({pw.ImageProvider image, String caption})>[];
    for (final photo in photos) {
      final bytes = await PdfPageKit.loadImage(photo.filePath);
      if (bytes == null) continue;
      try {
        images.add((image: pw.MemoryImage(bytes), caption: photo.caption));
      } catch (_) {
        continue;
      }
    }

    document.addPage(
      pw.MultiPage(
        pageTheme: PdfPageKit.pageTheme(
          style: _style,
          showWatermark: showWatermark,
          watermarkText: watermarkText,
          watermarkOpacity: watermarkOpacity,
        ),
        footer: (context) => PdfPageKit.footer(context, company,
            leftLabel: 'Damage / Loss Report'),
        build: (context) => [
          ...PdfPageKit.top(company, logo, _style, 'DAMAGE / LOSS REPORT'),
          _infoRow(incident),
          pw.SizedBox(height: 6),
          if (incident.goodsAffected.trim().isNotEmpty) ...[
            PdfPageKit.box(
              'GOODS AFFECTED',
              _style,
              pw.Text(incident.goodsAffected.trim(),
                  style: const pw.TextStyle(fontSize: 8)),
            ),
            pw.SizedBox(height: 6),
          ],
          PdfPageKit.box(
            'WHAT HAPPENED',
            _style,
            pw.Text(
              incident.whatHappened.trim().isEmpty
                  ? 'Not recorded.'
                  : incident.whatHappened.trim(),
              style: const pw.TextStyle(fontSize: 8, lineSpacing: 1.4),
            ),
          ),
          if (incident.actionTaken.trim().isNotEmpty) ...[
            pw.SizedBox(height: 6),
            PdfPageKit.box(
              'ACTION TAKEN',
              _style,
              pw.Text(incident.actionTaken.trim(),
                  style: const pw.TextStyle(fontSize: 8, lineSpacing: 1.4)),
            ),
          ],
          pw.SizedBox(height: 6),
          _statusBand(incident),
          if (images.isNotEmpty) ...[
            pw.SizedBox(height: 8),
            pw.Text('PHOTOGRAPHS',
                style: pw.TextStyle(
                  fontSize: 8.5,
                  fontWeight: pw.FontWeight.bold,
                  color: _style.primary,
                )),
            pw.SizedBox(height: 4),
            _photoGrid(images),
          ],
          pw.SizedBox(height: 8),
          _noAdmission(),
          pw.SizedBox(height: 16),
          PdfPageKit.signatures(
            company,
            signature,
            _style,
            otherParties: const ['Reported By (Signature)', 'Customer (if present)'],
          ),
        ],
      ),
    );

    return document.save();
  }

  pw.Widget _infoRow(IncidentModel i) {
    return PdfBoxRow.equal(gap: 4, [
      pw.Container(
        decoration: pw.BoxDecoration(
            border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.boxHead('REPORT', _style),
            PdfPageKit.gridRow('Report No.', i.reportNo, _style, bold: true),
            PdfPageKit.gridRow('Reported On', PdfPageKit.date(i.reportDate), _style,
                bold: true),
            PdfPageKit.gridRow(
              'Happened On',
              i.happenedOn.trim().isEmpty ? '-' : PdfPageKit.date(i.happenedOn),
              _style,
            ),
            PdfPageKit.gridRow('Type', i.kind.label, _style, isLast: true),
          ],
        ),
      ),
      PdfPageKit.box(
        'CUSTOMER',
        _style,
        pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.kv(
                'Name', i.customerName.isEmpty ? '-' : i.customerName, _style),
            if (i.customerPhone.trim().isNotEmpty)
              PdfPageKit.kv('Mobile', i.customerPhone, _style),
            PdfPageKit.kv('Storage Receipt',
                i.bookingNo.isEmpty ? 'Not linked' : i.bookingNo, _style),
            if (i.place.trim().isNotEmpty) PdfPageKit.kv('Place', i.place, _style),
          ],
        ),
      ),
    ]);
  }

  pw.Widget _statusBand(IncidentModel i) {
    final lines = <String>[
      if (i.estimatedLoss > 0.004)
        'Estimated loss: ${PdfPageKit.money(i.estimatedLoss)}',
      'Customer informed: ${i.customerInformed ? 'Yes' : 'Not yet'}',
      'Insurer informed: ${i.insurerInformed ? 'Yes' : 'Not yet'}',
      if (i.policeReference.trim().isNotEmpty)
        'Police / FIR reference: ${i.policeReference.trim()}',
      if (i.reportedBy.trim().isNotEmpty) 'Reported by: ${i.reportedBy.trim()}',
    ];

    return pw.Container(
      width: double.infinity,
      decoration: pw.BoxDecoration(
          border: pw.Border.all(color: PdfPageKit.black, width: 0.5)),
      padding: const pw.EdgeInsets.all(6),
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          for (final line in lines)
            pw.Text(line, style: const pw.TextStyle(fontSize: 8)),
        ],
      ),
    );
  }

  pw.Widget _photoGrid(List<({pw.ImageProvider image, String caption})> images) {
    return pw.Wrap(
      spacing: 6,
      runSpacing: 6,
      children: [
        for (final image in images)
          pw.Container(
            width: 168,
            decoration: pw.BoxDecoration(
                border: pw.Border.all(color: PdfPageKit.black, width: 0.5)),
            padding: const pw.EdgeInsets.all(3),
            child: pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.SizedBox(
                  height: 120,
                  width: double.infinity,
                  child: pw.Image(image.image, fit: pw.BoxFit.cover),
                ),
                if (image.caption.trim().isNotEmpty) ...[
                  pw.SizedBox(height: 2),
                  pw.Text(image.caption.trim(),
                      style: const pw.TextStyle(fontSize: 6.5)),
                ],
              ],
            ),
          ),
      ],
    );
  }

  pw.Widget _noAdmission() {
    return pw.Text(
      'This report records what was observed and what was done. It is not an '
      'admission of liability, and any claim will be dealt with as provided in '
      'the storage agreement and the insurance cover, if any.',
      style: const pw.TextStyle(fontSize: 6.5),
    );
  }
}
