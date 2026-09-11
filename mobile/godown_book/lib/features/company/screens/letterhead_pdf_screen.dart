import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/subscription/document_type.dart';
import '../../../shared/widgets/document_pdf_view.dart';
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

      if (!mounted) return;

      setState(() {
        _company = company;
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

    final fileName =
        'LetterHead-${company.companyName.replaceAll(RegExp(r'[^A-Za-z0-9]'), '-')}.pdf';

    return DocumentPdfView(
      documentType: DocumentType.letterHead,
      fileName: fileName,
      build: ({required showWatermark}) => LetterHeadPdfService.instance.build(
        company,
        showWatermark: showWatermark,
      ),
    );
  }
}
