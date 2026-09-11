import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

/// A finger/mouse-drawable signature canvas, exported as PNG bytes.
///
/// No external drawing package: signature capture is just tracking touch
/// points into strokes and painting them, well within what
/// CustomPainter + GestureDetector already do natively - adding a
/// dependency for this would be exactly the kind of unnecessary package
/// this project has consistently avoided elsewhere (QR codes use the pdf
/// package's own barcode support rather than qr_flutter, for the same
/// reason).
class SignaturePad extends StatefulWidget {
  /// Called whenever a stroke starts/ends, so the parent can enable/
  /// disable Save based on whether anything has actually been drawn.
  final ValueChanged<bool>? onChanged;

  const SignaturePad({super.key, this.onChanged});

  @override
  State<SignaturePad> createState() => SignaturePadState();
}

class SignaturePadState extends State<SignaturePad> {
  /// Each stroke is its own point list, so lifting the finger and
  /// starting a new stroke doesn't connect them with a stray line.
  ///
  /// Deliberately immutable at the top level - every mutation below
  /// replaces this with a NEW List instance (new outer list, and for
  /// the in-progress stroke, a new inner list too), never mutates the
  /// existing one in place. This is required for
  /// _SignaturePainter.shouldRepaint()'s reference-equality check
  /// (oldDelegate.strokes != strokes) to actually detect a change -
  /// mutating a single persistent List in place would make every
  /// CustomPaint rebuild compare a list against itself, always finding
  /// them equal, and Flutter would then never repaint the canvas after
  /// the first frame.
  List<List<Offset>> _strokes = [];

  final GlobalKey _repaintKey = GlobalKey();

  bool get isEmpty => _strokes.isEmpty;

  void clear() {
    setState(() => _strokes = []);
    widget.onChanged?.call(false);
  }

  void _onPanStart(DragStartDetails details) {
    setState(() => _strokes = [..._strokes, [details.localPosition]]);
    widget.onChanged?.call(true);
  }

  void _onPanUpdate(DragUpdateDetails details) {
    setState(() {
      final updatedLastStroke = [..._strokes.last, details.localPosition];
      _strokes = [..._strokes.sublist(0, _strokes.length - 1), updatedLastStroke];
    });
  }

  /// Renders the current strokes to PNG bytes, tightly cropped to the
  /// actual drawn content (not the full canvas) - see this method's
  /// own inline reasoning below for why the full-canvas capture
  /// produced a signature that looked far too small once placed on a
  /// document.
  Future<Uint8List?> exportPng() async {
    if (_strokes.isEmpty) return null;

    // Bounding box of every recorded point across every stroke - this
    // is exactly the stroke data _SignaturePainter already paints with,
    // just measured instead of drawn. No image-processing package
    // needed: the drawn content's true extent is already known as
    // coordinates, never inferred from pixels.
    var minX = double.infinity;
    var minY = double.infinity;
    var maxX = double.negativeInfinity;
    var maxY = double.negativeInfinity;

    for (final stroke in _strokes) {
      for (final point in stroke) {
        if (point.dx < minX) minX = point.dx;
        if (point.dy < minY) minY = point.dy;
        if (point.dx > maxX) maxX = point.dx;
        if (point.dy > maxY) maxY = point.dy;
      }
    }

    // Padding so the stroke's own line width isn't clipped at the very
    // edge, and the signature doesn't look cramped against the crop
    // boundary - the same 3px stroke width _SignaturePainter uses, plus
    // a small margin.
    const padding = 12.0;
    final cropLeft = minX - padding;
    final cropTop = minY - padding;
    final cropWidth = (maxX - minX) + padding * 2;
    final cropHeight = (maxY - minY) + padding * 2;

    if (cropWidth <= 0 || cropHeight <= 0) return null;

    // Redraws the same strokes onto a fresh canvas sized exactly to
    // the crop box (not the full pad) - same technique used by the
    // croppy package's own cropImage() (PictureRecorder + Canvas +
    // translate + endRecording().toImage()), applied to vector strokes
    // directly instead of a captured bitmap, which avoids an extra
    // capture-then-crop round trip.
    const pixelRatio = 3.0;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);

    canvas.scale(pixelRatio);
    canvas.translate(-cropLeft, -cropTop);

    final paint = Paint()
      ..color = Colors.black
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;

    for (final stroke in _strokes) {
      for (var i = 0; i < stroke.length - 1; i++) {
        canvas.drawLine(stroke[i], stroke[i + 1], paint);
      }
    }

    final picture = recorder.endRecording();
    final image = await picture.toImage(
      (cropWidth * pixelRatio).round(),
      (cropHeight * pixelRatio).round(),
    );
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);

    return byteData?.buffer.asUint8List();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onPanStart: _onPanStart,
      onPanUpdate: _onPanUpdate,
      child: RepaintBoundary(
        key: _repaintKey,
        child: Container(
          color: Colors.white,
          width: double.infinity,
          height: double.infinity,
          child: CustomPaint(
            painter: _SignaturePainter(_strokes),
            size: Size.infinite,
          ),
        ),
      ),
    );
  }
}

class _SignaturePainter extends CustomPainter {
  final List<List<Offset>> strokes;

  _SignaturePainter(this.strokes);

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.black
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;

    for (final stroke in strokes) {
      for (var i = 0; i < stroke.length - 1; i++) {
        canvas.drawLine(stroke[i], stroke[i + 1], paint);
      }
    }
  }

  @override
  bool shouldRepaint(_SignaturePainter oldDelegate) =>
      oldDelegate.strokes != strokes;
}
