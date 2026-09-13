import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/widgets/state_autocomplete_field.dart';
import '../../../shared/widgets/save_problem.dart';
import '../models/customer_model.dart';
import '../repositories/customer_repository.dart';
import '../../../core/constants/id_proof_types.dart';
import '../../../shared/widgets/id_proof_field.dart';

/// Add / edit one customer. Pops with `true` after a successful save so
/// the list refreshes.
class CustomerFormScreen extends StatefulWidget {
  final String? editCustomerId;

  const CustomerFormScreen({super.key, this.editCustomerId});

  @override
  State<CustomerFormScreen> createState() => _CustomerFormScreenState();
}

class _CustomerFormScreenState extends State<CustomerFormScreen> {
  final _formKey = GlobalKey<FormState>();

  final _name = TextEditingController();
  final _mobile = TextEditingController();
  final _altMobile = TextEditingController();
  final _email = TextEditingController();
  final _gst = TextEditingController();
  final _pan = TextEditingController();
  final _address = TextEditingController();
  final _city = TextEditingController();
  final _state = TextEditingController();
  final _pincode = TextEditingController();
  final _idProofNumber = TextEditingController();

  /// The document they showed, chosen from [IdProofTypes.values].
  /// [_idProofCustomType] names it when that choice is "Other".
  String _idProofType = '';
  final _idProofCustomType = TextEditingController();
  final _notes = TextEditingController();

  CustomerModel? _existing;
  bool _loading = false;
  bool _saving = false;

  bool get _isEdit => widget.editCustomerId != null;

  @override
  void initState() {
    super.initState();
    if (_isEdit) _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final customer =
        await CustomerRepository.instance.getById(widget.editCustomerId!);
    if (!mounted) return;
    if (customer != null) {
      _existing = customer;
      _name.text = customer.customerName;
      _mobile.text = customer.mobileNumber;
      _altMobile.text = customer.altMobile;
      _email.text = customer.email;
      _gst.text = customer.gstNumber;
      _pan.text = customer.panNumber;
      _address.text = customer.address;
      _city.text = customer.city;
      _state.text = customer.state;
      _pincode.text = customer.pincode;
      final idProof = IdProofTypes.parse(customer.idProofType);
      _idProofType = idProof.type;
      _idProofCustomType.text = idProof.customType;
      _idProofNumber.text = customer.idProofNumber;
      _notes.text = customer.notes;
    }
    setState(() => _loading = false);
  }

  @override
  void dispose() {
    for (final c in [
      _name, _mobile, _altMobile, _email, _gst, _pan, _address, _city,
      _state, _pincode, _idProofCustomType, _idProofNumber, _notes,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _saving = true);

    try {
      final draft = CustomerModel(
        id: _existing?.id ?? '',
        customerName: _name.text,
        mobileNumber: _mobile.text,
        altMobile: _altMobile.text,
        email: _email.text,
        gstNumber: _gst.text,
        panNumber: _pan.text,
        address: _address.text,
        city: _city.text,
        state: _state.text,
        pincode: _pincode.text,
        idProofType: IdProof(
          type: _idProofType,
          customType: _idProofCustomType.text.trim(),
        ).effectiveType,
        idProofNumber: _idProofNumber.text,
        notes: _notes.text,
        isActive: _existing?.isActive ?? true,
        createdAt: _existing?.createdAt ?? '',
      );

      if (_existing == null) {
        await CustomerRepository.instance.create(draft);
      } else {
        await CustomerRepository.instance.update(
          _existing!.copyWith(
            customerName: draft.customerName.trim(),
            mobileNumber: draft.mobileNumber.trim(),
            altMobile: draft.altMobile.trim(),
            email: draft.email.trim(),
            gstNumber: draft.gstNumber.trim().toUpperCase(),
            panNumber: draft.panNumber.trim().toUpperCase(),
            address: draft.address.trim(),
            city: draft.city.trim(),
            state: draft.state.trim(),
            pincode: draft.pincode.trim(),
            idProofType: draft.idProofType.trim(),
            idProofNumber: draft.idProofNumber.trim(),
            notes: draft.notes.trim(),
          ),
        );
      }

      if (!mounted) return;
      context.pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      showSaveProblem(context, error);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit Customer' : 'New Customer')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Form(
              key: _formKey,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _section('Contact'),
                  TextFormField(
                    controller: _name,
                    textCapitalization: TextCapitalization.words,
                    autofocus: !_isEdit,
                    decoration: const InputDecoration(labelText: 'Customer / Firm name *'),
                    validator: (v) =>
                        (v ?? '').trim().isEmpty ? 'Name is required' : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _mobile,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(labelText: 'Mobile number'),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _altMobile,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(labelText: 'Alternate mobile'),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(labelText: 'Email'),
                  ),
                  const SizedBox(height: 20),
                  _section('Address'),
                  TextFormField(
                    controller: _address,
                    maxLines: 2,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(labelText: 'Address'),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: _city,
                          textCapitalization: TextCapitalization.words,
                          decoration: const InputDecoration(labelText: 'City'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextFormField(
                          controller: _pincode,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(labelText: 'Pincode'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  StateAutocompleteField(controller: _state, label: 'State'),
                  const SizedBox(height: 20),
                  _section('Tax & identity'),
                  TextFormField(
                    controller: _gst,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(labelText: 'GST number'),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _pan,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(labelText: 'PAN'),
                  ),
                  const SizedBox(height: 12),
                  IdProofField(
                    type: _idProofType,
                    onTypeChanged: (value) => setState(() => _idProofType = value),
                    numberController: _idProofNumber,
                    customTypeController: _idProofCustomType,
                    typeLabel: 'ID proof type',
                    numberLabel: 'ID proof number',
                  ),
                  const SizedBox(height: 20),
                  _section('Notes'),
                  TextFormField(
                    controller: _notes,
                    maxLines: 3,
                    decoration: const InputDecoration(
                      labelText: 'Notes',
                      hintText: 'Anything worth remembering about this customer',
                    ),
                  ),
                  const SizedBox(height: 28),
                  FilledButton.icon(
                    onPressed: _saving ? null : _save,
                    icon: _saving
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.save_outlined),
                    label: Text(_isEdit ? 'Save changes' : 'Save customer'),
                  ),
                  const SizedBox(height: 24),
                ],
              ),
            ),
    );
  }

  Widget _section(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        title.toUpperCase(),
        style: Theme.of(context).textTheme.labelMedium?.copyWith(
              color: Theme.of(context).colorScheme.primary,
              fontWeight: FontWeight.bold,
              letterSpacing: 0.5,
            ),
      ),
    );
  }
}
