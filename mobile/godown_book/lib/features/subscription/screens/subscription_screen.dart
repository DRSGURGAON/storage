import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../../core/contact/contact_launcher.dart';
import '../../../core/subscription/subscription_access_service.dart';
import '../../../core/subscription/subscription_status.dart';
import '../../../core/tenant/tenant_scope.dart';
import '../../company/controllers/company_controller.dart';
import '../../company/models/company_model.dart';
import '../models/subscription_model.dart';
import '../models/subscription_plan_model.dart';
import '../models/subscription_settings_model.dart';
import '../services/platform_settings_service.dart';
import '../repositories/subscription_plan_repository.dart';
import '../repositories/subscription_repository.dart';
import '../repositories/subscription_settings_repository.dart';

/// Subscription status, pricing plans, and a scannable UPI QR - the
/// customer pays entirely off-app via their own UPI app, then sends
/// the payment screenshot to the Super Admin's own WhatsApp/phone
/// number shown here (SubscriptionSettingsModel's own doc comment:
/// "subscription payment is completely off-app... There is no
/// payment-processing field anywhere in this model"). This screen
/// never collects, processes, or submits any payment itself - it only
/// displays a static payment target, exactly like handing someone a
/// printed UPI QR code. Only Super Admin (SuperAdminAuthorizeScreen)
/// can move a subscription out of LIMITED after verifying that
/// screenshot.
class SubscriptionScreen extends StatefulWidget {
  const SubscriptionScreen({super.key});

  @override
  State<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

class _SubscriptionScreenState extends State<SubscriptionScreen> {
  SubscriptionModel? _subscription;
  List<SubscriptionPlanModel> _plans = [];
  SubscriptionSettingsModel? _settings;
  CompanyModel? _company;
  bool _loading = true;
  bool _isExpiringSoon = false;
  int? _daysUntilExpiry;

  Uint8List? _qrPng;
  Uint8List? _qrPng2;
  String? _qrError;

  /// Which uploaded QR the user currently has selected (1 or 2) - only
  /// matters when both are genuinely uploaded; defaults to the first.
  int _selectedQrSlot = 1;

  /// Labels published alongside the platform QRs. Empty when the
  /// QRs came from local files instead.
  String _platformLabel1 = '';
  String _platformLabel2 = '';

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    if (!TenantScope.isReady) {
      if (!mounted) return;
      setState(() => _loading = false);
      return;
    }

    final subscription = await SubscriptionRepository.instance
        .getOrCreateForCompany(TenantScope.companyId);
    final plans = await SubscriptionPlanRepository.instance.getActivePlans();
    final settings = await SubscriptionSettingsRepository.instance.get();
    final company = await CompanyController.instance.getCompany();
    final isExpiringSoon =
        await SubscriptionAccessService.instance.isExpiringSoon();
    final daysUntilExpiry =
        await SubscriptionAccessService.instance.daysUntilExpiry();

    if (!mounted) return;

    setState(() {
      _subscription = subscription;
      _plans = plans;
      _settings = settings;
      _company = company;
      _isExpiringSoon = isExpiringSoon;
      _daysUntilExpiry = daysUntilExpiry;
      _loading = false;
    });

    unawaited(_buildQrIfNeeded(settings));
  }

  /// Loads the payment QR to show.
  ///
  /// AUTHORITATIVE SOURCE IS FIRESTORE, not this device: the Super
  /// Admin publishes one platform-wide QR/UPI (PlatformSettingsService)
  /// and every company reads that same document. Local
  /// subscription_settings is only a fallback for the Super Admin's
  /// own device, which is where those files physically live.
  ///
  /// THERE IS DELIBERATELY NO FALLBACK TO THE SIGNED-IN COMPANY'S OWN
  /// UPI. An earlier version fell through to _company.upiId1 when
  /// nothing else was configured, which meant a customer opening this
  /// screen was shown a QR that paid THEMSELVES - they would scan it,
  /// send money to their own account, and both sides would believe the
  /// subscription had been paid. Showing an honest "not available"
  /// message is the only safe behaviour when the platform QR cannot be
  /// reached.
  Future<void> _buildQrIfNeeded(SubscriptionSettingsModel settings) async {
    final platform = await PlatformSettingsService.instance.fetch();

    if (platform != null && platform.hasAnyQr) {
      if (!mounted) return;
      setState(() {
        _qrPng = platform.qr1;
        _qrPng2 = platform.qr2;
        _platformLabel1 = platform.qrLabel1;
        _platformLabel2 = platform.qrLabel2;
        if (_selectedQrSlot == 1 && platform.qr1 == null) {
          _selectedQrSlot = 2;
        } else if (_selectedQrSlot == 2 && platform.qr2 == null) {
          _selectedQrSlot = 1;
        }
      });
      return;
    }

    // Local files - only ever present on the Super Admin's own device,
    // where the images were originally picked.
    final bytes1 = await _readQrFile(settings.qrImagePath);
    final bytes2 = await _readQrFile(settings.qrImagePath2);

    if (bytes1 != null || bytes2 != null) {
      if (!mounted) return;
      setState(() {
        _qrPng = bytes1;
        _qrPng2 = bytes2;
        if (_selectedQrSlot == 1 && bytes1 == null) {
          _selectedQrSlot = 2;
        } else if (_selectedQrSlot == 2 && bytes2 == null) {
          _selectedQrSlot = 1;
        }
      });
      return;
    }

    // Last resort: build a QR from the PLATFORM's own UPI id only -
    // never the signed-in company's. If the Super Admin has not
    // configured one, say so rather than showing something wrong.
    final payee = platform?.upiId.isNotEmpty == true
        ? platform!.upiId
        : settings.upiId;

    if (payee.isEmpty) {
      if (mounted) {
        setState(() => _qrError =
            'Payment details are not available right now. Please contact '
            'support using the buttons below.');
      }
      return;
    }

    final payeeName = platform?.merchantName.isNotEmpty == true
        ? platform!.merchantName
        : (settings.merchantName.isNotEmpty ? settings.merchantName : 'Payment');

    final upiLink =
        'upi://pay?pa=$payee&pn=${Uri.encodeComponent(payeeName)}&cu=INR';

    try {
      final doc = pw.Document();
      doc.addPage(
        pw.Page(
          pageFormat: const PdfPageFormat(220, 220, marginAll: 0),
          build: (context) => pw.Center(
            child: pw.BarcodeWidget(
              data: upiLink,
              barcode: pw.Barcode.qrCode(),
              drawText: false,
            ),
          ),
        ),
      );

      final bytes = await doc.save();

      await for (final page in Printing.raster(bytes, dpi: 200)) {
        final png = await page.toPng();
        if (!mounted) return;
        setState(() => _qrPng = png);
        break;
      }
    } catch (error) {
      if (mounted) setState(() => _qrError = 'Could not generate QR: $error');
    }
  }

  /// Reads an uploaded QR file's own bytes, or null if genuinely no
  /// path is set or the file no longer exists on disk.
  Future<Uint8List?> _readQrFile(String? path) async {
    if (path == null || path.isEmpty) return null;

    final file = File(path);
    if (!await file.exists()) return null;

    return file.readAsBytes();
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
        title: const Text('Subscription Status'),
        centerTitle: true,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _statusCard(context),
                  if (_isExpiringSoon) _expiryWarningBanner(context),

                  if (_subscription != null &&
                      _subscription!.status != SubscriptionStatus.limited)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: OutlinedButton.icon(
                        onPressed: () =>
                            context.push('/subscription-history'),
                        icon: const Icon(Icons.history),
                        label: const Text('View Subscription History'),
                      ),
                    ),

                  if (_plans.isNotEmpty) ...[
                    const SizedBox(height: 24),
                    Text(
                      'Choose Your Plan',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 8),
                    ..._plans.map((plan) => _planCard(context, plan)),
                  ],

                  const SizedBox(height: 24),
                  _paymentCard(context),
                ],
              ),
            ),
    );
  }

  Widget _statusCard(BuildContext context) {
    final subscription = _subscription;
    final status = subscription?.status ?? SubscriptionStatus.limited;

    final (icon, color) = switch (status) {
      SubscriptionStatus.active => (Icons.check_circle, Colors.green),
      SubscriptionStatus.expiringSoon => (Icons.access_time, Colors.orange),
      SubscriptionStatus.expired => (Icons.error, Colors.red),
      SubscriptionStatus.suspended => (Icons.block, Colors.red),
      SubscriptionStatus.cancelled => (Icons.cancel, Colors.red),
      _ => (Icons.info_outline, Colors.grey),
    };

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(icon, color: color, size: 32),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    status.label.toUpperCase(),
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: color,
                        ),
                  ),
                  if (subscription?.expiryDate != null)
                    Text(_expiryLine(subscription!)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _expiryWarningBanner(BuildContext context) {
    final days = _daysUntilExpiry ?? 0;

    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Card(
        color: Colors.orange.shade50,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: BorderSide(color: Colors.orange.shade200),
        ),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              const Icon(Icons.warning_amber_rounded, color: Colors.orange),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  days <= 0
                      ? 'Your subscription expires today.'
                      : 'Your subscription expires in $days day'
                          '${days == 1 ? '' : 's'}. Renew now to avoid '
                          'interruption.',
                  style: const TextStyle(fontSize: 13),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// One plan row - name/duration, price (struck-through original if
  /// a discount is genuinely configured on the plan, matching
  /// SubscriptionPlanModel.finalAmount's own discount handling), and
  /// a "Recommended" badge when the plan itself is flagged as such.
  /// Purely informational, matching this screen's own doc comment:
  /// there is no "Select Plan"/"Pay Now" action - the customer picks
  /// a plan, notes its price, then pays that amount via the QR/UPI
  /// below and tells Super Admin which plan they paid for in their
  /// WhatsApp message.
  Widget _planCard(BuildContext context, SubscriptionPlanModel plan) {
    final hasDiscount = plan.discountAmount > 0;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: plan.isRecommended
            ? BorderSide(
                color: Theme.of(context).colorScheme.tertiary,
                width: 1.5,
              )
            : BorderSide.none,
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        plan.name,
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      if (plan.isRecommended) ...[
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: Theme.of(context).colorScheme.tertiary,
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: const Text(
                            'RECOMMENDED',
                            style: TextStyle(
                              fontSize: 9,
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  Text(
                    '${plan.durationMonths} month'
                    '${plan.durationMonths == 1 ? '' : 's'}',
                    style: const TextStyle(fontSize: 12, color: Colors.grey),
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (hasDiscount)
                  Text(
                    '₹${plan.price.toStringAsFixed(0)}',
                    style: const TextStyle(
                      fontSize: 12,
                      color: Colors.grey,
                      decoration: TextDecoration.lineThrough,
                    ),
                  ),
                Text(
                  '₹${plan.finalAmount.toStringAsFixed(0)}',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.bold,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _paymentCard(BuildContext context) {
    final settings = _settings;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Pay Using UPI',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            const Text(
              'Scan with any UPI app, pay the amount for your chosen '
              'plan, then send the payment screenshot below - your '
              'subscription is activated once Super Admin verifies it.',
              style: TextStyle(fontSize: 12.5, color: Colors.grey),
            ),
            const SizedBox(height: 16),
            Center(child: _qrWidget()),
            const SizedBox(height: 16),
            if ((settings?.whatsappNumber.isNotEmpty ?? false))
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xff25D366),
                  ),
                  onPressed: () => ContactLauncher.openWhatsAppWithChoice(
                    context,
                    settings!.whatsappNumber,
                    message:
                        'Hi, I have made a payment for my Godown Book subscription. Sharing the screenshot.',
                  ),
                  icon: const Icon(Icons.chat),
                  label: const Text('Send Payment Screenshot on WhatsApp'),
                ),
              ),
            if ((settings?.supportPhoneNumber.isNotEmpty ?? false)) ...[
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () =>
                      ContactLauncher.call(settings!.supportPhoneNumber),
                  icon: const Icon(Icons.call),
                  label: const Text('Call For Support'),
                ),
              ),
            ],
            if ((settings?.paymentInstructions.trim().isNotEmpty ?? false)) ...[
              const SizedBox(height: 12),
              Text(
                settings!.paymentInstructions.trim(),
                style: const TextStyle(fontSize: 12, color: Colors.grey),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _qrWidget() {
    if (_qrError != null) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          _qrError!,
          style: const TextStyle(color: Colors.grey),
          textAlign: TextAlign.center,
        ),
      );
    }

    final hasQr1 = _qrPng != null;
    final hasQr2 = _qrPng2 != null;

    if (!hasQr1 && !hasQr2) {
      return const Padding(
        padding: EdgeInsets.all(32),
        child: SizedBox(
          width: 24,
          height: 24,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      );
    }

    final png = _selectedQrSlot == 2 && hasQr2 ? _qrPng2! : _qrPng!;

    // Platform labels win - they came from the same Firestore document
    // as the QRs actually being shown. Local settings are only relevant
    // when the QRs themselves came from local files.
    final label1 = _platformLabel1.trim().isNotEmpty
        ? _platformLabel1.trim()
        : ((_settings?.qrLabel1?.trim().isNotEmpty ?? false)
            ? _settings!.qrLabel1!.trim()
            : 'QR 1');
    final label2 = _platformLabel2.trim().isNotEmpty
        ? _platformLabel2.trim()
        : ((_settings?.qrLabel2?.trim().isNotEmpty ?? false)
            ? _settings!.qrLabel2!.trim()
            : 'QR 2');

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Only shown when the user genuinely has 2 QRs to choose
        // between - a single-QR install shows just the image, no
        // toggle for a choice that doesn't exist.
        if (hasQr1 && hasQr2) ...[
          SegmentedButton<int>(
            segments: [
              ButtonSegment(value: 1, label: Text(label1)),
              ButtonSegment(value: 2, label: Text(label2)),
            ],
            selected: {_selectedQrSlot},
            onSelectionChanged: (selection) {
              setState(() => _selectedQrSlot = selection.first);
            },
          ),
          const SizedBox(height: 12),
        ],
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            border: Border.all(color: Colors.grey.shade300),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Image.memory(png, width: 220, height: 220),
        ),
      ],
    );
  }

  String _expiryLine(SubscriptionModel subscription) {
    final expiry = DateTime.tryParse(subscription.expiryDate ?? '');
    if (expiry == null) return '';

    final daysRemaining = expiry.difference(DateTime.now()).inDays;
    final dateLabel =
        '${expiry.day.toString().padLeft(2, '0')}/'
        '${expiry.month.toString().padLeft(2, '0')}/${expiry.year}';

    if (daysRemaining < 0) return 'Expired on $dateLabel';

    return 'Expires $dateLabel ($daysRemaining days remaining)';
  }
}
