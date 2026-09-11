import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/subscription/document_type.dart';
import '../../../shared/widgets/company_not_configured.dart';
import '../../../shared/widgets/document_pdf_view.dart';
import '../../../shared/widgets/pdf_document_actions.dart';
import '../../company/controllers/company_controller.dart';
import '../../company/models/company_model.dart';
import '../../storage_booking/models/storage_photo_model.dart';
import '../../storage_booking/repositories/storage_photo_repository.dart';
import '../models/incident_model.dart';
import '../repositories/incident_repository.dart';
import '../services/incident_pdf_service.dart';

class IncidentPdfScreen extends StatefulWidget {
  final String incidentId;

  const IncidentPdfScreen({super.key, required this.incidentId});

  @override
  State<IncidentPdfScreen> createState() => _IncidentPdfScreenState();
}

class _IncidentPdfScreenState extends State<IncidentPdfScreen> {
  Uint8List? _menuPdfBytes;
  IncidentModel? _incident;
  List<StoragePhotoModel> _photos = const [];
  CompanyModel? _company;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final incident = await IncidentRepository.instance.getById(widget.incidentId);
    final photos = incident == null
        ? const <StoragePhotoModel>[]
        : await StoragePhotoRepository.instance.getForIncident(incident.id);
    final company = await CompanyController.instance.getCompany();
    if (!mounted) return;
    setState(() {
      _incident = incident;
      _photos = photos;
      _company = company;
      _loading = false;
    });
  }

  String get _fileName =>
      'Report-${(_incident?.reportNo ?? '').replaceAll('/', '-')}.pdf';

  @override
  Widget build(BuildContext context) {
    final incident = _incident;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/incidents'),
        ),
        title: const Text('Damage / Loss Report'),
        centerTitle: true,
        actions: [
          PdfActionsMenu(
            documentLabel: 'Report',
            fileName: () => _fileName,
            getPdfBytes: () => _menuPdfBytes,
            customerPhone: incident?.customerPhone,
            onEdit: incident == null
                ? null
                : () async {
                    await context.push('/incident-edit', extra: incident.id);
                    await _load();
                  },
            onDelete: () => IncidentRepository.instance.delete(widget.incidentId),
            afterDelete: () =>
                context.canPop() ? context.pop() : context.go('/incidents'),
            deleteWarning: 'The report will be deleted. Its photos stay on the '
                'phone but will no longer be part of any report.',
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : incident == null
              ? const Center(child: Text('Report not found.'))
              : (_company == null || !_company!.isConfigured)
                  ? CompanyNotConfigured(
                      missing: _company?.missingFields ?? const ['Company details'])
                  : DocumentPdfView(
                      documentType: DocumentType.incidentReport,
                      fileName: _fileName,
                      rebuildKey: '${_photos.length}',
                      onBytes: (bytes) => _menuPdfBytes = bytes,
                      build: ({required showWatermark}) =>
                          IncidentPdfService.instance.build(
                        incident,
                        _company,
                        photos: _photos,
                        showWatermark: showWatermark,
                      ),
                    ),
    );
  }
}
