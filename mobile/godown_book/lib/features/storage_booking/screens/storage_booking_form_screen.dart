import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/customer/customer_lookup_service.dart';
import '../../../core/utils/id_generator.dart';
import '../../../shared/widgets/customer_name_field.dart';
import '../../../shared/widgets/state_autocomplete_field.dart';
import '../../../shared/widgets/save_problem.dart';
import '../../master/models/storage_location_model.dart';
import '../../master/repositories/storage_location_repository.dart';
import '../../voice_entry/models/voice_entry_draft.dart';
import '../../voice_entry/models/voice_reading.dart';
import '../../voice_entry/services/voice_entry_parser.dart';
import '../../voice_entry/widgets/voice_entry_sheet.dart';
import '../../voice_entry/widgets/voice_fill.dart';
import '../models/booking_item_model.dart';
import '../models/storage_booking_model.dart';
import '../models/storage_status.dart';
import '../repositories/storage_booking_repository.dart';

/// Record or edit one customer's goods in storage. Pops with the saved
/// record's id (a String) after a successful save.
class StorageBookingFormScreen extends StatefulWidget {
  final String? editBookingId;

  /// Open with the voice sheet already up - the dashboard's "Speak"
  /// tab lands here.
  final bool openVoice;

  const StorageBookingFormScreen({
    super.key,
    this.editBookingId,
    this.openVoice = false,
  });

  @override
  State<StorageBookingFormScreen> createState() => _StorageBookingFormScreenState();
}

class _StorageBookingFormScreenState extends State<StorageBookingFormScreen>
    with VoiceFill {
  static final _dateFormat = DateFormat('dd MMM yyyy');

  late StorageBookingModel _draft;
  bool _loadingExisting = false;
  bool _saving = false;

  final _customerName = TextEditingController();
  final _customerPhone = TextEditingController();
  final _customerGst = TextEditingController();
  final _customerAddress = TextEditingController();
  final _customerCity = TextEditingController();
  final _customerState = TextEditingController();
  final _customerPincode = TextEditingController();
  final _customerIdProof = TextEditingController();
  final _rentRate = TextEditingController();
  final _rentUnitLabel = TextEditingController();
  final _areaSqft = TextEditingController();
  final _securityDeposit = TextEditingController();
  final _totalPackages = TextEditingController();
  final _goodsDescription = TextEditingController();
  final _declaredValue = TextEditingController();
  final _insuranceNote = TextEditingController();
  final _vehicleNumber = TextEditingController();
  final _driverName = TextEditingController();
  final _receivedBy = TextEditingController();
  final _notes = TextEditingController();
  final _terms = TextEditingController();

  String _customerId = '';
  DateTime _bookingDate = DateTime.now();
  DateTime _storageStart = DateTime.now();
  DateTime? _expectedEnd;
  RentBasis _rentBasis = RentBasis.monthly;
  String _locationId = '';
  String _locationName = '';
  List<StorageLocationModel> _locations = const [];
  final List<BookingItemModel> _items = [];

  bool get _isEdit => widget.editBookingId != null;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now().toIso8601String();
    _draft = StorageBookingModel(
      id: IdGenerator.generateId(),
      bookingDate: now,
      customerName: '',
      storageStartDate: now,
      createdAt: '',
    );
    _loadLocations();
    if (_isEdit) {
      _loadingExisting = true;
      _loadForEdit(widget.editBookingId!);
    } else if (widget.openVoice) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _fillByVoice();
      });
    }
  }

  Future<void> _loadLocations() async {
    final locations = await StorageLocationRepository.instance.getAll();
    if (!mounted) return;
    setState(() => _locations = locations);
  }

  Future<void> _loadForEdit(String id) async {
    final existing = await StorageBookingRepository.instance.getById(id);
    if (!mounted) return;
    setState(() {
      if (existing != null) {
        _draft = existing;
        _applyDraft();
      }
      _loadingExisting = false;
    });
  }

  void _applyDraft() {
    final d = _draft;
    _customerId = d.customerId;
    _customerName.text = d.customerName;
    _customerPhone.text = d.customerPhone;
    _customerGst.text = d.customerGst;
    _customerAddress.text = d.customerAddress;
    _customerCity.text = d.customerCity;
    _customerState.text = d.customerState;
    _customerPincode.text = d.customerPincode;
    _customerIdProof.text = d.customerIdProof;
    _bookingDate = DateTime.tryParse(d.bookingDate) ?? DateTime.now();
    _storageStart = DateTime.tryParse(d.storageStartDate) ?? _bookingDate;
    _expectedEnd = DateTime.tryParse(d.expectedEndDate);
    _rentBasis = d.rentBasis;
    _rentRate.text = d.rentRate == 0 ? '' : _num(d.rentRate);
    _rentUnitLabel.text = d.rentUnitLabel;
    _areaSqft.text = d.areaSqft == 0 ? '' : _num(d.areaSqft);
    _securityDeposit.text = d.securityDeposit == 0 ? '' : _num(d.securityDeposit);
    _totalPackages.text = d.totalPackages == 0 ? '' : '${d.totalPackages}';
    _goodsDescription.text = d.goodsDescription;
    _declaredValue.text = d.declaredValue == 0 ? '' : _num(d.declaredValue);
    _insuranceNote.text = d.insuranceNote;
    _vehicleNumber.text = d.vehicleNumber;
    _driverName.text = d.driverName;
    _receivedBy.text = d.receivedBy;
    _notes.text = d.notes;
    _terms.text = d.terms;
    _locationId = d.locationId;
    _locationName = d.locationName;
    _items
      ..clear()
      ..addAll(d.items);
  }

  static String _num(double v) =>
      v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toString();

  @override
  void dispose() {
    for (final c in [
      _customerName, _customerPhone, _customerGst, _customerAddress, _customerCity,
      _customerState, _customerPincode, _customerIdProof, _rentRate, _rentUnitLabel,
      _areaSqft, _securityDeposit, _totalPackages, _goodsDescription, _declaredValue,
      _insuranceNote, _vehicleNumber, _driverName, _receivedBy, _notes, _terms,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  void _applySuggestion(CustomerSuggestion s) {
    setState(() {
      _customerId = s.customerId;
      if (_customerPhone.text.trim().isEmpty) _customerPhone.text = s.phone;
      if (_customerGst.text.trim().isEmpty) _customerGst.text = s.gst;
      if (_customerAddress.text.trim().isEmpty) _customerAddress.text = s.address;
      if (_customerCity.text.trim().isEmpty) _customerCity.text = s.city;
      if (_customerState.text.trim().isEmpty) _customerState.text = s.state;
      if (_customerPincode.text.trim().isEmpty) _customerPincode.text = s.pincode;
    });
  }

  /// Puts what the operator accepted on the voice sheet into the form.
  /// Only the rows they ticked are touched, the rest is left exactly as
  /// they typed it, and nothing is saved - Save is still their tap.
  Future<void> _fillByVoice() async {
    final spoken = await VoiceEntrySheet.show<VoiceEntryDraft>(
      context,
      recipe: VoiceRecipe(
        example: 'Rajesh Kumar, 9876500001, aaj se, ek almari do palang '
            'teen carton, mahine ka teen hazaar, paanch hazaar advance',
        parse: (text) => VoiceEntryParser(bookingId: _draft.id).parse(text),
      ),
    );
    if (spoken == null || !mounted) return;

    setState(() {
      markVoice(spoken.fields);
      if (spoken.customerName != null) {
        _customerName.text = spoken.customerName!;
        _customerId = '';
        nameSeed++;
      }
      if (spoken.customerPhone != null) {
        _customerPhone.text = spoken.customerPhone!;
      }
      if (spoken.customerCity != null) {
        _customerCity.text = spoken.customerCity!;
      }
      if (spoken.customerPincode != null) {
        _customerPincode.text = spoken.customerPincode!;
      }
      if (spoken.storageStart != null) _storageStart = spoken.storageStart!;
      if (spoken.items.isNotEmpty) {
        for (final item in spoken.items) {
          _items.add(item.copyWith(
            bookingId: _draft.id,
            sortOrder: _items.length,
          ));
        }
      }
      if (spoken.rentRate != null) _rentRate.text = _num(spoken.rentRate!);
      if (spoken.rentBasis != null) _rentBasis = spoken.rentBasis!;
      if (spoken.securityDeposit != null) {
        _securityDeposit.text = _num(spoken.securityDeposit!);
      }
      if (spoken.declaredValue != null) {
        _declaredValue.text = _num(spoken.declaredValue!);
      }
      if (spoken.vehicleNumber != null) {
        _vehicleNumber.text = spoken.vehicleNumber!;
      }
    });

    announceVoice(spoken.fields.length);
  }

  Future<void> _pickDate({
    required DateTime initial,
    required ValueChanged<DateTime> onPicked,
  }) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2015),
      lastDate: DateTime(2100),
    );
    if (picked != null) setState(() => onPicked(picked));
  }

  double _parse(TextEditingController c) =>
      double.tryParse(c.text.trim().replaceAll(',', '')) ?? 0;

  Future<void> _save() async {
    if (_customerName.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter the customer name.')),
      );
      return;
    }
    if (_items.isEmpty && _goodsDescription.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Add at least one item, or describe the goods.')),
      );
      return;
    }

    setState(() => _saving = true);

    final packagesTyped = int.tryParse(_totalPackages.text.trim()) ?? 0;
    final packagesFromItems = _items.fold(0.0, (sum, i) => sum + i.quantity).round();

    final booking = _draft.copyWith(
      bookingDate: _bookingDate.toIso8601String(),
      customerId: _customerId,
      customerName: _customerName.text.trim(),
      customerPhone: _customerPhone.text.trim(),
      customerGst: _customerGst.text.trim().toUpperCase(),
      customerAddress: _customerAddress.text.trim(),
      customerCity: _customerCity.text.trim(),
      customerState: _customerState.text.trim(),
      customerPincode: _customerPincode.text.trim(),
      customerIdProof: _customerIdProof.text.trim(),
      locationId: _locationId,
      locationName: _locationName,
      storageStartDate: _storageStart.toIso8601String(),
      expectedEndDate: _expectedEnd?.toIso8601String() ?? '',
      rentBasis: _rentBasis,
      rentRate: _parse(_rentRate),
      rentUnitLabel: _rentUnitLabel.text.trim(),
      areaSqft: _parse(_areaSqft),
      securityDeposit: _parse(_securityDeposit),
      totalPackages: packagesTyped > 0 ? packagesTyped : packagesFromItems,
      goodsDescription: _goodsDescription.text.trim(),
      declaredValue: _parse(_declaredValue),
      insuranceNote: _insuranceNote.text.trim(),
      vehicleNumber: _vehicleNumber.text.trim().toUpperCase(),
      driverName: _driverName.text.trim(),
      receivedBy: _receivedBy.text.trim(),
      notes: _notes.text.trim(),
      terms: _terms.text.trim(),
      items: List.of(_items),
    );

    try {
      final saved = await StorageBookingRepository.instance.save(booking);
      voiceFilled.clear();
      if (!mounted) return;
      context.pop(saved.id);
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      showSaveProblem(context, error);
    }
  }

  Future<void> _editItem({BookingItemModel? existing, int? index}) async {
    final name = TextEditingController(text: existing?.itemName ?? '');
    final description = TextEditingController(text: existing?.description ?? '');
    final quantity = TextEditingController(
      text: existing == null ? '1' : _num(existing.quantity),
    );
    final unit = TextEditingController(text: existing?.unit ?? 'Nos');
    final weight = TextEditingController(text: existing?.weight ?? '');
    final marks = TextEditingController(text: existing?.marks ?? '');
    final condition = TextEditingController(text: existing?.conditionNote ?? '');

    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(existing == null ? 'Add Item' : 'Edit Item'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: name,
                autofocus: existing == null,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(labelText: 'Item name *'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: description,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(labelText: 'Description'),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: quantity,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(labelText: 'Quantity'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextField(
                      controller: unit,
                      decoration: const InputDecoration(labelText: 'Unit', hintText: 'Nos / Bags / Cartons'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              TextField(
                controller: weight,
                decoration: const InputDecoration(labelText: 'Weight (optional)', hintText: '250 kg'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: marks,
                decoration: const InputDecoration(labelText: 'Marks / Lot no. (optional)'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: condition,
                decoration: const InputDecoration(labelText: 'Condition on receipt (optional)'),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              if (name.text.trim().isEmpty) return;
              Navigator.pop(dialogContext, true);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );

    if (saved != true) return;

    final qty = double.tryParse(quantity.text.trim()) ?? 1;
    final item = (existing ??
            BookingItemModel(id: IdGenerator.generateId(), bookingId: _draft.id, itemName: ''))
        .copyWith(
      itemName: name.text.trim(),
      description: description.text.trim(),
      quantity: qty <= 0 ? 1 : qty,
      unit: unit.text.trim().isEmpty ? 'Nos' : unit.text.trim(),
      weight: weight.text.trim(),
      marks: marks.text.trim(),
      conditionNote: condition.text.trim(),
    );

    setState(() {
      if (index == null) {
        _items.add(item);
      } else {
        _items[index] = item;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_isEdit ? 'Edit Storage' : 'New Storage'),
        centerTitle: true,
        actions: [
          IconButton(
            tooltip: 'Bol kar bhariye',
            icon: const Icon(Icons.mic_none),
            onPressed: _loadingExisting ? null : _fillByVoice,
          ),
        ],
      ),
      body: _loadingExisting
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                OutlinedButton.icon(
                  onPressed: _fillByVoice,
                  icon: const Icon(Icons.mic_none),
                  label: const Text('Bol kar bhariye'),
                ),
                const SizedBox(height: 18),
                _section('Storage'),
                Row(
                  children: [
                    Expanded(
                      child: _dateTile(
                        'Entry date',
                        _bookingDate,
                        () => _pickDate(initial: _bookingDate, onPicked: (d) => _bookingDate = d),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _dateTile(
                        'Storage from',
                        _storageStart,
                        () => _pickDate(initial: _storageStart, onPicked: (d) => _storageStart = d),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _dateTile(
                  'Expected upto (optional)',
                  _expectedEnd,
                  () => _pickDate(
                    initial: _expectedEnd ?? _storageStart,
                    onPicked: (d) => _expectedEnd = d,
                  ),
                  onClear: _expectedEnd == null ? null : () => setState(() => _expectedEnd = null),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: _locations.any((l) => l.id == _locationId) ? _locationId : '',
                  decoration: const InputDecoration(labelText: 'Storage location'),
                  items: [
                    const DropdownMenuItem(value: '', child: Text('Not specified')),
                    for (final l in _locations)
                      DropdownMenuItem(value: l.id, child: Text(l.name)),
                  ],
                  onChanged: (value) => setState(() {
                    _locationId = value ?? '';
                    _locationName = _locations
                        .where((l) => l.id == _locationId)
                        .map((l) => l.name)
                        .firstOrNull ?? '';
                  }),
                ),
                const SizedBox(height: 20),

                _section('Customer'),
                CustomerNameField(
                  key: ValueKey('customer-name-$nameSeed'),
                  controller: _customerName,
                  label: 'Customer name *',
                  onSelected: _applySuggestion,
                  highlight: cameFromVoice(VoiceFieldKind.customerName),
                  onChanged: (_) => typedOver(VoiceFieldKind.customerName),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _customerPhone,
                        keyboardType: TextInputType.phone,
                        onChanged: (_) =>
                            typedOver(VoiceFieldKind.customerPhone),
                        decoration: voiceDecoration(
                            'Mobile', VoiceFieldKind.customerPhone),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        controller: _customerGst,
                        textCapitalization: TextCapitalization.characters,
                        decoration: const InputDecoration(labelText: 'GST No.'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _customerAddress,
                  maxLines: 2,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(labelText: 'Address'),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _customerCity,
                        textCapitalization: TextCapitalization.words,
                        onChanged: (_) =>
                            typedOver(VoiceFieldKind.customerCity),
                        decoration: voiceDecoration(
                            'City', VoiceFieldKind.customerCity),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        controller: _customerPincode,
                        keyboardType: TextInputType.number,
                        onChanged: (_) =>
                            typedOver(VoiceFieldKind.customerPincode),
                        decoration: voiceDecoration(
                            'Pincode', VoiceFieldKind.customerPincode),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                StateAutocompleteField(controller: _customerState, label: 'State'),
                const SizedBox(height: 12),
                TextField(
                  controller: _customerIdProof,
                  decoration: const InputDecoration(
                    labelText: 'ID proof',
                    hintText: 'Aadhaar 1234-5678-9012',
                  ),
                ),
                const SizedBox(height: 20),

                _section('Goods'),
                for (var i = 0; i < _items.length; i++)
                  Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      dense: true,
                      title: Text(_items[i].itemName),
                      subtitle: Text(
                        '${_num(_items[i].quantity)} ${_items[i].unit}'
                        '${_items[i].description.isEmpty ? '' : '  •  ${_items[i].description}'}'
                        '${_items[i].weight.isEmpty ? '' : '  •  ${_items[i].weight}'}',
                      ),
                      onTap: () => _editItem(existing: _items[i], index: i),
                      trailing: IconButton(
                        icon: const Icon(Icons.close),
                        onPressed: _items[i].releasedQty > 0
                            ? null
                            : () => setState(() => _items.removeAt(i)),
                      ),
                    ),
                  ),
                OutlinedButton.icon(
                  onPressed: () => _editItem(),
                  icon: const Icon(Icons.add),
                  label: const Text('Add item'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _goodsDescription,
                  maxLines: 2,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(
                    labelText: 'Goods description',
                    hintText: 'Household goods in 42 cartons / 200 bags wheat',
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _totalPackages,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          labelText: 'Total packages',
                          hintText: 'Auto from items',
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        controller: _declaredValue,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        onChanged: (_) =>
                            typedOver(VoiceFieldKind.declaredValue),
                        decoration: voiceDecoration('Declared value (₹)',
                            VoiceFieldKind.declaredValue),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _insuranceNote,
                  decoration: const InputDecoration(
                    labelText: 'Insurance',
                    hintText: "Blank = at owner's risk",
                  ),
                ),
                const SizedBox(height: 20),

                _section('Rent & deposit'),
                Wrap(
                  spacing: 8,
                  children: [
                    for (final basis in RentBasis.values)
                      ChoiceChip(
                        label: Text(basis.label),
                        selected: _rentBasis == basis,
                        onSelected: (_) => setState(() => _rentBasis = basis),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _rentRate,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        onChanged: (_) => typedOver(VoiceFieldKind.rent),
                        decoration: voiceDecoration(
                          'Rent (₹ ${_rentBasis.label.toLowerCase()})',
                          VoiceFieldKind.rent,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        controller: _rentUnitLabel,
                        decoration: const InputDecoration(
                          labelText: 'Rate label',
                          hintText: 'per month / per sq.ft',
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _areaSqft,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: const InputDecoration(labelText: 'Area (sq.ft)'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        controller: _securityDeposit,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        onChanged: (_) =>
                            typedOver(VoiceFieldKind.securityDeposit),
                        decoration: voiceDecoration('Security deposit (₹)',
                            VoiceFieldKind.securityDeposit),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 20),

                _section('Received via'),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _vehicleNumber,
                        textCapitalization: TextCapitalization.characters,
                        onChanged: (_) =>
                            typedOver(VoiceFieldKind.vehicleNumber),
                        decoration: voiceDecoration(
                            'Vehicle no.', VoiceFieldKind.vehicleNumber),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        controller: _driverName,
                        textCapitalization: TextCapitalization.words,
                        decoration: const InputDecoration(labelText: 'Driver'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _receivedBy,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(labelText: 'Received by (staff)'),
                ),
                const SizedBox(height: 20),

                _section('Notes & terms'),
                TextField(
                  controller: _notes,
                  maxLines: 2,
                  decoration: const InputDecoration(labelText: 'Internal notes'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _terms,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    labelText: 'Terms for this storage',
                    hintText: 'Blank = company / standard terms',
                  ),
                ),
                const SizedBox(height: 28),
                FilledButton.icon(
                  onPressed: _saving ? null : _save,
                  icon: _saving
                      ? const SizedBox(
                          width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.save_outlined),
                  label: Text(_isEdit ? 'Save changes' : 'Save storage'),
                ),
                const SizedBox(height: 24),
              ],
            ),
    );
  }

  Widget _dateTile(String label, DateTime? value, VoidCallback onTap, {VoidCallback? onClear}) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          suffixIcon: onClear != null
              ? IconButton(icon: const Icon(Icons.clear, size: 18), onPressed: onClear)
              : const Icon(Icons.calendar_today_outlined, size: 18),
        ),
        child: Text(value == null ? 'Open' : _dateFormat.format(value)),
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
