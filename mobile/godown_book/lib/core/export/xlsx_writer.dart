import 'dart:convert';
import 'dart:typed_data';

import 'package:archive/archive.dart';

/// One worksheet: an optional title line, a header row, data rows and an
/// optional totals row. Cells may be String, num, DateTime or null.
class XlsxSheet {
  final String name;
  final String? title;
  final List<String> headers;
  final List<List<Object?>> rows;
  final List<Object?>? totals;

  /// Column widths in characters; missing ones default to 14.
  final List<double> widths;

  const XlsxSheet({
    required this.name,
    this.title,
    required this.headers,
    required this.rows,
    this.totals,
    this.widths = const [],
  });
}

/// Writes a real .xlsx workbook (Office Open XML) - opens in Excel,
/// Google Sheets and WPS with numbers as numbers and dates as dates, a
/// bold header row that stays on screen while scrolling, and a totals
/// row. Built on the zip support the app already ships with (archive),
/// so it adds no new dependency of its own.
class XlsxWriter {
  XlsxWriter._();

  static const mimeType =
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // Cell styles, indexes into styles.xml cellXfs.
  static const _sHeader = 1;
  static const _sNumber = 2;
  static const _sDate = 3;
  static const _sText = 4;
  static const _sTotalText = 5;
  static const _sTotalNumber = 6;
  static const _sTitle = 7;
  static const _sInteger = 8;
  static const _sTotalInteger = 9;

  static Uint8List build(List<XlsxSheet> sheets) {
    final archive = Archive();
    void add(String path, String content) {
      final bytes = utf8.encode(content);
      archive.addFile(ArchiveFile(path, bytes.length, bytes));
    }

    add('[Content_Types].xml', _contentTypes(sheets.length));
    add('_rels/.rels', _rootRels);
    add('xl/workbook.xml', _workbook(sheets));
    add('xl/_rels/workbook.xml.rels', _workbookRels(sheets.length));
    add('xl/styles.xml', _styles);
    for (var i = 0; i < sheets.length; i++) {
      add('xl/worksheets/sheet${i + 1}.xml', _sheet(sheets[i]));
    }
    return Uint8List.fromList(ZipEncoder().encode(archive));
  }

  static String _contentTypes(int n) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      '<Default Extension="xml" ContentType="application/xml"/>'
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      '${[
        for (var i = 1; i <= n; i++)
          '<Override PartName="/xl/worksheets/sheet$i.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      ].join()}'
      '</Types>';

  static const _rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      '</Relationships>';

  static String _workbook(List<XlsxSheet> sheets) {
    final used = <String>{};
    final names = <String>[];
    for (final s in sheets) {
      // Excel: max 31 chars, none of : \ / ? * [ ], unique.
      var name = s.name.replaceAll(RegExp(r'[:\\/?*\[\]]'), ' ').trim();
      if (name.isEmpty) name = 'Sheet';
      if (name.length > 31) name = name.substring(0, 31);
      var unique = name;
      for (var k = 2; used.contains(unique.toLowerCase()); k++) {
        final suffix = ' $k';
        unique = '${name.substring(0, name.length.clamp(0, 31 - suffix.length))}$suffix';
      }
      used.add(unique.toLowerCase());
      names.add(unique);
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets>${[
          for (var i = 0; i < names.length; i++)
            '<sheet name="${_esc(names[i])}" sheetId="${i + 1}" r:id="rId${i + 1}"/>'
        ].join()}</sheets></workbook>';
  }

  static String _workbookRels(int n) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      '${[
        for (var i = 1; i <= n; i++)
          '<Relationship Id="rId$i" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet$i.xml"/>'
      ].join()}'
      '<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      '</Relationships>';

  static const _styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      '<numFmts count="2">'
      '<numFmt numFmtId="164" formatCode="#,##0.00"/>'
      '<numFmt numFmtId="165" formatCode="dd-mm-yyyy"/>'
      '</numFmts>'
      '<fonts count="3">'
      '<font><sz val="11"/><name val="Calibri"/></font>'
      '<font><b/><sz val="11"/><name val="Calibri"/></font>'
      '<font><b/><sz val="14"/><name val="Calibri"/></font>'
      '</fonts>'
      '<fills count="3">'
      '<fill><patternFill patternType="none"/></fill>'
      '<fill><patternFill patternType="gray125"/></fill>'
      '<fill><patternFill patternType="solid"><fgColor rgb="FFE8ECF3"/><bgColor indexed="64"/></patternFill></fill>'
      '</fills>'
      '<borders count="2">'
      '<border><left/><right/><top/><bottom/><diagonal/></border>'
      '<border><left style="thin"><color rgb="FFC9D0DB"/></left><right style="thin"><color rgb="FFC9D0DB"/></right>'
      '<top style="thin"><color rgb="FFC9D0DB"/></top><bottom style="thin"><color rgb="FFC9D0DB"/></bottom><diagonal/></border>'
      '</borders>'
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      '<cellXfs count="10">'
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>'
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>'
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>'
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'
      '<xf numFmtId="164" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>'
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
      '<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>'
      '<xf numFmtId="1" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>'
      '</cellXfs>'
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      '</styleSheet>';

  static String _sheet(XlsxSheet s) {
    final buf = StringBuffer();
    var r = 0;

    void row(List<Object?> cells, {bool header = false, bool total = false}) {
      r++;
      buf.write('<row r="$r">');
      for (var c = 0; c < cells.length; c++) {
        final v = cells[c];
        if (v == null) continue;
        final ref = '${_col(c)}$r';
        if (v is num) {
          final style = v is int
              ? (total ? _sTotalInteger : _sInteger)
              : (total ? _sTotalNumber : _sNumber);
          buf.write('<c r="$ref" s="$style"><v>${_num(v)}</v></c>');
        } else if (v is DateTime) {
          buf.write('<c r="$ref" s="$_sDate"><v>${_serial(v)}</v></c>');
        } else {
          final style = header
              ? _sHeader
              : total
                  ? _sTotalText
                  : _sText;
          buf.write('<c r="$ref" s="$style" t="inlineStr"><is>'
              '<t xml:space="preserve">${_esc(v.toString())}</t></is></c>');
        }
      }
      buf.write('</row>');
    }

    final title = s.title?.trim() ?? '';
    if (title.isNotEmpty) {
      r++;
      buf.write('<row r="$r"><c r="A$r" s="$_sTitle" t="inlineStr"><is>'
          '<t xml:space="preserve">${_esc(title)}</t></is></c></row>');
      r++; // blank spacer row
    }
    row(s.headers, header: true);
    final headerRow = r;
    for (final data in s.rows) {
      row(data);
    }
    if (s.totals != null) row(s.totals!, total: true);

    final cols = StringBuffer('<cols>');
    for (var c = 0; c < s.headers.length; c++) {
      final w = c < s.widths.length ? s.widths[c] : 14.0;
      cols.write('<col min="${c + 1}" max="${c + 1}" width="$w" customWidth="1"/>');
    }
    cols.write('</cols>');

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheetViews><sheetView workbookViewId="0">'
        '<pane ySplit="$headerRow" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/>'
        '</sheetView></sheetViews>'
        '<sheetFormatPr defaultRowHeight="15"/>'
        '$cols<sheetData>$buf</sheetData></worksheet>';
  }

  /// 0 -> A, 25 -> Z, 26 -> AA.
  static String _col(int index) {
    var n = index + 1;
    var s = '';
    while (n > 0) {
      final m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = (n - 1) ~/ 26;
    }
    return s;
  }

  static String _num(num v) {
    if (v is int) return '$v';
    final d = v.toDouble();
    if (d.isNaN || d.isInfinite) return '0';
    return ((d * 100).round() / 100).toString();
  }

  /// Excel's day number (1900 date system).
  static int _serial(DateTime d) =>
      DateTime.utc(d.year, d.month, d.day)
          .difference(DateTime.utc(1899, 12, 30))
          .inDays;

  static String _esc(String s) => s
      .replaceAll(RegExp(r'[\x00-\x08\x0B\x0C\x0E-\x1F]'), '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
}
