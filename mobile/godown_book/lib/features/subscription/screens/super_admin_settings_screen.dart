import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/subscription/super_admin_scope.dart';
import '../models/subscription_plan_model.dart';
import '../models/subscription_settings_model.dart';
import '../repositories/subscription_plan_repository.dart';
import '../repositories/subscription_settings_repository.dart';
import '../services/platform_settings_service.dart';
import '../utils/payment_screenshot_picker.dart';

/// Section 9-10's Super Admin configuration screen - plan pricing, UPI/
/// QR, demo limits, watermark, and expiry-warning schedule. Every write
/// here goes through SubscriptionPlanRepository/
/// SubscriptionSettingsRepository, both of which independently enforce
/// SuperAdminScope on the write side (Section 32) - this screen's own
/// _isSuperAdmin gate is a UX convenience, not the actual security
/// boundary.
class SuperAdminSettingsScreen extends StatefulWidget {
  const SuperAdminSettingsScreen({super.key});

  @override
  State<SuperAdminSettingsScreen> createState() =>
      _SuperAdminSettingsScreenState();
}

class _SuperAdminSettingsScreenState extends State<SuperAdminSettingsScreen> {
  List<SubscriptionPlanModel> _plans = [];
  SubscriptionSettingsModel? _settings;
  bool _loading = true;
  bool _isSuperAdmin = false;

  final _upiIdController = TextEditingController();
  final _merchantNameController = TextEditingController();
  final _paymentInstructionsController = TextEditingController();
  final _demoLimitController = TextEditingController();
  final _watermarkTextController = TextEditingController();
  final _expiryWarningDaysController = TextEditingController();

  String? _qrImagePath;
  String? _qrImagePath2;
  final _qrLabel1Controller = TextEditingController();
  final _qrLabel2Controller = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _upiIdController.dispose();
    _merchantNameController.dispose();
    _paymentInstructionsController.dispose();
    _demoLimitController.dispose();
    _watermarkTextController.dispose();
    _expiryWarningDaysController.dispose();
    _qrLabel1Controller.dispose();
    _qrLabel2Controller.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    await SuperAdminScope.refresh();

    if (!SuperAdminScope.isSuperAdmin) {
      if (!mounted) return;
      setState(() {
        _isSuperAdmin = false;
        _loading = false;
      });
      return;
    }

    final plans = await SubscriptionPlanRepository.instance.getAllPlans();
    final settings = await SubscriptionSettingsRepository.instance.get();

    if (!mounted) return;

    setState(() {
      _plans = plans;
      _settings = settings;
      _qrImagePath = settings.qrImagePath;
      _qrImagePath2 = settings.qrImagePath2;
      _qrLabel1Controller.text = settings.qrLabel1 ?? '';
      _qrLabel2Controller.text = settings.qrLabel2 ?? '';
      _upiIdController.text = settings.upiId;
      _merchantNameController.text = settings.merchantName;
      _paymentInstructionsController.text = settings.paymentInstructions;
      _demoLimitController.text = '${settings.demoGenerationLimit}';
      _watermarkTextController.text = settings.watermarkText;
      _expiryWarningDaysController.text = settings.expiryWarningDaysCsv;
      _isSuperAdmin = true;
      _loading = false;
    });
  }

  Future<void> _pickQr({required int slot}) async {
    try {
      final result = await PaymentScreenshotPicker.pickQrImage();
      if (result == null) return;

      setState(() {
        if (slot == 1) {
          _qrImagePath = result.path;
        } else {
          _qrImagePath2 = result.path;
        }
      });
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  /// Reads a locally-picked QR image's bytes for publishing. Null when
  /// no image is set or the file has gone missing.
  Future<Uint8List?> _readBytes(String? path) async {
    if (path == null || path.isEmpty) return null;

    final file = File(path);
    if (!await file.exists()) return null;

    return file.readAsBytes();
  }

  Future<void> _saveSettings() async {
    final settings = _settings;
    if (settings == null) return;

    final demoLimit = int.tryParse(_demoLimitController.text.trim());
    if (demoLimit == null || demoLimit < 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a valid demo generation limit.')),
      );
      return;
    }

    try {
      await SubscriptionSettingsRepository.instance.save(
        settings.copyWith(
          upiId: _upiIdController.text.trim(),
          merchantName: _merchantNameController.text.trim(),
          qrImagePath: _qrImagePath,
          qrLabel1: _qrLabel1Controller.text.trim(),
          qrImagePath2: _qrImagePath2,
          qrLabel2: _qrLabel2Controller.text.trim(),
          paymentInstructions: _paymentInstructionsController.text.trim(),
          demoGenerationLimit: demoLimit,
          watermarkText: _watermarkTextController.text.trim(),
          expiryWarningDaysCsv: _expiryWarningDaysController.text.trim(),
        ),
      );

      // Publish to Firestore so EVERY company's install sees this QR
      // and UPI - saving locally alone would leave the QR on this
      // device only, which is exactly the bug this publish step fixes.
      // A failure here is reported separately from the local save,
      // because the local save genuinely did succeed and re-saving
      // would be the wrong instruction to give.
      try {
        await PlatformSettingsService.instance.publish(
          upiId: _upiIdController.text.trim(),
          merchantName: _merchantNameController.text.trim(),
          qr1: await _readBytes(_qrImagePath),
          qr2: await _readBytes(_qrImagePath2),
          qrLabel1: _qrLabel1Controller.text.trim(),
          qrLabel2: _qrLabel2Controller.text.trim(),
        );
      } catch (error) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Saved on this device, but could not publish to all '
              'companies: $error',
            ),
            duration: const Duration(seconds: 6),
          ),
        );
        return;
      }

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Settings saved and published.')),
      );
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _editPlanPrice(SubscriptionPlanModel plan) async {
    final priceController = TextEditingController(
      text: plan.price == 0 ? '' : plan.price.toStringAsFixed(0),
    );
    final discountController = TextEditingController(
      text: plan.discountAmount == 0 ? '' : plan.discountAmount.toStringAsFixed(0),
    );
    final taxController = TextEditingController(
      text: plan.taxPercent == 0 ? '' : plan.taxPercent.toStringAsFixed(0),
    );

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('${plan.name} - Pricing'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: priceController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Price (₹)'),
            ),
            TextField(
              controller: discountController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Discount (₹)'),
            ),
            TextField(
              controller: taxController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Tax (%)'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Save'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      await SubscriptionPlanRepository.instance.updatePlan(
        plan.copyWith(
          price: double.tryParse(priceController.text.trim()) ?? plan.price,
          discountAmount:
              double.tryParse(discountController.text.trim()) ?? 0,
          taxPercent: double.tryParse(taxController.text.trim()) ?? 0,
        ),
      );

      if (!mounted) return;
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _setRecommended(SubscriptionPlanModel plan) async {
    try {
      await SubscriptionPlanRepository.instance.setRecommended(plan.id);
      if (!mounted) return;
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop()
              ? context.pop()
              : context.go('/super-admin'),
        ),
        title: const Text('Plans & Settings'),
        centerTitle: true,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : !_isSuperAdmin
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Text(
                      'This area requires Super Admin access.',
                      textAlign: TextAlign.center,
                    ),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
                  children: [
                    Text('Plans', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    for (final plan in _plans)
                      Card(
                        child: ListTile(
                          title: Text(plan.name),
                          subtitle: Text(
                            '₹${plan.finalAmount.toStringAsFixed(0)} • '
                            '${plan.durationMonths} months'
                            '${plan.isRecommended ? ' • Recommended' : ''}',
                          ),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (!plan.isRecommended)
                                IconButton(
                                  icon: const Icon(Icons.star_border),
                                  tooltip: 'Mark Recommended',
                                  onPressed: () => _setRecommended(plan),
                                ),
                              IconButton(
                                icon: const Icon(Icons.edit_outlined),
                                onPressed: () => _editPlanPrice(plan),
                              ),
                            ],
                          ),
                        ),
                      ),

                    const SizedBox(height: 24),

                    Text('Payment Settings', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _upiIdController,
                      decoration: const InputDecoration(labelText: 'UPI ID'),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _merchantNameController,
                      decoration: const InputDecoration(labelText: 'Merchant Name'),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Both QR codes are shown together to the user, who '
                      'picks whichever one they want to pay to. Labels '
                      '(e.g. "SBI", "HDFC Bank") help the user tell them '
                      'apart - optional, but recommended.',
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(color: Colors.grey),
                    ),
                    const SizedBox(height: 12),

                    TextField(
                      controller: _qrLabel1Controller,
                      decoration: const InputDecoration(
                        labelText: 'QR 1 Label (optional)',
                        hintText: 'e.g. SBI',
                      ),
                    ),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: () => _pickQr(slot: 1),
                      icon: Icon(
                        _qrImagePath != null
                            ? Icons.check_circle
                            : Icons.qr_code,
                      ),
                      label: Text(
                        _qrImagePath != null ? 'QR 1 Uploaded' : 'Upload QR 1',
                      ),
                    ),
                    if (_qrImagePath != null) ...[
                      const SizedBox(height: 8),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Image.file(
                          File(_qrImagePath!),
                          width: 150,
                          height: 150,
                          fit: BoxFit.contain,
                        ),
                      ),
                    ],

                    const SizedBox(height: 20),

                    TextField(
                      controller: _qrLabel2Controller,
                      decoration: const InputDecoration(
                        labelText: 'QR 2 Label (optional)',
                        hintText: 'e.g. HDFC Bank',
                      ),
                    ),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: () => _pickQr(slot: 2),
                      icon: Icon(
                        _qrImagePath2 != null
                            ? Icons.check_circle
                            : Icons.qr_code,
                      ),
                      label: Text(
                        _qrImagePath2 != null ? 'QR 2 Uploaded' : 'Upload QR 2',
                      ),
                    ),
                    if (_qrImagePath2 != null) ...[
                      const SizedBox(height: 8),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Image.file(
                          File(_qrImagePath2!),
                          width: 150,
                          height: 150,
                          fit: BoxFit.contain,
                        ),
                      ),
                    ],

                    const SizedBox(height: 12),
                    TextField(
                      controller: _paymentInstructionsController,
                      maxLines: 3,
                      decoration: const InputDecoration(
                        labelText: 'Payment Instructions',
                      ),
                    ),

                    const SizedBox(height: 24),

                    Text('Limited Mode', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _demoLimitController,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Demo Generations Per Document Type',
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _watermarkTextController,
                      decoration: const InputDecoration(
                        labelText: 'Watermark Text',
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _expiryWarningDaysController,
                      decoration: const InputDecoration(
                        labelText: 'Expiry Warning Days (comma-separated)',
                        hintText: '30,15,7,3,1',
                      ),
                    ),

                    const SizedBox(height: 24),

                    SizedBox(
                      height: 52,
                      child: ElevatedButton(
                        onPressed: _saveSettings,
                        child: const Text('Save Settings'),
                      ),
                    ),
                  ],
                ),
    );
  }
}
