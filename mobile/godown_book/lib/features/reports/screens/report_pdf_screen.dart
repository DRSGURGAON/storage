import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/subscription/document_type.dart';
import '../../../shared/widgets/company_not_configured.dart';
import '../../../shared/widgets/document_pdf_view.dart';
import '../../../shared/widgets/pdf_document_actions.dart';
import '../../billing/repositories/billing_repository.dart';
import '../../company/controllers/company_controller.dart';
import '../../company/models/company_model.dart';
import '../../storage_booking/repositories/storage_booking_repository.dart';
import '../services/aged_outstanding_pdf_service.dart';
import '../services/rent_roll_pdf_service.dart';
import '../services/report_builder.dart';

enum ReportKind {
  rentRoll,
  agedOutstanding;

  String get title => switch (this) {
        ReportKind.rentRoll => 'Rent Roll',
        ReportKind.agedOutstanding => 'Aged Outstanding',
      };

  String get documentType => switch (this) {
        ReportKind.rentRoll => DocumentType.rentRoll,
        ReportKind.agedOutstanding => DocumentType.agedOutstanding,
      };
}

/// One report, built from today's data and shown like any other paper.
class ReportPdfScreen extends StatefulWidget {
  final ReportKind kind;

  const ReportPdfScreen({super.key, required this.kind});

  @override
  State<ReportPdfScreen> createState() => _ReportPdfScreenState();
}

class _ReportPdfScreenState extends State<ReportPdfScreen> {
  Uint8List? _menuPdfBytes;
  CompanyModel? _company;
  RentRoll? _roll;
  AgeingReport? _ageing;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final company = await CompanyController.instance.getCompany();

    RentRoll? roll;
    AgeingReport? ageing;
    switch (widget.kind) {
      case ReportKind.rentRoll:
        roll = ReportBuilder.rentRoll(
            await StorageBookingRepository.instance.getAll());
      case ReportKind.agedOutstanding:
        ageing = ReportBuilder.agedOutstanding(
            await BillingRepository.instance.getAllBills());
    }

    if (!mounted) return;
    setState(() {
      _company = company;
      _roll = roll;
      _ageing = ageing;
      _loading = false;
    });
  }

  String get _fileName {
    final now = DateTime.now();
    final stamp = '${now.year}-${now.month.toString().padLeft(2, '0')}-'
        '${now.day.toString().padLeft(2, '0')}';
    return '${widget.kind.title.replaceAll(' ', '')}-$stamp.pdf';
  }

  Future<Uint8List> _build({required bool showWatermark}) {
    switch (widget.kind) {
      case ReportKind.rentRoll:
        return RentRollPdfService.instance
            .build(_roll!, _company, showWatermark: showWatermark);
      case ReportKind.agedOutstanding:
        return AgedOutstandingPdfService.instance
            .build(_ageing!, _company, showWatermark: showWatermark);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/reports'),
        ),
        title: Text(widget.kind.title),
        centerTitle: true,
        actions: [
          PdfActionsMenu(
            documentLabel: widget.kind.title,
            fileName: () => _fileName,
            getPdfBytes: () => _menuPdfBytes,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : (_company == null || !_company!.isConfigured)
              ? CompanyNotConfigured(
                  missing: _company?.missingFields ?? const ['Company details'])
              : DocumentPdfView(
                  documentType: widget.kind.documentType,
                  fileName: _fileName,
                  onBytes: (bytes) => _menuPdfBytes = bytes,
                  build: _build,
                ),
    );
  }
}
