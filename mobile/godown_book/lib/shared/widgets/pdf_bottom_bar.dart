import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:printing/printing.dart';

import '../../core/pdf/pdf_download.dart';
import '../../core/pdf/whatsapp_pdf_share.dart';

/// A PDF preview with a big DOWNLOAD and SHARE PDF button underneath it,
/// so the two things people do with a finished document are one tap away
/// on the same screen instead of inside the three-dot menu.
///
/// [getPdfBytes] returns the bytes the preview last rendered (the screen
/// stores them from its own PdfPreview build callback), so Download and
/// Share always send exactly what is on screen - demo watermark and all.
class PdfWithBottomBar extends StatelessWidget {
  const PdfWithBottomBar({
    super.key,
    required this.preview,
    required this.getPdfBytes,
    required this.fileName,
    this.shareMessage,
    this.whatsAppPhone,
  });

  final Widget preview;
  final Uint8List? Function() getPdfBytes;
  final String fileName;

  /// Text sent along with the PDF (the owner's WhatsApp message) - apps
  /// such as WhatsApp show it as the caption. Null = PDF only.
  final String? shareMessage;

  /// The customer's number: WhatsApp opens their chat directly.
  final String? whatsAppPhone;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(child: preview),
        PdfBottomBar(
          getPdfBytes: getPdfBytes,
          fileName: fileName,
          shareMessage: shareMessage,
          whatsAppPhone: whatsAppPhone,
        ),
      ],
    );
  }
}

class PdfBottomBar extends StatefulWidget {
  const PdfBottomBar({
    super.key,
    required this.getPdfBytes,
    required this.fileName,
    this.shareMessage,
    this.whatsAppPhone,
    this.loadPdfBytes,
  });

  final Uint8List? Function() getPdfBytes;
  final String fileName;
  final String? shareMessage;
  final String? whatsAppPhone;

  /// Builds the PDF when [getPdfBytes] has none yet - for a screen that
  /// shows the bar without a preview (a bill's detail screen). Returning
  /// null means it handled things itself (e.g. opened the PDF screen).
  final Future<Uint8List?> Function()? loadPdfBytes;

  @override
  State<PdfBottomBar> createState() => _PdfBottomBarState();
}

class _PdfBottomBarState extends State<PdfBottomBar> {
  bool _busy = false;

  /// Floating, lifted clear of the button row: a normal snackbar sits on
  /// the bottom edge of the screen - exactly where DOWNLOAD and SHARE PDF
  /// are - and blocks the next tap for as long as it is showing.
  void _toast(String message, {int seconds = 3}) {
    final messenger = ScaffoldMessenger.of(context);
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
          margin: const EdgeInsets.fromLTRB(16, 0, 16, 84),
          duration: Duration(seconds: seconds),
        ),
      );
  }

  Future<void> _run(Future<void> Function(Uint8List bytes) action) async {
    if (_busy) return;

    var bytes = widget.getPdfBytes();
    if (bytes == null && widget.loadPdfBytes == null) {
      _toast('PDF is still loading - try again in a moment.');
      return;
    }

    setState(() => _busy = true);
    try {
      bytes ??= await widget.loadPdfBytes!();
      if (bytes == null) return;
      await action(bytes);
    } catch (e) {
      if (mounted) _toast('Could not complete: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _download() => _run((bytes) async {
        final where = await PdfDownload.save(bytes, widget.fileName);
        if (!mounted) return;
        _showSavedTick();
        _toast('Downloaded: $where', seconds: 4);
      });

  /// A green tick that pops up over the screen for a moment after a
  /// successful download, so it is obvious the file was saved.
  void _showSavedTick() {
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) return;
    final overlay = Overlay.maybeOf(context);
    if (overlay == null) return;

    late final OverlayEntry entry;
    entry = OverlayEntry(
      builder: (_) => _SavedTick(onDone: () => entry.remove()),
    );
    overlay.insert(entry);
  }

  Future<void> _share() => _run((bytes) async {
        final message = widget.shareMessage?.trim() ?? '';
        await Printing.sharePdf(
          bytes: bytes,
          filename: widget.fileName,
          body: message.isEmpty ? null : message,
        );
      });

  /// Sends the PDF into WhatsApp or WhatsApp Business - whichever the
  /// owner picks - with their message as the caption.
  Future<void> _whatsApp() => _run((bytes) => WhatsAppPdfShare.shareWithChoice(
        context,
        bytes,
        fileName: widget.fileName,
        message: widget.shareMessage ?? '',
        phone: widget.whatsAppPhone ?? '',
      ));

  @override
  Widget build(BuildContext context) {
    return Material(
      elevation: 8,
      color: Theme.of(context).colorScheme.surface,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          child: Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: _busy ? null : _download,
                  icon: const Icon(Icons.download),
                  label: const Text(
                    'DOWNLOAD',
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.6,
                    ),
                  ),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(52),
                    shape: const StadiumBorder(),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Tooltip(
                message: 'Send on WhatsApp',
                child: Material(
                  color: const Color(0xffE7F8EE),
                  shape: const CircleBorder(
                    side: BorderSide(color: Color(0xff25D366), width: 1.5),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    onTap: _busy ? null : _whatsApp,
                    child: SizedBox(
                      width: 52,
                      height: 52,
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Image.asset('assets/images/whatsapp_icon.png'),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  onPressed: _busy ? null : _share,
                  icon: const Icon(Icons.share),
                  label: const Text(
                    'SHARE PDF',
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.6,
                    ),
                  ),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(52),
                    shape: const StadiumBorder(),
                    backgroundColor: const Color(0xffD32F2F),
                    foregroundColor: Colors.white,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SavedTick extends StatefulWidget {
  const _SavedTick({required this.onDone});

  final VoidCallback onDone;

  @override
  State<_SavedTick> createState() => _SavedTickState();
}

class _SavedTickState extends State<_SavedTick>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  );

  @override
  void initState() {
    super.initState();
    _controller.forward().whenComplete(widget.onDone);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Center(
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) {
            final t = _controller.value;
            // pop in (0-0.3), hold, fade out (0.75-1)
            final scale = Curves.easeOutBack.transform((t / 0.3).clamp(0, 1));
            final fade = t < 0.75 ? 1.0 : 1 - (t - 0.75) / 0.25;
            return Opacity(
              opacity: fade.clamp(0, 1),
              child: Transform.scale(
                scale: scale,
                child: Container(
                  width: 96,
                  height: 96,
                  decoration: const BoxDecoration(
                    color: Color(0xff1E9E5A),
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: Color(0x40000000),
                        blurRadius: 18,
                        offset: Offset(0, 6),
                      ),
                    ],
                  ),
                  child: const Icon(Icons.check_rounded,
                      color: Colors.white, size: 58),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
