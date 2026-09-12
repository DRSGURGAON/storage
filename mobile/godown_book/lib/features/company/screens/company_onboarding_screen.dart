import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/tenant/tenant_provider.dart';
import '../../../shared/widgets/state_autocomplete_field.dart';
import '../../../shared/widgets/save_problem.dart';
import '../controllers/company_controller.dart';
import '../models/company_model.dart';
import '../services/drs_id_counter_service.dart';

/// First-run setup. Nothing else in the app can work until a company exists,
/// because every business row is stamped with its id.
class CompanyOnboardingScreen extends ConsumerStatefulWidget {
  const CompanyOnboardingScreen({super.key});

  @override
  ConsumerState<CompanyOnboardingScreen> createState() =>
      _CompanyOnboardingScreenState();
}

class _CompanyOnboardingScreenState
    extends ConsumerState<CompanyOnboardingScreen> {
  final _formKey = GlobalKey<FormState>();

  final _nameController = TextEditingController();
  final _addressController = TextEditingController();
  final _cityController = TextEditingController();
  final _stateController = TextEditingController();
  final _mobileController = TextEditingController();
  final _gstController = TextEditingController();

  bool _saving = false;

  @override
  void dispose() {
    _nameController.dispose();
    _addressController.dispose();
    _cityController.dispose();
    _stateController.dispose();
    _mobileController.dispose();
    _gstController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _saving = true);

    try {
      final drsId = await DrsIdCounterService.instance.assignNextDrsId();

      await CompanyController.instance.saveCompany(
        CompanyModel(
          companyName: _nameController.text.trim(),
          address: _addressController.text.trim(),
          city: _cityController.text.trim(),
          state: _stateController.text.trim(),
          mobile1: _mobileController.text.trim(),
          gstNumber: _gstController.text.trim(),
          companyCode: drsId,
        ),
      );

      ref.invalidate(currentCompanyProvider);

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Company created. Your customer ID is $drsId. Add your logo, '
            'signature and bank details in Company Settings before '
            'issuing a Warehouse Receipt.',
          ),
          duration: const Duration(seconds: 6),
        ),
      );

      context.go('/dashboard');
    } catch (error) {
      if (!mounted) return;

      setState(() => _saving = false);

      showSaveProblem(context, error);
    }
  }

  String? _required(String? value, String label) {
    if (value == null || value.trim().isEmpty) return '$label is required';
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Set Up Your Company'),
        centerTitle: true,
        automaticallyImplyLeading: false,
      ),

      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              'These details appear on every receipt, bill and gate pass '
              'you send. You can complete the rest later in Company Settings.',
              style: Theme.of(context).textTheme.bodyMedium,
            ),

            const SizedBox(height: 24),

            TextFormField(
              controller: _nameController,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Company name *',
                border: OutlineInputBorder(),
              ),
              validator: (value) => _required(value, 'Company name'),
            ),

            const SizedBox(height: 16),

            TextFormField(
              controller: _addressController,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'Address *',
                border: OutlineInputBorder(),
              ),
              validator: (value) => _required(value, 'Address'),
            ),

            const SizedBox(height: 16),

            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _cityController,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      labelText: 'City',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: StateAutocompleteField(
                    controller: _stateController,
                    decoration: const InputDecoration(
                      labelText: 'State',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
              ],
            ),

            const SizedBox(height: 16),

            TextFormField(
              controller: _mobileController,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: 'Mobile number *',
                border: OutlineInputBorder(),
              ),
              validator: (value) {
                final required = _required(value, 'Mobile number');
                if (required != null) return required;

                final digits = value!.replaceAll(RegExp(r'\D'), '');
                if (digits.length < 10) return 'Enter a valid mobile number';

                return null;
              },
            ),

            const SizedBox(height: 16),

            TextFormField(
              controller: _gstController,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(
                labelText: 'GST number',
                helperText: 'Required before you can raise a tax invoice',
                border: OutlineInputBorder(),
              ),
            ),

            const SizedBox(height: 28),

            SizedBox(
              height: 52,
              child: FilledButton.icon(
                onPressed: _saving ? null : _save,
                icon: _saving
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.arrow_forward),
                label: Text(_saving ? 'Creating...' : 'Create Company'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
