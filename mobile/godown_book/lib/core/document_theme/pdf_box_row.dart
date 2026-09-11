import 'package:pdf/widgets.dart' as pw;

/// Lays side-by-side bordered boxes out at genuinely EQUAL HEIGHT -
/// the shorter box stretches to match the tallest, so a row of cards
/// always reads as one aligned band even when one card has fewer
/// details filled in.
///
/// A plain pw.Row(children: [Expanded(box), Expanded(box)]) cannot do
/// this in the pdf package (no IntrinsicHeight there); a single-row
/// pw.Table with TableCellVerticalAlignment.full is the package's own
/// mechanism for it. Used by every PDF service that draws side-by-side
/// info/party/acknowledgement cards, so box sizing is consistent
/// across the whole app's documents.
class PdfBoxRow {
  PdfBoxRow._();

  static pw.Widget equal(List<pw.Widget> boxes, {double gap = 8}) {
    final columnWidths = <int, pw.TableColumnWidth>{};
    final cells = <pw.Widget>[];

    for (var i = 0; i < boxes.length; i++) {
      if (i > 0) {
        columnWidths[cells.length] = pw.FixedColumnWidth(gap);
        cells.add(pw.SizedBox());
      }
      columnWidths[cells.length] = const pw.FlexColumnWidth(1);
      cells.add(boxes[i]);
    }

    return pw.Table(
      columnWidths: columnWidths,
      defaultVerticalAlignment: pw.TableCellVerticalAlignment.full,
      children: [pw.TableRow(children: cells)],
    );
  }
}
