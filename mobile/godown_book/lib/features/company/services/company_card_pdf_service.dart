import 'dart:io';
import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../../../core/document_theme/document_theme.dart';
import '../models/company_model.dart';

/// Builds a professional Company Card PDF - a single-page business-card-
/// style summary of the company profile (Section: "Company Card"),
/// entirely from EXISTING CompanyModel data - no duplicate company
/// settings/data anywhere, CompanyModel remains the single source of
/// truth exactly as it already is for every other document PDF in this
/// project.
///
/// Deliberately its own, independent service (same reasoning as every
/// other PDF service here - see WarehouseReceiptPdfService's own doc comment on
/// why): a Company Card is visually and structurally unlike any
/// existing document (no document number, no customer, no charges - a
/// compact profile summary), so it does not reuse another service's
/// private layout methods.
class CompanyCardPdfService {
  CompanyCardPdfService._();

  static final CompanyCardPdfService instance = CompanyCardPdfService._();

  // Set at the top of build() from the company's own chosen
  // DocumentTheme (the same 7-theme setting Company Settings
  // already exposes) - this is what makes this document's own
  // brand color genuinely follow the company's theme choice,
  // not just one document. Defaults to Classic so a stray read
  // before build() runs still gets a sane value.
  DocumentThemeStyle _style = DocumentThemeStyle.of(DocumentTheme.classic);

  PdfColor get _navy => _style.primary;
  PdfColor get _line => _style.line;
  PdfColor get _softFill => _style.softFill;

  static Future<Uint8List?> _loadImage(String path) async {
    if (path.isEmpty) return null;

    try {
      final file = File(path);
      if (!await file.exists()) return null;

      return await file.readAsBytes();
    } catch (_) {
      return null;
    }
  }

  Future<Uint8List> build(CompanyModel? company) async {
    _style = DocumentThemeStyle.of(company?.documentTheme ?? DocumentTheme.classic);

    final document = pw.Document();

    final logo = await _loadImage(company?.logoPath ?? '');

    document.addPage(
      pw.Page(
        pageTheme: pw.PageTheme(
          pageFormat: PdfPageFormat.a5,
          margin: const pw.EdgeInsets.all(24),
        ),
        build: (context) => _buildCard(company, logo),
      ),
    );

    return document.save();
  }

  pw.Widget _buildCard(CompanyModel? company, Uint8List? logo) {
    final addressParts = <String>[
      if ((company?.address ?? '').isNotEmpty) company!.address,
      if ((company?.city ?? '').isNotEmpty) company!.city,
      if ((company?.state ?? '').isNotEmpty) company!.state,
      if ((company?.pincode ?? '').isNotEmpty) company!.pincode,
    ];

    final phones = <String>[
      if ((company?.mobile1 ?? '').isNotEmpty) company!.mobile1,
      if ((company?.mobile2 ?? '').isNotEmpty) company!.mobile2,
    ];

    return pw.Container(
      decoration: pw.BoxDecoration(
        border: pw.Border.all(color: _line, width: 1),
        borderRadius: const pw.BorderRadius.all(pw.Radius.circular(10)),
      ),
      padding: const pw.EdgeInsets.all(20),
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        mainAxisSize: pw.MainAxisSize.min,
        children: [
          pw.Row(
            crossAxisAlignment: pw.CrossAxisAlignment.center,
            children: [
              if (logo != null) ...[
                pw.Container(
                  width: 64,
                  height: 64,
                  alignment: pw.Alignment.center,
                  child: pw.Image(pw.MemoryImage(logo), fit: pw.BoxFit.contain),
                ),
                pw.SizedBox(width: 14),
              ],
              pw.Expanded(
                child: pw.Text(
                  (company?.companyName ?? '').toUpperCase(),
                  style: pw.TextStyle(
                    fontSize: 20,
                    fontWeight: pw.FontWeight.bold,
                    color: _navy,
                  ),
                ),
              ),
            ],
          ),

          pw.SizedBox(height: 16),
          pw.Container(width: double.infinity, height: 0.8, color: _line),
          pw.SizedBox(height: 16),

          if (addressParts.isNotEmpty)
            _cardRow('Address', addressParts.join(', ')),
          if (phones.isNotEmpty) _cardRow('Phone', phones.join(', ')),
          if ((company?.email ?? '').isNotEmpty)
            _cardRow('Email', company!.email),
          if ((company?.website ?? '').isNotEmpty)
            _cardRow('Website', company!.website),
          if ((company?.gstNumber ?? '').isNotEmpty)
            _cardRow('GSTIN', company!.gstNumber),
          if ((company?.authorizedSignatoryName ?? '').isNotEmpty)
            _cardRow('Authorized Person', company!.authorizedSignatoryName),
        ],
      ),
    );
  }

  pw.Widget _cardRow(String label, String value) {
    return pw.Padding(
      padding: const pw.EdgeInsets.only(bottom: 8),
      child: pw.Row(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.SizedBox(
            width: 90,
            child: pw.Text(
              label,
              style: pw.TextStyle(
                fontSize: 9,
                fontWeight: pw.FontWeight.bold,
                color: PdfColors.grey700,
              ),
            ),
          ),
          pw.Expanded(
            child: pw.Container(
              decoration: pw.BoxDecoration(color: _softFill),
              padding: const pw.EdgeInsets.symmetric(horizontal: 6, vertical: 3),
              child: pw.Text(value, style: const pw.TextStyle(fontSize: 9.5)),
            ),
          ),
        ],
      ),
    );
  }
}
