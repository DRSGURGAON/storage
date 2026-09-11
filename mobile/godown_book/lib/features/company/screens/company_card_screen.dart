import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:printing/printing.dart';

import '../controllers/company_controller.dart';
import '../services/company_card_pdf_service.dart';

/// Displays/shares the Company Card PDF - no Subscription watermark
/// gate here (see CompanyCardPdfService's own doc comment): this is
/// an internal business-card summary, not a customer-facing billing
/// document, so it's deliberately outside that system.
class CompanyCardScreen extends StatefulWidget {
  const CompanyCardScreen({super.key});

  @override
  State<CompanyCardScreen> createState() => _CompanyCardScreenState();
}

class _CompanyCardScreenState extends State<CompanyCardScreen> {
  bool _loading = true;
  Object? _buildError;
  Object? _loadError;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    try {
      await CompanyController.instance.getCompany();

      if (!mounted) return;
      setState(() => _loading = false);
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
          onPressed: () => context.canPop() ? context.pop() : context.go('/dashboard'),
        ),
        title: const Text('Company Card'),
        centerTitle: true,
      ),
      body: _loading ? const Center(child: CircularProgressIndicator()) : _buildBody(context),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_loadError != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text('Could not load company profile.\n$_loadError', textAlign: TextAlign.center),
        ),
      );
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
              Text('The PDF could not be generated.\n$_buildError', textAlign: TextAlign.center),
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

    const fileName = 'Company-Card.pdf';

    return PdfPreview(
      build: (_) async {
        try {
          final company = await CompanyController.instance.getCompany();
          return await CompanyCardPdfService.instance.build(company);
        } catch (error, stackTrace) {
          debugPrint('Company Card PDF build failed: $error\n$stackTrace');

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
            await Printing.sharePdf(bytes: await build(format), filename: fileName);
          },
        ),
      ],
    );
  }
}
