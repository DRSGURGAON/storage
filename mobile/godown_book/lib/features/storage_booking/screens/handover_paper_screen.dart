import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/subscription/document_type.dart';
import '../../../shared/widgets/company_not_configured.dart';
import '../../../shared/widgets/document_pdf_view.dart';
import '../../../shared/widgets/pdf_document_actions.dart';
import '../../company/controllers/company_controller.dart';
import '../../company/models/company_model.dart';
import '../models/storage_booking_model.dart';
import '../repositories/storage_booking_repository.dart';
import '../services/authority_letter_pdf_service.dart';

/// The authority letter and the indemnity bond - the two papers a
/// godown needs before handing goods to somebody who is not the
/// customer, or without the receipt.
///
/// One screen: fill in who is collecting, see the letter, share it. The
/// customer's own details come from the storage record.
class HandoverPaperScreen extends StatefulWidget {
  final String bookingId;

  const HandoverPaperScreen({super.key, required this.bookingId});

  @override
  State<HandoverPaperScreen> createState() => _HandoverPaperScreenState();
}

class _HandoverPaperScreenState extends State<HandoverPaperScreen> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _idProof = TextEditingController();
  final _relation = TextEditingController();
  final _reason = TextEditingController();

  HandoverPaper _paper = HandoverPaper.authority;
  StorageBookingModel? _booking;
  CompanyModel? _company;
  Uint8List? _menuPdfBytes;
  bool _loading = true;
  bool _showLetter = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _idProof.dispose();
    _relation.dispose();
    _reason.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final booking = await StorageBookingRepository.instance.getById(widget.bookingId);
    final company = await CompanyController.instance.getCompany();
    if (!mounted) return;
    setState(() {
      _booking = booking;
      _company = company;
      _loading = false;
    });
  }

  HandoverDetails get _details => HandoverDetails(
        personName: _name.text.trim(),
        personPhone: _phone.text.trim(),
        personIdProof: _idProof.text.trim(),
        relation: _relation.text.trim(),
        reason: _reason.text.trim(),
      );

  String get _fileName =>
      '${_paper == HandoverPaper.authority ? 'Authority' : 'Indemnity'}'
      '-${(_booking?.bookingNo ?? '').replaceAll('/', '-')}.pdf';

  String get _documentType => _paper == HandoverPaper.authority
      ? DocumentType.authorityLetter
      : DocumentType.indemnityBond;

  @override
  Widget build(BuildContext context) {
    final booking = _booking;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            if (_showLetter) {
              setState(() => _showLetter = false);
              return;
            }
            context.canPop() ? context.pop() : context.go('/storage');
          },
        ),
        title: Text(_paper.label),
        centerTitle: true,
        actions: [
          if (_showLetter)
            PdfActionsMenu(
              documentLabel: _paper.label,
              fileName: () => _fileName,
              getPdfBytes: () => _menuPdfBytes,
              customerPhone: booking?.customerPhone,
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : booking == null
              ? const Center(child: Text('Storage record not found.'))
              : (_company == null || !_company!.isConfigured)
                  ? CompanyNotConfigured(
                      missing: _company?.missingFields ?? const ['Company details'])
                  : _showLetter
                      ? DocumentPdfView(
                          documentType: _documentType,
                          fileName: _fileName,
                          rebuildKey: '${_paper.name}|${_details.personName}'
                              '|${_details.personPhone}|${_details.personIdProof}'
                              '|${_details.relation}|${_details.reason}',
                          onBytes: (bytes) => _menuPdfBytes = bytes,
                          build: ({required showWatermark}) =>
                              AuthorityLetterPdfService.instance.build(
                            booking,
                            _company,
                            paper: _paper,
                            details: _details,
                            showWatermark: showWatermark,
                          ),
                        )
                      : _form(booking),
      bottomNavigationBar: _loading || _showLetter || booking == null
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
                child: SizedBox(
                  height: 52,
                  child: FilledButton.icon(
                    icon: const Icon(Icons.description_outlined),
                    label: Text('Make the ${_paper.label.toLowerCase()}'),
                    onPressed: () => setState(() => _showLetter = true),
                  ),
                ),
              ),
            ),
    );
  }

  Widget _paperChoice(HandoverPaper paper, String hint, IconData icon) {
    final selected = _paper == paper;
    return ListTile(
      leading: Icon(icon,
          color: selected ? Theme.of(context).colorScheme.primary : null),
      title: Text(paper.label,
          style: TextStyle(
              fontWeight: selected ? FontWeight.bold : FontWeight.normal)),
      subtitle: Text(hint),
      trailing: selected ? const Icon(Icons.check_circle) : null,
      selected: selected,
      onTap: () => setState(() => _paper = paper),
    );
  }

  Widget _form(StorageBookingModel booking) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
      children: [
        Card(
          child: ListTile(
            leading: const CircleAvatar(child: Icon(Icons.person_outline)),
            title: Text(booking.customerName,
                style: const TextStyle(fontWeight: FontWeight.bold)),
            subtitle: Text('Storage ${booking.bookingNo}'),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Column(
            children: [
              _paperChoice(
                HandoverPaper.authority,
                'Someone else will collect the goods',
                Icons.assignment_ind_outlined,
              ),
              const Divider(height: 1),
              _paperChoice(
                HandoverPaper.indemnity,
                'Receipt lost, or goods released on request',
                Icons.shield_outlined,
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Who will collect the goods?',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                const SizedBox(height: 12),
                TextField(
                  controller: _name,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(
                    labelText: 'Name',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _phone,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(
                    labelText: 'Mobile',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _idProof,
                  decoration: const InputDecoration(
                    labelText: 'ID proof shown',
                    hintText: 'Aadhaar / DL / Voter ID and number',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _relation,
                  decoration: const InputDecoration(
                    labelText: 'Relation to the customer',
                    hintText: 'Brother, driver, friend...',
                    border: OutlineInputBorder(),
                  ),
                ),
                if (_paper == HandoverPaper.indemnity) ...[
                  const SizedBox(height: 14),
                  TextField(
                    controller: _reason,
                    maxLines: 3,
                    decoration: const InputDecoration(
                      labelText: 'Why the bond is needed (optional)',
                      hintText: 'Receipt lost, and so on',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 4),
          child: Text(
            'Print it, get the customer to sign it, and keep it with a copy of '
            'the ID proof. Anything left blank prints as a line to fill in by '
            'hand.',
            style: TextStyle(fontSize: 12, color: Colors.black54),
          ),
        ),
      ],
    );
  }
}
