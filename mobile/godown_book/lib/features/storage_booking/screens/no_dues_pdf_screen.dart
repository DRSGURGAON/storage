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
import '../../release/repositories/goods_release_repository.dart';
import '../models/storage_booking_model.dart';
import '../repositories/storage_booking_repository.dart';
import '../services/no_dues_check.dart';
import '../services/no_dues_pdf_service.dart';

/// The no-dues certificate for one closed storage record. When the
/// record is not actually clear, the screen says what is in the way
/// instead of printing a certificate that is not true.
class NoDuesPdfScreen extends StatefulWidget {
  final String bookingId;

  const NoDuesPdfScreen({super.key, required this.bookingId});

  @override
  State<NoDuesPdfScreen> createState() => _NoDuesPdfScreenState();
}

class _NoDuesPdfScreenState extends State<NoDuesPdfScreen> {
  Uint8List? _menuPdfBytes;
  StorageBookingModel? _booking;
  CompanyModel? _company;
  NoDuesCheck? _check;
  String _collectedOn = '';
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final booking = await StorageBookingRepository.instance.getById(widget.bookingId);
    final company = await CompanyController.instance.getCompany();

    NoDuesCheck? check;
    var collectedOn = '';
    if (booking != null) {
      final balance = booking.customerId.isEmpty
          ? const CustomerBalance(
              customerId: '', customerName: '', billed: 0, received: 0)
          : await BillingRepository.instance.balanceForCustomer(booking.customerId);
      final deposit = await BillingRepository.instance
          .depositForBooking(booking.id, agreed: booking.securityDeposit);
      check = NoDuesCheck(booking: booking, balance: balance, deposit: deposit);

      final releases =
          await GoodsReleaseRepository.instance.getForBooking(booking.id);
      for (final release in releases) {
        if (release.releaseDate.compareTo(collectedOn) > 0) {
          collectedOn = release.releaseDate;
        }
      }
    }

    if (!mounted) return;
    setState(() {
      _booking = booking;
      _company = company;
      _check = check;
      _collectedOn = collectedOn;
      _loading = false;
    });
  }

  String get _fileName =>
      'NoDues-${(_booking?.bookingNo ?? '').replaceAll('/', '-')}.pdf';

  @override
  Widget build(BuildContext context) {
    final booking = _booking;
    final check = _check;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/storage'),
        ),
        title: const Text('No Dues Certificate'),
        centerTitle: true,
        actions: [
          if (check != null && check.isClear)
            PdfActionsMenu(
              documentLabel: 'No Dues Certificate',
              fileName: () => _fileName,
              getPdfBytes: () => _menuPdfBytes,
              customerPhone: booking?.customerPhone,
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : booking == null || check == null
              ? const Center(child: Text('Storage record not found.'))
              : (_company == null || !_company!.isConfigured)
                  ? CompanyNotConfigured(
                      missing: _company?.missingFields ?? const ['Company details'])
                  : !check.isClear
                      ? _blocked(check)
                      : DocumentPdfView(
                          documentType: DocumentType.noDues,
                          fileName: _fileName,
                          onBytes: (bytes) => _menuPdfBytes = bytes,
                          build: ({required showWatermark}) =>
                              NoDuesPdfService.instance.build(
                            booking,
                            _company,
                            balance: check.balance,
                            deposit: check.deposit,
                            collectedOn: _collectedOn,
                            showWatermark: showWatermark,
                          ),
                        ),
    );
  }

  Widget _blocked(NoDuesCheck check) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Icon(Icons.lock_clock_outlined, size: 48, color: Colors.grey),
            const SizedBox(height: 12),
            const Text(
              'Not clear yet',
              textAlign: TextAlign.center,
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
            ),
            const SizedBox(height: 6),
            const Text(
              'A no-dues certificate is issued only when the goods are out '
              'and nothing is owed either way.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.black54),
            ),
            const SizedBox(height: 16),
            for (final reason in check.blockers)
              ListTile(
                dense: true,
                leading: const Icon(Icons.circle, size: 8),
                title: Text(reason),
              ),
          ],
        ),
      ),
    );
  }
}
