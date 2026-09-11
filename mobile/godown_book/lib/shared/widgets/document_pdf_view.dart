import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:printing/printing.dart';

import '../../core/constants/feature_flags.dart';
import '../../core/subscription/sample_documents.dart';
import '../../core/subscription/subscription_access_service.dart';
import '../../features/company/controllers/company_controller.dart';
import '../../features/subscription/widgets/demo_generation_gate.dart';

/// The body every PDF screen shares: the free-copy gate, the preview,
/// and Share / Print. The screen above it only says which document
/// this is and how to build its bytes.
///
/// A copy is counted once, when bytes are genuinely produced - a
/// failed build, a re-print or a re-share never consumes another one.
class DocumentPdfView extends StatefulWidget {
  /// The document type this counts against (see DocumentType).
  final String documentType;

  final String fileName;

  /// Builds the PDF. [showWatermark] is true only for a free copy while
  /// the watermark flag is on.
  final Future<Uint8List> Function({required bool showWatermark}) build;

  /// Called with the bytes the preview rendered, so the screen's own
  /// menu shares exactly what is on screen.
  final ValueChanged<Uint8List>? onBytes;

  /// Rebuilds the preview when this changes (copy selection, and so on).
  final Object? rebuildKey;

  const DocumentPdfView({
    super.key,
    required this.documentType,
    required this.fileName,
    required this.build,
    this.onBytes,
    this.rebuildKey,
  });

  @override
  State<DocumentPdfView> createState() => _DocumentPdfViewState();
}

class _DocumentPdfViewState extends State<DocumentPdfView> {
  bool _loading = true;
  bool? _isActive;
  int? _remaining;
  bool _confirmed = false;

  /// True while showing the made-up sample rather than the real
  /// document - never counted, never saved.
  bool _showingSample = false;

  Object? _buildError;

  /// Set once a copy has been counted for this screen, so a re-render
  /// (rotation, share, print) never counts a second one.
  bool _counted = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  /// A screen that switches between documents - the bilty pack prints
  /// three from one record - is a new document each time, so the gate
  /// starts again and the copy is counted against the right type
  /// instead of riding on the one the screen opened with.
  @override
  void didUpdateWidget(covariant DocumentPdfView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.documentType == widget.documentType) return;

    setState(() {
      _loading = true;
      _confirmed = false;
      _counted = false;
      _showingSample = false;
      _buildError = null;
    });
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final service = SubscriptionAccessService.instance;
    final active = await service.isSubscriptionActive();
    final remaining =
        active ? 0 : await service.getRemainingDemoGenerations(widget.documentType);

    if (!mounted) return;
    setState(() {
      _isActive = active;
      _remaining = remaining;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());

    if (_buildError != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, size: 48),
              const SizedBox(height: 12),
              Text('The PDF could not be generated.\n$_buildError',
                  textAlign: TextAlign.center),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: () => setState(() => _buildError = null),
                icon: const Icon(Icons.refresh),
                label: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
    }

    if (FeatureFlags.demoGenerationLimitEnforced &&
        _isActive == false &&
        !_confirmed &&
        !_showingSample) {
      if ((_remaining ?? 0) <= 0) {
        return DemoLimitReached(
          onViewSubscription: () => context.push('/subscription'),
          onTrySample: SampleDocuments.has(widget.documentType)
              ? () => setState(() => _showingSample = true)
              : null,
        );
      }
      return DemoGenerationGate(
        remaining: _remaining!,
        onGenerate: () => setState(() => _confirmed = true),
      );
    }

    final isFreeCopy = _isActive == false;
    final showWatermark = FeatureFlags.watermarkEnabled && isFreeCopy;

    if (_showingSample) return _samplePreview();

    return PdfPreview(
      key: widget.rebuildKey == null ? null : ValueKey(widget.rebuildKey),
      build: (_) async {
        try {
          final bytes = await widget.build(showWatermark: showWatermark);
          widget.onBytes?.call(bytes);

          if (FeatureFlags.demoGenerationLimitEnforced && isFreeCopy && !_counted) {
            _counted = true;
            await SubscriptionAccessService.instance
                .recordDemoGeneration(widget.documentType);
          }
          return bytes;
        } catch (error, stackTrace) {
          debugPrint('${widget.fileName} build failed: $error\n$stackTrace');
          if (mounted) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (mounted) setState(() => _buildError = error);
            });
          }
          rethrow;
        }
      },
      pdfFileName: widget.fileName,
      canDebug: false,
      allowPrinting: true,
      allowSharing: true,
      actions: [
        PdfPreviewAction(
          icon: const Icon(Icons.share),
          onPressed: (context, build, format) async {
            await Printing.sharePdf(
              bytes: await build(format),
              filename: widget.fileName,
            );
          },
        ),
      ],
    );
  }

  /// The sample: built from made-up data on the company's own
  /// letterhead, marked SAMPLE, and never counted against the free
  /// copies. Sharing it is allowed - it says SAMPLE across the page.
  Widget _samplePreview() {
    return Column(
      children: [
        Container(
          width: double.infinity,
          color: Theme.of(context).colorScheme.tertiaryContainer,
          padding: const EdgeInsets.fromLTRB(16, 10, 8, 10),
          child: Row(
            children: [
              const Expanded(
                child: Text(
                  'This is a sample with made-up details. Your own records '
                  'are not touched.',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                ),
              ),
              TextButton(
                onPressed: () => setState(() => _showingSample = false),
                child: const Text('Close'),
              ),
            ],
          ),
        ),
        Expanded(
          child: PdfPreview(
            build: (_) async {
              final company = await CompanyController.instance.getCompany();
              return SampleDocuments.build(widget.documentType, company);
            },
            pdfFileName: 'Sample-${widget.fileName}',
            canDebug: false,
            allowPrinting: true,
            allowSharing: true,
          ),
        ),
      ],
    );
  }
}
