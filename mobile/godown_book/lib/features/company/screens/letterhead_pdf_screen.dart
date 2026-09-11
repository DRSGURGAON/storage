import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:printing/printing.dart';

import '../../../core/constants/feature_flags.dart';
import '../../../core/subscription/document_type.dart';
import '../../../core/subscription/subscription_access_service.dart';
import '../../subscription/widgets/demo_generation_gate.dart';
import '../controllers/company_controller.dart';
import '../models/company_model.dart';
import '../services/letterhead_pdf_service.dart';

/// Renders a blank company letterhead PDF. Unlike every other PDF
/// screen here it takes no id/extra parameter at all - a letterhead is
/// built purely from the Company Profile, so there is nothing to pick
/// first.
class LetterHeadPdfScreen extends StatefulWidget {
  const LetterHeadPdfScreen({super.key});

  @override
  State<LetterHeadPdfScreen> createState() => _LetterHeadPdfScreenState();
}

class _LetterHeadPdfScreenState extends State<LetterHeadPdfScreen> {
  CompanyModel? _company;
  bool _loading = true;
  Object? _buildError;
  Object? _loadError;

  bool? _isActive;
  int? _remainingDemos;
  bool _demoConfirmed = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    try {
      final company = await CompanyController.instance.getCompany();

      if (company == null || company.companyName.trim().isEmpty) {
        if (!mounted) return;
        setState(() {
          _loadError = 'Add your company name in Company Settings first - a '
              'letterhead is printed entirely from the company profile.';
          _loading = false;
        });
        return;
      }

      final service = SubscriptionAccessService.instance;
      final active = await service.isSubscriptionActive();
      final remaining = active
          ? 0
          : await service.getRemainingDemoGenerations(DocumentType.letterHead);

      if (!mounted) return;

      setState(() {
        _company = company;
        _isActive = active;
        _remainingDemos = remaining;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadError = error;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/dashboard'),
        ),
        title: const Text('Letter Head'),
        centerTitle: true,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _buildBody(context),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_loadError != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.business_outlined, size: 48),
              const SizedBox(height: 12),
              Text('$_loadError', textAlign: TextAlign.center),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: () => context.push('/company-settings'),
                icon: const Icon(Icons.settings_outlined),
                label: const Text('Open Company Settings'),
              ),
            ],
          ),
        ),
      );
    }

    final company = _company;
    if (company == null) {
      return const Center(child: Text('Company profile not found.'));
    }

    if (_buildError != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, size: 48),
              const SizedBox(height: 12),
              Text(
                'The PDF could not be generated.\n$_buildError',
                textAlign: TextAlign.center,
              ),
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
        !_demoConfirmed) {
      if ((_remainingDemos ?? 0) <= 0) {
        return DemoLimitReached(
          onViewSubscription: () => context.push('/subscription'),
        );
      }

      return DemoGenerationGate(
        remaining: _remainingDemos!,
        onGenerate: () => setState(() => _demoConfirmed = true),
      );
    }

    // Whether this is genuinely an unsubscribed user's copy. Kept as a
    // plain subscription check with no flag mixed in, so each
    // FeatureFlag below gates exactly one behaviour independently
    // (watermark vs. free-allowance) rather than one silently
    // disabling the other.
    final isDemoCopy = _isActive == false;

    // Both flags are currently false for testing - documents generate
    // clean and unlimited. Neither the watermark code nor the
    // allowance code is removed; re-enabling either is a one-line
    // change in FeatureFlags.
    final showWatermark = FeatureFlags.watermarkEnabled && isDemoCopy;
    final fileName =
        'LetterHead-${company.companyName.replaceAll(RegExp(r'[^A-Za-z0-9]'), '-')}.pdf';

    return PdfPreview(
      build: (_) async {
        try {
          final bytes = await LetterHeadPdfService.instance.build(
            company,
            showWatermark: showWatermark,
          );

          if (FeatureFlags.demoGenerationLimitEnforced && isDemoCopy) {
            await SubscriptionAccessService.instance.recordDemoGeneration(
              DocumentType.letterHead,
            );
          }

          return bytes;
        } catch (error, stackTrace) {
          debugPrint('Letter Head PDF build failed: $error\n$stackTrace');

          if (mounted) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (mounted) setState(() => _buildError = error);
            });
          }

          rethrow;
        }
      },
      pdfFileName: fileName,
      canDebug: false,
      allowPrinting: true,
      allowSharing: true,
      actions: [
        PdfPreviewAction(
          icon: const Icon(Icons.share),
          onPressed: (context, build, format) async {
            await Printing.sharePdf(
              bytes: await build(format),
              filename: fileName,
            );
          },
        ),
      ],
    );
  }
}
