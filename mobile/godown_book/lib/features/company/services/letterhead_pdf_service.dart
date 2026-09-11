import 'dart:io';
import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../../../core/document_theme/document_header.dart';
import '../../../core/document_theme/document_theme.dart';
import '../../company/models/company_model.dart';

/// Builds a blank professional A4 letterhead from the Company Profile.
///
/// Unlike every other document in this app, a letterhead has no source
/// record at all - no Booking, Customer or Invoice. It is purely
/// the company's own branding rendered onto an otherwise empty page,
/// so the business can print it and write/type a letter on it. That is
/// why this service takes only a CompanyModel and why its screen needs
/// no picker step.
///
/// Visual language deliberately matches the rest of the document family
/// (navy header block, ISO band, bordered page frame, footer with
/// contact line) so a letterhead and a Warehouse Receipt printed by the same
/// company genuinely look like they came from the same business.
class LetterHeadPdfService {
  LetterHeadPdfService._();

  static final LetterHeadPdfService instance = LetterHeadPdfService._();

  // Set at the top of build() from the company's own chosen
  // DocumentTheme (the same 7-theme setting Company Settings
  // already exposes) - this is what makes this document's own
  // brand color genuinely follow the company's theme choice,
  // not just one document. Defaults to Classic so a stray read
  // before build() runs still gets a sane value.
  DocumentThemeStyle _style = DocumentThemeStyle.of(DocumentTheme.classic);

  PdfColor get _navy => _style.primary;
  static const PdfColor _teal = PdfColor.fromInt(0xFF00B5A6);
  PdfColor get _line => _style.line;

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

  Future<Uint8List> build(
    CompanyModel? company, {
    bool showWatermark = false,
    String watermarkText = '',
    // Trial-period default (Phase: pre-launch) - genuinely 5%
    // opacity, lowered from 15% per explicit instruction: "bilkul
    // kam kar do, halka dikhe" (make it genuinely much lighter,
    // barely visible) - the previous 15% was reported as too dark.
    // Raise this again once the app is genuinely out of trial and
    // launched.
    double watermarkOpacity = 0.05,
  }) async {
    _style = DocumentThemeStyle.of(company?.documentTheme ?? DocumentTheme.classic);

    final document = pw.Document();

    final logo = await _loadImage(company?.logoPath ?? '');

    document.addPage(
      pw.Page(
        pageTheme: pw.PageTheme(
          pageFormat: PdfPageFormat.a4,
          margin: const pw.EdgeInsets.fromLTRB(22, 18, 22, 24),
          buildBackground: (context) => pw.FullPage(
            ignoreMargins: true,
            child: pw.Stack(
              children: [
                pw.Positioned(
                  left: 10,
                  top: 10,
                  right: 10,
                  bottom: 10,
                  child: pw.Container(
                    decoration: pw.BoxDecoration(
                      border: pw.Border.all(color: _line, width: 0.8),
                    ),
                  ),
                ),
                if (showWatermark)
                  pw.Center(
                    child: pw.Watermark.text(
                      watermarkText.isEmpty
                          ? 'DEMO - UNLICENSED COPY'
                          : watermarkText,
                      style: pw.TextStyle(
                        fontSize: 40,
                        fontWeight: pw.FontWeight.bold,
                        color: PdfColor(
                          _navy.red,
                          _navy.green,
                          _navy.blue,
                          watermarkOpacity,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
        build: (context) => pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.stretch,
          children: [
            _header(company, logo),
            if ((company?.isoCertificate ?? '').isNotEmpty)
              _isoBand(company!.isoCertificate),
            pw.SizedBox(height: 4),
            pw.Container(height: 2, color: _navy),
            pw.SizedBox(height: 1.5),
            pw.Container(height: 1, color: _teal),

            // The body is deliberately empty - this is a letterhead,
            // meant to be written/typed on. Expanded pushes the footer
            // to the bottom of the page rather than leaving it floating
            // directly under the header.
            pw.Expanded(child: pw.SizedBox()),

            _footer(company),
          ],
        ),
      ),
    );

    return document.save();
  }

  /// Company letterhead - delegated to the shared
  /// DocumentHeader so every document in the app presents the
  /// company identically (see that class's own doc comment).
  pw.Widget _header(CompanyModel? company, Uint8List? logo) {
    return DocumentHeader.company(
      style: _style,
      companyName: company?.companyName,
      tagLine: company?.tagLine,
      address: company?.address,
      city: company?.city,
      state: company?.state,
      pincode: company?.pincode,
      gstNumber: company?.gstNumber,
      panNumber: company?.panNumber,
      mobile1: company?.mobile1,
      mobile2: company?.mobile2,
      tollFree: company?.tollFree,
      website: company?.website,
      email: company?.email,
      logo: logo,
    );
  }

  pw.Widget _isoBand(String isoCertificate) {
    return pw.Container(
      width: double.infinity,
      alignment: pw.Alignment.center,
      padding: const pw.EdgeInsets.symmetric(vertical: 3),
      margin: const pw.EdgeInsets.only(top: 6),
      color: _navy,
      child: pw.Text(
        'AN ISO CERTIFIED: $isoCertificate',
        style: pw.TextStyle(
          fontSize: 8,
          fontWeight: pw.FontWeight.bold,
          color: PdfColors.white,
        ),
      ),
    );
  }

  pw.Widget _footer(CompanyModel? company) {
    final contactBits = <String>[
      if ((company?.website ?? '').isNotEmpty) company!.website,
      if ((company?.email ?? '').isNotEmpty) company!.email,
    ];

    return pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.center,
      children: [
        pw.Container(height: 1, color: _teal),
        pw.SizedBox(height: 1.5),
        pw.Container(height: 2, color: _navy),
        pw.SizedBox(height: 5),
        if (contactBits.isNotEmpty)
          pw.Text(
            contactBits.join('     |     '),
            style: pw.TextStyle(
              fontSize: 8.5,
              fontWeight: pw.FontWeight.bold,
              color: _navy,
            ),
          ),
        if ((company?.branchName ?? '').isNotEmpty)
          pw.Padding(
            padding: const pw.EdgeInsets.only(top: 2),
            child: pw.Text(
              'Branch: ${company!.branchName}',
              style: const pw.TextStyle(fontSize: 7.5),
            ),
          ),
      ],
    );
  }
}
