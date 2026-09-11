import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/constants/default_terms.dart';
import '../../../core/document_terms/document_terms_repository.dart';
import '../../../core/subscription/document_type.dart';
import '../../billing/repositories/billing_repository.dart';
import '../../company/controllers/company_controller.dart';
import '../../consignment/repositories/consignment_repository.dart';
import '../../incidents/repositories/incident_repository.dart';
import '../../signature/models/signature_request_model.dart';
import '../../signature/repositories/signature_repository.dart';
import '../../signature/screens/signature_request_screen.dart';
import '../../release/repositories/goods_release_repository.dart';
import '../models/storage_booking_model.dart';
import '../repositories/storage_booking_repository.dart';
import '../repositories/storage_photo_repository.dart';
import 'storage_booking_list_screen.dart';
import 'storage_booking_pdf_screen.dart';

/// One storage record at a glance: customer, goods still with us,
/// charges, and the papers that hang off it.
class StorageBookingDetailScreen extends StatefulWidget {
  final String bookingId;

  const StorageBookingDetailScreen({super.key, required this.bookingId});

  @override
  State<StorageBookingDetailScreen> createState() => _StorageBookingDetailScreenState();
}

class _StorageBookingDetailScreenState extends State<StorageBookingDetailScreen> {
  static final _dateFormat = DateFormat('dd MMM yyyy');

  StorageBookingModel? _booking;
  int _photoCount = 0;
  int _releaseCount = 0;
  double _outstanding = 0;
  DepositSummary _deposit = const DepositSummary();
  int _incidentCount = 0;
  int _biltyCount = 0;
  List<SignatureRequestModel> _signatures = const [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final booking = await StorageBookingRepository.instance.getById(widget.bookingId);

    var photos = 0;
    var releases = 0;
    var outstanding = 0.0;
    var deposit = const DepositSummary();
    var incidents = 0;
    var bilties = 0;
    var signatures = const <SignatureRequestModel>[];
    if (booking != null) {
      signatures = await SignatureRepository.instance
          .getForDocument(DocumentType.storageReceipt, booking.id);
      photos = await StoragePhotoRepository.instance.countForBooking(booking.id);
      releases =
          (await GoodsReleaseRepository.instance.getForBooking(booking.id)).length;
      deposit = await BillingRepository.instance
          .depositForBooking(booking.id, agreed: booking.securityDeposit);
      incidents =
          (await IncidentRepository.instance.getForBooking(booking.id)).length;
      bilties =
          (await ConsignmentRepository.instance.getForBooking(booking.id)).length;
      if (booking.customerId.isNotEmpty) {
        final balance =
            await BillingRepository.instance.balanceForCustomer(booking.customerId);
        outstanding = balance.outstanding;
      }
    }

    if (!mounted) return;
    setState(() {
      _booking = booking;
      _photoCount = photos;
      _releaseCount = releases;
      _outstanding = outstanding;
      _deposit = deposit;
      _incidentCount = incidents;
      _biltyCount = bilties;
      _signatures = signatures;
      _loading = false;
    });
  }

  String _date(String iso) {
    final d = DateTime.tryParse(iso);
    return d == null ? '-' : _dateFormat.format(d);
  }

  static String _qty(double v) =>
      v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(2);

  @override
  Widget build(BuildContext context) {
    final b = _booking;

    return Scaffold(
      appBar: AppBar(
        title: Text(b?.bookingNo ?? 'Storage'),
        centerTitle: true,
        actions: [
          if (b != null)
            IconButton(
              icon: const Icon(Icons.more_vert),
              onPressed: () => showBookingActions(context, b, () {
                if (!mounted) return;
                _load();
              }),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : b == null
              ? const Center(child: Text('Storage record not found.'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      _headerCard(b),
                      const SizedBox(height: 12),
                      _actionsCard(b),
                      const SizedBox(height: 12),
                      _papersCard(b),
                      const SizedBox(height: 12),
                      _itemsCard(b),
                      const SizedBox(height: 12),
                      _rentCard(b),
                      if (b.notes.trim().isNotEmpty) ...[
                        const SizedBox(height: 12),
                        Card(
                          child: ListTile(
                            leading: const Icon(Icons.sticky_note_2_outlined),
                            title: const Text('Notes'),
                            subtitle: Text(b.notes),
                          ),
                        ),
                      ],
                      const SizedBox(height: 24),
                    ],
                  ),
                ),
    );
  }

  Widget _headerCard(StorageBookingModel b) {
    final color = statusColor(b.status);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    b.customerName,
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    b.status.label,
                    style: TextStyle(fontWeight: FontWeight.w600, color: color, fontSize: 12),
                  ),
                ),
              ],
            ),
            if (b.customerPhone.isNotEmpty) Text(b.customerPhone),
            if (b.customerFullAddress.isNotEmpty)
              Text(b.customerFullAddress, style: const TextStyle(color: Colors.grey)),
            const Divider(height: 20),
            _row('Entry date', _date(b.bookingDate)),
            _row('Storage from', _date(b.storageStartDate)),
            _row('Expected upto', b.expectedEndDate.isEmpty ? 'Open' : _date(b.expectedEndDate)),
            if (b.actualEndDate.isNotEmpty) _row('Released on', _date(b.actualEndDate)),
            _row('Location', b.locationName.isEmpty ? '-' : b.locationName),
            if (b.vehicleNumber.isNotEmpty) _row('Vehicle', b.vehicleNumber),
            if (b.receivedBy.isNotEmpty) _row('Received by', b.receivedBy),
          ],
        ),
      ),
    );
  }

  /// What an operator does next with these goods.
  Widget _actionsCard(StorageBookingModel b) {
    return Card(
      child: Column(
        children: [
          ListTile(
            leading: const Icon(Icons.receipt_long_outlined),
            title: const Text('Make Storage Bill'),
            subtitle: Text(b.rentBilledUpto.isEmpty
                ? 'Rent has not been billed yet'
                : 'Billed to ${_date(b.rentBilledUpto)}'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              await context.push('/bill-create', extra: b.id);
              _load();
            },
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.payments_outlined),
            title: const Text('Receive Payment'),
            subtitle: Text(_outstanding > 0
                ? '₹${_outstanding.toStringAsFixed(0)} outstanding'
                : 'Nothing outstanding'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              final paymentId = await context
                  .push('/payment-create', extra: {'customerId': b.customerId});
              if (paymentId is String && mounted) {
                await context.push('/receipt-pdf', extra: paymentId);
              }
              _load();
            },
          ),
          if (!_deposit.isEmpty) ...[
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.savings_outlined),
              title: const Text('Security Deposit'),
              subtitle: Text(_depositSubtitle),
              trailing: const Icon(Icons.chevron_right),
              onTap: () async {
                await context.push('/deposit', extra: b.id);
                _load();
              },
            ),
          ],
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.outbox_outlined),
            title: const Text('Release Goods'),
            subtitle: Text(_releaseCount == 0
                ? 'Nothing has gone out yet'
                : '$_releaseCount release${_releaseCount == 1 ? '' : 's'} so far'),
            trailing: const Icon(Icons.chevron_right),
            onTap: b.status.isOpen
                ? () async {
                    final releaseId = await context.push('/release-create', extra: b.id);
                    if (releaseId is String && mounted) {
                      await context.push('/release-pdf', extra: releaseId);
                    }
                    _load();
                  }
                : null,
          ),
          const Divider(height: 1),
          ListTile(
            leading: Icon(
              _signatureSigned ? Icons.verified_outlined : Icons.draw_outlined,
              color: _signatureSigned ? Colors.green.shade700 : null,
            ),
            title: const Text('Customer Signature'),
            subtitle: Text(_signatureSubtitle),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _openSignature(b),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.photo_camera_outlined),
            title: const Text('Photos'),
            subtitle: Text(_photoCount == 0
                ? 'Add photos of the goods and their condition'
                : '$_photoCount photo${_photoCount == 1 ? '' : 's'}'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              await context.push('/storage-photos', extra: b.id);
              _load();
            },
          ),
          if (b.customerId.isNotEmpty) ...[
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.account_balance_wallet_outlined),
              title: const Text('Customer Statement'),
              subtitle: const Text('Bills, payments and the balance'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () async {
                await context.push('/statement', extra: b.customerId);
                _load();
              },
            ),
          ],
        ],
      ),
    );
  }

  String get _depositSubtitle {
    if (_deposit.received <= 0.004) {
      return '₹${_deposit.agreed.toStringAsFixed(0)} agreed - no receipt yet';
    }
    if (_deposit.held <= 0.004) return 'Settled in full';
    return '₹${_deposit.held.toStringAsFixed(0)} held with you';
  }

  bool get _signatureSigned => _signatures.any((s) => s.isSigned);

  String get _signatureSubtitle {
    final signed = _signatures.where((s) => s.isSigned);
    if (signed.isNotEmpty) {
      return 'Signed on ${_date(signed.first.signedAt)}';
    }
    final pending =
        _signatures.where((s) => s.status == SignatureStatus.pending && !s.hasExpired);
    if (pending.isNotEmpty) return 'Link sent - waiting for the customer';
    return 'Send a link and take it on their phone';
  }

  /// Opens the signature screen with what the customer will be shown:
  /// the storage details and the terms that are on their receipt.
  Future<void> _openSignature(StorageBookingModel b) async {
    final company = await CompanyController.instance.getCompany();
    final custom = await DocumentTermsRepository.instance
        .getTerms(DocumentTermsType.storageReceipt);

    final terms = b.terms.trim().isNotEmpty
        ? b.terms.trim()
        : custom.isNotEmpty
            ? custom
            : (company?.defaultTerms.trim().isNotEmpty ?? false)
                ? company!.defaultTerms.trim()
                : DefaultStorageTerms.terms.join('\n');

    if (!mounted) return;

    await context.push(
      '/signature',
      extra: SignatureRequestArgs(
        documentType: DocumentType.storageReceipt,
        documentId: b.id,
        documentNo: b.bookingNo,
        customerName: b.customerName,
        customerPhone: b.customerPhone,
        title: 'Storage Receipt',
        details: [
          SignatureDetail('Receipt No.', b.bookingNo),
          SignatureDetail('Date', _date(b.bookingDate)),
          SignatureDetail('Goods', b.items.isEmpty
              ? (b.goodsDescription.isEmpty ? '-' : b.goodsDescription)
              : b.items
                  .map((i) => '${i.itemName} - ${_qty(i.quantity)} ${i.unit}')
                  .join(', ')),
          SignatureDetail('Total packages',
              b.totalPackages > 0 ? '${b.totalPackages}' : _qty(b.totalQuantity)),
          SignatureDetail('Stored at', b.locationName.isEmpty ? '-' : b.locationName),
          SignatureDetail('Storage from', _date(b.storageStartDate)),
          SignatureDetail(
            'Storage charge',
            b.rentRate > 0
                ? '₹${_qty(b.rentRate)} ${b.rentUnitLabel.isEmpty ? b.rentBasis.rateHint : b.rentUnitLabel}'
                : 'As agreed',
          ),
          if (b.securityDeposit > 0)
            SignatureDetail('Security deposit', '₹${_qty(b.securityDeposit)}'),
        ],
        terms: terms,
      ),
    );

    _load();
  }

  Widget _papersCard(StorageBookingModel b) {
    Widget tile(IconData icon, String title, String subtitle, BookingDocumentKind kind) {
      return ListTile(
        leading: Icon(icon),
        title: Text(title),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.chevron_right),
        onTap: () async {
          await context.push('/storage-pdf', extra: {'id': b.id, 'kind': kind.name});
          _load();
        },
      );
    }

    return Card(
      child: Column(
        children: [
          tile(Icons.picture_as_pdf_outlined, 'Storage Receipt', 'Customer and office copies', BookingDocumentKind.receipt),
          const Divider(height: 1),
          tile(Icons.list_alt_outlined, 'Goods List', 'What is stored, what has gone out', BookingDocumentKind.inventory),
          const Divider(height: 1),
          tile(Icons.handshake_outlined, 'Storage Agreement', 'Terms both sides sign', BookingDocumentKind.agreement),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.fire_truck_outlined),
            title: const Text('Bilty / Lorry Receipt'),
            subtitle: Text(_biltyCount == 0
                ? 'When the goods travel by truck'
                : '$_biltyCount bilty${_biltyCount == 1 ? '' : 's'} on this record'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              final id = await context.push('/bilty-create', extra: b.id);
              if (id is String && mounted) {
                await context.push('/bilty-pdf', extra: id);
              }
              _load();
            },
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.assignment_ind_outlined),
            title: const Text('Authority Letter / Indemnity'),
            subtitle: const Text('Someone else is collecting, or the receipt is lost'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              await context.push('/handover-paper', extra: b.id);
              _load();
            },
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.mail_outline),
            title: const Text('Send a Notice'),
            subtitle: Text(_outstanding > 0
                ? 'Rent is unpaid - remind, warn, or give notice'
                : 'Nothing is outstanding right now'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              final noticeId = await context
                  .push('/notice-create', extra: {'bookingId': b.id});
              if (noticeId is String && mounted) {
                await context.push('/notice-pdf', extra: noticeId);
              }
              _load();
            },
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.report_gmailerrorred_outlined),
            title: const Text('Damage / Loss Report'),
            subtitle: Text(_incidentCount == 0
                ? 'Write it down the same day, with photos'
                : '$_incidentCount report${_incidentCount == 1 ? '' : 's'} on this record'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              final id = await context.push('/incident-create', extra: b.id);
              if (id is String && mounted) {
                await context.push('/incident-pdf', extra: id);
              }
              _load();
            },
          ),
        ],
      ),
    );
  }

  Widget _itemsCard(StorageBookingModel b) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.inventory_2_outlined, size: 20),
                const SizedBox(width: 8),
                const Text('Goods', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                const Spacer(),
                Text(
                  b.items.isEmpty
                      ? '${b.totalPackages} pkgs'
                      : '${_qty(b.remainingQuantity)} of ${_qty(b.totalQuantity)} in stock',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ],
            ),
            if (b.goodsDescription.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(b.goodsDescription, style: const TextStyle(color: Colors.grey)),
            ],
            if (b.items.isNotEmpty) const Divider(height: 20),
            for (final item in b.items)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(item.itemName, style: const TextStyle(fontWeight: FontWeight.w500)),
                          if (item.description.isNotEmpty)
                            Text(item.description, style: const TextStyle(fontSize: 12, color: Colors.grey)),
                        ],
                      ),
                    ),
                    Text(
                      '${_qty(item.remainingQty)} / ${_qty(item.quantity)} ${item.unit}',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: item.isFullyReleased ? Colors.grey : null,
                        decoration: item.isFullyReleased ? TextDecoration.lineThrough : null,
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _rentCard(StorageBookingModel b) {
    final rate = b.rentRate > 0
        ? '₹${_qty(b.rentRate)} ${b.rentUnitLabel.isEmpty ? b.rentBasis.label.toLowerCase() : b.rentUnitLabel}'
        : 'Not set';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.currency_rupee, size: 20),
                SizedBox(width: 8),
                Text('Rent', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
              ],
            ),
            const SizedBox(height: 8),
            _row('Rent', rate),
            if (b.areaSqft > 0) _row('Area', '${_qty(b.areaSqft)} sq.ft'),
            _row('Security deposit', b.securityDeposit > 0 ? '₹${_qty(b.securityDeposit)}' : 'Nil'),
            _row('Rent billed upto', b.rentBilledUpto.isEmpty ? 'Not billed yet' : _date(b.rentBilledUpto)),
          ],
        ),
      ),
    );
  }

  Widget _row(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          SizedBox(width: 130, child: Text(label, style: const TextStyle(color: Colors.grey))),
          Expanded(child: Text(value, style: const TextStyle(fontWeight: FontWeight.w500))),
        ],
      ),
    );
  }
}
