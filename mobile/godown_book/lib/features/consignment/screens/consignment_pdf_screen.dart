import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/subscription/document_type.dart';
import '../../../shared/widgets/company_not_configured.dart';
import '../../../shared/widgets/document_pdf_view.dart';
import '../../../shared/widgets/pdf_document_actions.dart';
import '../../company/controllers/company_controller.dart';
import '../../company/models/company_model.dart';
import '../models/consignment_model.dart';
import '../repositories/consignment_repository.dart';
import '../services/consignment_pdf_service.dart';

/// One screen for the whole bilty pack: the Lorry Receipt with its
/// copies, the Goods Forwarding Note the sender signs, and the Delivery
/// Challan - switched with three chips, all from one record.
class ConsignmentPdfScreen extends StatefulWidget {
  final String consignmentId;
  final BiltyPaper paper;

  const ConsignmentPdfScreen({
    super.key,
    required this.consignmentId,
    this.paper = BiltyPaper.lorryReceipt,
  });

  @override
  State<ConsignmentPdfScreen> createState() => _ConsignmentPdfScreenState();
}

class _ConsignmentPdfScreenState extends State<ConsignmentPdfScreen> {
  static final _dateFormat = DateFormat('dd MMM yyyy');

  Uint8List? _menuPdfBytes;
  ConsignmentModel? _consignment;
  CompanyModel? _company;
  late BiltyPaper _paper;
  bool _loading = true;

  final Set<String> _selectedCopies = {...ConsignmentPdfService.copyLabels};

  @override
  void initState() {
    super.initState();
    _paper = widget.paper;
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final consignment =
        await ConsignmentRepository.instance.getById(widget.consignmentId);
    final company = await CompanyController.instance.getCompany();
    if (!mounted) return;
    setState(() {
      _consignment = consignment;
      _company = company;
      _loading = false;
    });
  }

  String get _fileName {
    final consignment = _consignment;
    final number = _paper == BiltyPaper.deliveryChallan
        ? (consignment?.challanNo ?? '')
        : (consignment?.lrNo ?? '');
    final name = switch (_paper) {
      BiltyPaper.lorryReceipt => 'Bilty',
      BiltyPaper.forwardingNote => 'Forwarding-Note',
      BiltyPaper.deliveryChallan => 'Delivery-Challan',
    };
    return '$name-${number.replaceAll('/', '-')}.pdf';
  }

  String get _documentType => switch (_paper) {
        BiltyPaper.lorryReceipt => DocumentType.lorryReceipt,
        BiltyPaper.forwardingNote => DocumentType.forwardingNote,
        BiltyPaper.deliveryChallan => DocumentType.deliveryChallan,
      };

  @override
  Widget build(BuildContext context) {
    final consignment = _consignment;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/bilties'),
        ),
        title: Text(consignment?.lrNo ?? 'Bilty'),
        centerTitle: true,
        actions: [
          PdfActionsMenu(
            documentLabel: _paper.label,
            fileName: () => _fileName,
            getPdfBytes: () => _menuPdfBytes,
            customerPhone: consignment?.consignorPhone,
            onEdit: consignment == null
                ? null
                : () async {
                    await context.push('/bilty-edit', extra: consignment.id);
                    await _load();
                  },
            onDelete: () =>
                ConsignmentRepository.instance.delete(widget.consignmentId),
            afterDelete: () =>
                context.canPop() ? context.pop() : context.go('/bilties'),
            deleteWarning: 'The bilty and its papers will be deleted.',
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : consignment == null
              ? const Center(child: Text('Bilty not found.'))
              : (_company == null || !_company!.isConfigured)
                  ? CompanyNotConfigured(
                      missing: _company?.missingFields ?? const ['Company details'])
                  : Column(
                      children: [
                        _paperSelector(consignment),
                        if (_paper == BiltyPaper.lorryReceipt) _copySelector(),
                        Expanded(
                          child: DocumentPdfView(
                            documentType: _documentType,
                            fileName: _fileName,
                            rebuildKey: '${_paper.name}|'
                                '${_selectedCopies.join('|')}|'
                                '${consignment.challanNo}|${consignment.deliveredOn}',
                            onBytes: (bytes) => _menuPdfBytes = bytes,
                            build: ({required showWatermark}) =>
                                ConsignmentPdfService.instance.build(
                              consignment,
                              _company,
                              paper: _paper,
                              showWatermark: showWatermark,
                              copies: _selectedCopies.toList(),
                            ),
                          ),
                        ),
                        _deliveryBar(consignment),
                      ],
                    ),
    );
  }

  Widget _paperSelector(ConsignmentModel consignment) {
    return Container(
      width: double.infinity,
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
      child: Wrap(
        spacing: 8,
        children: [
          for (final paper in BiltyPaper.values)
            ChoiceChip(
              label: Text(paper.shortLabel,
                  style: const TextStyle(fontSize: 12)),
              selected: _paper == paper,
              onSelected: (_) => _switchPaper(paper, consignment),
            ),
        ],
      ),
    );
  }

  /// The challan gets its number the first time it is actually printed,
  /// so the challan series has no gaps in it.
  Future<void> _switchPaper(
      BiltyPaper paper, ConsignmentModel consignment) async {
    if (paper == BiltyPaper.deliveryChallan && consignment.challanNo.isEmpty) {
      final numbered = await ConsignmentRepository.instance
          .ensureChallanNumber(consignment.id);
      if (!mounted) return;
      setState(() => _consignment = numbered);
    }
    if (!mounted) return;
    setState(() => _paper = paper);
  }

  Widget _copySelector() {
    return Container(
      width: double.infinity,
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      child: Row(
        children: [
          const Text('Copies',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
          const SizedBox(width: 10),
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final label in ConsignmentPdfService.copyLabels)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: FilterChip(
                        label: Text(label.replaceAll(' COPY', ''),
                            style: const TextStyle(fontSize: 11)),
                        selected: _selectedCopies.contains(label),
                        onSelected: (on) {
                          setState(() {
                            if (on) {
                              _selectedCopies.add(label);
                            } else if (_selectedCopies.length > 1) {
                              _selectedCopies.remove(label);
                            }
                          });
                        },
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// When the goods reach the other end, the same bilty becomes the
  /// proof of delivery - so the app asks for it here.
  Widget _deliveryBar(ConsignmentModel consignment) {
    return SafeArea(
      top: false,
      child: Container(
        width: double.infinity,
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
        child: Row(
          children: [
            Icon(
              consignment.isDelivered
                  ? Icons.check_circle_outline
                  : Icons.local_shipping_outlined,
              size: 20,
              color: consignment.isDelivered ? Colors.green.shade700 : null,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                consignment.isDelivered
                    ? 'Delivered on ${_date(consignment.deliveredOn)}'
                        '${consignment.receivedBy.trim().isEmpty ? '' : ' to ${consignment.receivedBy}'}'
                    : 'Not delivered yet',
                style: const TextStyle(fontSize: 12.5),
              ),
            ),
            TextButton(
              onPressed: () => _markDelivered(consignment),
              child: Text(consignment.isDelivered ? 'Change' : 'Mark delivered'),
            ),
          ],
        ),
      ),
    );
  }

  String _date(String iso) {
    final parsed = DateTime.tryParse(iso);
    return parsed == null ? '-' : _dateFormat.format(parsed);
  }

  Future<void> _markDelivered(ConsignmentModel consignment) async {
    final receivedBy = TextEditingController(
        text: consignment.receivedBy.isEmpty
            ? consignment.consigneeName
            : consignment.receivedBy);
    final remarks = TextEditingController(text: consignment.deliveryRemarks);
    var on = DateTime.tryParse(consignment.deliveredOn) ?? DateTime.now();

    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (sheetContext, setSheetState) => Padding(
          padding: EdgeInsets.fromLTRB(
              16, 16, 16, MediaQuery.of(sheetContext).viewInsets.bottom + 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Goods delivered',
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold)),
              const SizedBox(height: 12),
              TextField(
                controller: receivedBy,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(
                  labelText: 'Received by',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: remarks,
                decoration: const InputDecoration(
                  labelText: 'Shortage or damage noted (optional)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                icon: const Icon(Icons.event_outlined, size: 18),
                label: Text(_dateFormat.format(on)),
                onPressed: () async {
                  final picked = await showDatePicker(
                    context: sheetContext,
                    initialDate: on,
                    firstDate: DateTime(2020),
                    lastDate: DateTime.now().add(const Duration(days: 7)),
                  );
                  if (picked != null) setSheetState(() => on = picked);
                },
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () => Navigator.of(sheetContext).pop(true),
                  child: const Text('Save'),
                ),
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
    );

    if (saved != true) return;

    await ConsignmentRepository.instance.markDelivered(
      consignment.id,
      receivedBy: receivedBy.text.trim(),
      deliveredOn: on,
      remarks: remarks.text.trim(),
    );
    await _load();
  }
}
