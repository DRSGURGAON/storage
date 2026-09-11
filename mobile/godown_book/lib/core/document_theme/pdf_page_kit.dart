import 'dart:io';
import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../../features/company/models/company_model.dart';
import 'document_header.dart';
import 'document_theme.dart';

/// The pieces every generated document shares - page frame with the
/// demo watermark, company letterhead, bordered section boxes, the
/// footer, bank details with a UPI QR and the signature band - so each
/// document service only lays out what is specific to it, and every
/// document in the app looks like it came from the same office.
class PdfPageKit {
  PdfPageKit._();

  static const PdfColor black = PdfColors.black;
  static const PdfColor green = PdfColor.fromInt(0xFF0F7A3D);

  static Future<Uint8List?> loadImage(String path) async {
    if (path.isEmpty) return null;
    try {
      final file = File(path);
      if (!await file.exists()) return null;
      return await file.readAsBytes();
    } catch (_) {
      return null;
    }
  }

  /// A4 page with a thin full-page frame and, for unsubscribed
  /// copies, the diagonal demo watermark.
  static pw.PageTheme pageTheme({
    required DocumentThemeStyle style,
    bool showWatermark = false,
    String watermarkText = '',
    double watermarkOpacity = 0.05,
  }) {
    final primary = style.primary;
    return pw.PageTheme(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.fromLTRB(22, 18, 22, 26),
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
                  border: pw.Border.all(color: black, width: 0.8),
                ),
              ),
            ),
            if (showWatermark)
              pw.Center(
                child: pw.Watermark.text(
                  watermarkText.isEmpty ? 'DEMO - UNLICENSED COPY' : watermarkText,
                  style: pw.TextStyle(
                    fontSize: 40,
                    fontWeight: pw.FontWeight.bold,
                    color: PdfColor(
                      primary.red,
                      primary.green,
                      primary.blue,
                      watermarkOpacity,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  static pw.Widget header(
    CompanyModel? company,
    Uint8List? logo,
    DocumentThemeStyle style,
  ) {
    return DocumentHeader.company(
      style: style,
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

  /// Letterhead, optional ISO band and the title band - the top of
  /// every document.
  static List<pw.Widget> top(
    CompanyModel? company,
    Uint8List? logo,
    DocumentThemeStyle style,
    String title,
  ) {
    return [
      header(company, logo, style),
      pw.SizedBox(height: 4),
      if ((company?.isoCertificate ?? '').isNotEmpty)
        DocumentHeader.isoBand(company!.isoCertificate, style),
      DocumentHeader.titleBand(title, style),
      pw.SizedBox(height: 6),
    ];
  }

  /// A bordered box with a filled heading strip.
  static pw.Widget box(
    String heading,
    DocumentThemeStyle style,
    pw.Widget child, {
    pw.EdgeInsets padding = const pw.EdgeInsets.all(6),
  }) {
    return pw.Container(
      decoration: pw.BoxDecoration(border: pw.Border.all(color: black, width: 0.7)),
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          boxHead(heading, style),
          pw.Padding(padding: padding, child: child),
        ],
      ),
    );
  }

  static pw.Widget boxHead(String text, DocumentThemeStyle style) {
    return pw.Container(
      width: double.infinity,
      alignment: pw.Alignment.center,
      padding: const pw.EdgeInsets.symmetric(vertical: 4),
      decoration: pw.BoxDecoration(
        color: style.primary,
        border: pw.Border(bottom: pw.BorderSide(color: black, width: 0.7)),
      ),
      child: pw.Text(
        text,
        style: pw.TextStyle(
          fontSize: 8,
          fontWeight: pw.FontWeight.bold,
          color: style.onPrimary,
        ),
      ),
    );
  }

  /// "Key: Value" line inside a box.
  static pw.Widget kv(String key, String value, DocumentThemeStyle style) {
    return pw.Padding(
      padding: const pw.EdgeInsets.only(bottom: 1.5),
      child: pw.RichText(
        text: pw.TextSpan(
          style: const pw.TextStyle(fontSize: 7.5),
          children: [
            pw.TextSpan(
              text: '$key: ',
              style: pw.TextStyle(fontWeight: pw.FontWeight.bold, color: style.primary),
            ),
            pw.TextSpan(
              text: value.trim().isEmpty ? '-' : value.trim(),
              style: pw.TextStyle(fontWeight: pw.FontWeight.bold),
            ),
          ],
        ),
      ),
    );
  }

  /// Label on the left, value on the right, one thin rule under each.
  static pw.Widget gridRow(
    String label,
    String value,
    DocumentThemeStyle style, {
    bool bold = false,
    bool isLast = false,
  }) {
    return pw.Container(
      padding: const pw.EdgeInsets.symmetric(horizontal: 6, vertical: 4),
      decoration: pw.BoxDecoration(
        border: isLast ? null : pw.Border(bottom: pw.BorderSide(color: black, width: 0.4)),
      ),
      child: pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.Text(label, style: pw.TextStyle(fontSize: 7.5, fontWeight: pw.FontWeight.bold)),
          pw.SizedBox(width: 6),
          pw.Flexible(
            child: pw.Text(
              value.trim().isEmpty ? '-' : value.trim(),
              textAlign: pw.TextAlign.right,
              style: pw.TextStyle(
                fontSize: 7.5,
                fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal,
                color: bold ? style.primary : black,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// A plain data table with a filled header row.
  static pw.Widget table(
    List<String> headers,
    List<List<String>> rows,
    DocumentThemeStyle style, {
    Map<int, pw.TableColumnWidth>? columnWidths,
    List<pw.TextAlign>? aligns,
    List<String>? totals,
  }) {
    pw.Widget cell(String text, {bool head = false, bool bold = false, pw.TextAlign align = pw.TextAlign.left}) {
      return pw.Padding(
        padding: const pw.EdgeInsets.symmetric(horizontal: 4, vertical: 3),
        child: pw.Text(
          text,
          textAlign: align,
          style: pw.TextStyle(
            fontSize: 7.5,
            fontWeight: head || bold ? pw.FontWeight.bold : pw.FontWeight.normal,
            color: head ? style.onPrimary : black,
          ),
        ),
      );
    }

    pw.TextAlign alignOf(int i) =>
        aligns != null && i < aligns.length ? aligns[i] : pw.TextAlign.left;

    return pw.Table(
      border: pw.TableBorder.all(color: black, width: 0.5),
      columnWidths: columnWidths,
      children: [
        pw.TableRow(
          decoration: pw.BoxDecoration(color: style.primary),
          children: [
            for (var i = 0; i < headers.length; i++)
              cell(headers[i], head: true, align: alignOf(i)),
          ],
        ),
        for (final row in rows)
          pw.TableRow(
            children: [
              for (var i = 0; i < row.length; i++) cell(row[i], align: alignOf(i)),
            ],
          ),
        if (totals != null)
          pw.TableRow(
            decoration: pw.BoxDecoration(color: style.softFill),
            children: [
              for (var i = 0; i < totals.length; i++)
                cell(totals[i], bold: true, align: alignOf(i)),
            ],
          ),
      ],
    );
  }

  /// Numbered terms block. Renders nothing when [terms] is empty.
  static pw.Widget terms(String heading, String terms, DocumentThemeStyle style) {
    final lines = terms
        .split('\n')
        .map((l) => l.trim().replaceFirst(RegExp(r'^\d+[.)]\s*'), ''))
        .where((l) => l.isNotEmpty)
        .toList();
    if (lines.isEmpty) return pw.SizedBox.shrink();

    return pw.Container(
      width: double.infinity,
      decoration: pw.BoxDecoration(border: pw.Border.all(color: black, width: 0.5)),
      padding: const pw.EdgeInsets.all(6),
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.Text(
            heading,
            style: pw.TextStyle(
              fontSize: 7.5,
              fontWeight: pw.FontWeight.bold,
              decoration: pw.TextDecoration.underline,
            ),
          ),
          pw.SizedBox(height: 2),
          for (var i = 0; i < lines.length; i++)
            pw.Padding(
              padding: const pw.EdgeInsets.only(bottom: 1.5),
              child: pw.Row(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  pw.SizedBox(
                    width: 14,
                    child: pw.Text('${i + 1}.', style: const pw.TextStyle(fontSize: 7.5)),
                  ),
                  pw.Expanded(
                    child: pw.Text(lines[i], style: const pw.TextStyle(fontSize: 7.5)),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  /// Bank/UPI details with a scannable UPI QR. Renders nothing when the
  /// company has configured neither.
  static pw.Widget bankDetails(CompanyModel? company, DocumentThemeStyle style) {
    if (company == null) return pw.SizedBox.shrink();

    final lines = <String>[
      if (company.beneficiaryName.isNotEmpty) 'Beneficiary Name: ${company.beneficiaryName}',
      if (company.bankName.isNotEmpty) 'Bank Name: ${company.bankName}',
      if (company.accountNumber.isNotEmpty) 'Bank A/C No.: ${company.accountNumber}',
      if (company.ifscCode.isNotEmpty) 'IFSC Code: ${company.ifscCode}',
      if (company.upiId1.isNotEmpty) 'UPI 1: ${company.upiId1}',
      if (company.upiId2.isNotEmpty) 'UPI 2: ${company.upiId2}',
      if (company.googlePayNumber.isNotEmpty) 'Google Pay: ${company.googlePayNumber}',
      if (company.phonePeNumber.isNotEmpty) 'PhonePe: ${company.phonePeNumber}',
    ];

    final payee = company.upiId1.isNotEmpty
        ? company.upiId1
        : (company.googlePayNumber.isNotEmpty ? company.googlePayNumber : null);
    final upiLink = payee == null
        ? null
        : 'upi://pay?pa=$payee&pn=${Uri.encodeComponent(company.companyName.isEmpty ? 'Payment' : company.companyName)}&cu=INR';

    if (lines.isEmpty && upiLink == null) return pw.SizedBox.shrink();

    final textColumn = pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Text(
          'Bank / Payment Details',
          style: pw.TextStyle(fontSize: 8, fontWeight: pw.FontWeight.bold, color: style.primary),
        ),
        pw.SizedBox(height: 3),
        for (final line in lines)
          pw.Padding(
            padding: const pw.EdgeInsets.only(bottom: 1.5),
            child: pw.Text(line, style: const pw.TextStyle(fontSize: 7.5)),
          ),
      ],
    );

    return pw.Container(
      decoration: pw.BoxDecoration(border: pw.Border.all(color: black, width: 0.5)),
      padding: const pw.EdgeInsets.all(6),
      child: upiLink == null
          ? textColumn
          : pw.Row(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Expanded(child: textColumn),
                pw.SizedBox(width: 6),
                pw.Column(
                  children: [
                    pw.BarcodeWidget(
                      data: upiLink,
                      barcode: pw.Barcode.qrCode(),
                      width: 46,
                      height: 46,
                      drawText: false,
                    ),
                    pw.SizedBox(height: 2),
                    pw.Text('Scan to Pay', style: const pw.TextStyle(fontSize: 6)),
                  ],
                ),
              ],
            ),
    );
  }

  /// Signature band: any number of plain lines on the left, the
  /// company's authorized signatory (with the saved signature image)
  /// on the right.
  static pw.Widget signatures(
    CompanyModel? company,
    Uint8List? signature,
    DocumentThemeStyle style, {
    required List<String> otherParties,
  }) {
    pw.Widget line(String label) => pw.Expanded(
          child: pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.SizedBox(height: 40),
              pw.Container(width: double.infinity, height: 0.6, color: black),
              pw.SizedBox(height: 3),
              pw.Text(label, style: pw.TextStyle(fontSize: 7.5, fontWeight: pw.FontWeight.bold)),
            ],
          ),
        );

    return pw.Row(
      crossAxisAlignment: pw.CrossAxisAlignment.end,
      children: [
        for (final party in otherParties) ...[
          line(party),
          pw.SizedBox(width: 14),
        ],
        pw.Expanded(
          child: pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Text(
                'For ${(company?.companyName ?? '').toUpperCase()}',
                style: pw.TextStyle(fontSize: 8, color: style.primary, fontWeight: pw.FontWeight.bold),
              ),
              pw.SizedBox(height: 2),
              if (signature != null)
                pw.Container(
                  height: 36,
                  alignment: pw.Alignment.centerLeft,
                  child: pw.Image(pw.MemoryImage(signature), fit: pw.BoxFit.contain),
                )
              else
                pw.SizedBox(height: 36),
              pw.Container(width: double.infinity, height: 0.6, color: black),
              pw.SizedBox(height: 3),
              pw.Text(
                (company?.authorizedSignatoryName ?? '').trim().isEmpty
                    ? 'Authorized Signatory'
                    : '${company!.authorizedSignatoryName.trim()}  (Authorized Signatory)',
                style: pw.TextStyle(fontSize: 7.5, fontWeight: pw.FontWeight.bold, color: style.primary),
              ),
            ],
          ),
        ),
      ],
    );
  }

  static pw.Widget footer(pw.Context context, CompanyModel? company, {String leftLabel = ''}) {
    return pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.center,
      children: [
        pw.Divider(height: 1, color: black, thickness: 0.4),
        pw.SizedBox(height: 3),
        pw.RichText(
          textAlign: pw.TextAlign.center,
          text: pw.TextSpan(
            style: const pw.TextStyle(fontSize: 6.5),
            children: [
              const pw.TextSpan(
                text: 'This is a computer-generated document.  ',
                style: pw.TextStyle(color: PdfColors.grey700),
              ),
              pw.TextSpan(
                text: (company?.footerText.trim().isNotEmpty ?? false)
                    ? company!.footerText.trim()
                    : 'SAVE PAPER - SAVE TREES | BE DIGITAL - GO GREEN',
                style: pw.TextStyle(color: green, fontWeight: pw.FontWeight.bold),
              ),
            ],
          ),
        ),
        if ((company?.footerText2.trim().isNotEmpty ?? false))
          pw.Text(
            company!.footerText2.trim(),
            textAlign: pw.TextAlign.center,
            style: pw.TextStyle(fontSize: 6.5, color: green, fontWeight: pw.FontWeight.bold),
          ),
        pw.SizedBox(height: 2),
        pw.Row(
          mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
          children: [
            pw.Text(leftLabel, style: const pw.TextStyle(fontSize: 6.5, color: PdfColors.grey600)),
            if ((company?.mobile1 ?? '').isNotEmpty)
              pw.Text(
                'For any query contact: ${company!.mobile1}',
                style: pw.TextStyle(fontSize: 7, fontWeight: pw.FontWeight.bold),
              ),
            pw.Text(
              'Page ${context.pageNumber} of ${context.pagesCount}',
              style: const pw.TextStyle(fontSize: 7, color: PdfColors.grey700),
            ),
          ],
        ),
      ],
    );
  }

  static String date(String isoDate) {
    final parsed = DateTime.tryParse(isoDate);
    if (parsed == null) return '-';
    return '${parsed.day.toString().padLeft(2, '0')}-'
        '${parsed.month.toString().padLeft(2, '0')}-${parsed.year}';
  }

  static String money(double amount) => 'Rs. ${amount.toStringAsFixed(2)}';

  static String qty(double value) =>
      value == value.roundToDouble() ? value.toStringAsFixed(0) : value.toStringAsFixed(2);
}
