import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/subscription/document_type.dart';
import '../../../shared/widgets/company_not_configured.dart';
import '../../../shared/widgets/document_pdf_view.dart';
import '../../../shared/widgets/pdf_document_actions.dart';
import '../../company/controllers/company_controller.dart';
import '../../company/models/company_model.dart';
import '../models/notice_model.dart';
import '../repositories/notice_repository.dart';
import '../services/notice_pdf_service.dart';

/// The finished letter, and the one thing the operator must record
/// afterwards: how it was sent.
class NoticePdfScreen extends StatefulWidget {
  final String noticeId;

  const NoticePdfScreen({super.key, required this.noticeId});

  @override
  State<NoticePdfScreen> createState() => _NoticePdfScreenState();
}

class _NoticePdfScreenState extends State<NoticePdfScreen> {
  static const List<String> _ways = ['WhatsApp', 'By hand', 'Post / Courier'];

  Uint8List? _menuPdfBytes;
  NoticeModel? _notice;
  CompanyModel? _company;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final notice = await NoticeRepository.instance.getById(widget.noticeId);
    final company = await CompanyController.instance.getCompany();
    if (!mounted) return;
    setState(() {
      _notice = notice;
      _company = company;
      _loading = false;
    });
  }

  String get _fileName =>
      'Notice-${(_notice?.noticeNo ?? '').replaceAll('/', '-')}.pdf';

  @override
  Widget build(BuildContext context) {
    final notice = _notice;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/notices'),
        ),
        title: Text(notice?.kind.label ?? 'Notice'),
        centerTitle: true,
        actions: [
          PdfActionsMenu(
            documentLabel: 'Notice',
            fileName: () => _fileName,
            getPdfBytes: () => _menuPdfBytes,
            customerPhone: notice?.customerPhone,
            onDelete: () => NoticeRepository.instance.delete(widget.noticeId),
            afterDelete: () =>
                context.canPop() ? context.pop() : context.go('/notices'),
            deleteWarning:
                'The letter will be deleted, and with it the record that it '
                'was ever sent.',
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : notice == null
              ? const Center(child: Text('Notice not found.'))
              : (_company == null || !_company!.isConfigured)
                  ? CompanyNotConfigured(
                      missing: _company?.missingFields ?? const ['Company details'])
                  : Column(
                      children: [
                        Expanded(
                          child: DocumentPdfView(
                            documentType: DocumentType.notice,
                            fileName: _fileName,
                            onBytes: (bytes) => _menuPdfBytes = bytes,
                            build: ({required showWatermark}) =>
                                NoticePdfService.instance.build(
                              notice,
                              _company,
                              showWatermark: showWatermark,
                            ),
                          ),
                        ),
                        _sentBar(notice),
                      ],
                    ),
    );
  }

  /// Who it went to and how is the whole point of keeping the letter -
  /// so the app asks once, right here, instead of hoping somebody
  /// remembers.
  Widget _sentBar(NoticeModel notice) {
    return SafeArea(
      top: false,
      child: Container(
        width: double.infinity,
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              notice.sentVia.isEmpty
                  ? 'How did you send it?'
                  : 'Sent by ${notice.sentVia}',
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              children: [
                for (final way in _ways)
                  ChoiceChip(
                    label: Text(way, style: const TextStyle(fontSize: 12)),
                    selected: notice.sentVia == way,
                    onSelected: (_) async {
                      await NoticeRepository.instance.markSent(notice.id, way);
                      await _load();
                    },
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
