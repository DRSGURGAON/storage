import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/customer/customer_lookup_service.dart';
import '../../../core/utils/id_generator.dart';
import '../../../shared/widgets/customer_name_field.dart';
import '../../../shared/widgets/state_autocomplete_field.dart';
import '../../../shared/widgets/save_problem.dart';
import '../../master/models/charge_head_model.dart';
import '../../voice_entry/models/voice_quotation_draft.dart';
import '../../voice_entry/models/voice_reading.dart';
import '../../voice_entry/services/voice_quotation_parser.dart';
import '../../voice_entry/widgets/voice_entry_sheet.dart';
import '../../voice_entry/widgets/voice_fill.dart';
import '../models/quotation_model.dart';
import '../repositories/quotation_repository.dart';

/// Price a job for a customer. Starts from the company's own service
/// list so the operator only fills in amounts.
class QuotationFormScreen extends StatefulWidget {
  final String? editQuotationId;

  /// Pre-selected customer, when the quotation is started from a
  /// customer's own screen.
  final String? customerId;

  const QuotationFormScreen({super.key, this.editQuotationId, this.customerId});

  @override
  State<QuotationFormScreen> createState() => _QuotationFormScreenState();
}

class _QuotationFormScreenState extends State<QuotationFormScreen>
    with VoiceFill {
  static final _dateFormat = DateFormat('dd MMM yyyy');

  late QuotationModel _draft;
  bool _loading = true;
  bool _saving = false;

  final _customerName = TextEditingController();
  final _customerPhone = TextEditingController();
  final _customerGst = TextEditingController();
  final _customerAddress = TextEditingController();
  final _customerCity = TextEditingController();
  final _customerState = TextEditingController();
  final _customerPincode = TextEditingController();
  final _fromCity = TextEditingController();
  final _toCity = TextEditingController();
  final _storageMonths = TextEditingController();
  final _storageNote = TextEditingController();
  final _goodsDescription = TextEditingController();
  final _discount = TextEditingController();
  final _gstPercent = TextEditingController();
  final _notes = TextEditingController();
  final _terms = TextEditingController();

  String _customerId = '';
  DateTime _quotationDate = DateTime.now();
  DateTime? _validUpto;
  DateTime? _moveDate;
  final List<QuotationLineModel> _lines = [];

  bool get _isEdit => widget.editQuotationId != null;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final now = DateTime.now();
    if (_isEdit) {
      final existing = await QuotationRepository.instance.getById(widget.editQuotationId!);
      if (existing != null) {
        _draft = existing;
        _applyDraft();
        if (mounted) setState(() => _loading = false);
        return;
      }
    }

    _draft = QuotationModel(
      id: IdGenerator.generateId(),
      quotationDate: now.toIso8601String(),
      customerName: '',
      createdAt: '',
    );
    _validUpto = now.add(const Duration(days: 15));
    _lines.addAll(await QuotationRepository.instance.defaultLines());

    if (widget.customerId != null) {
      // Started from a customer's screen - fill their details in.
      final suggestions = await CustomerLookupService.instance.search('');
      final match = suggestions.where((s) => s.customerId == widget.customerId);
      if (match.isNotEmpty) _applySuggestion(match.first);
    }

    if (mounted) setState(() => _loading = false);
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
    _fromCity.text = d.fromCity;
    _toCity.text = d.toCity;
    _storageMonths.text = d.storageMonths == 0 ? '' : _num(d.storageMonths);
    _storageNote.text = d.storageNote;
    _goodsDescription.text = d.goodsDescription;
    _discount.text = d.discountValue == 0 ? '' : _num(d.discountValue);
    _gstPercent.text = d.gstPercent == 0 ? '' : _num(d.gstPercent);
    _notes.text = d.notes;
    _terms.text = d.terms;
    _quotationDate = DateTime.tryParse(d.quotationDate) ?? DateTime.now();
    _validUpto = DateTime.tryParse(d.validUpto);
    _moveDate = DateTime.tryParse(d.moveDate);
    _lines
      ..clear()
      ..addAll(d.lines);
  }

  static String _num(double v) =>
      v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toString();

  @override
  void dispose() {
    for (final c in [
      _customerName, _customerPhone, _customerGst, _customerAddress, _customerCity,
      _customerState, _customerPincode, _fromCity, _toCity, _storageMonths,
      _storageNote, _goodsDescription, _discount, _gstPercent, _notes, _terms,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  void _applySuggestion(CustomerSuggestion s) {
    setState(() {
      _customerId = s.customerId;
      if (_customerName.text.trim().isEmpty) _customerName.text = s.name;
      if (_customerPhone.text.trim().isEmpty) _customerPhone.text = s.phone;
      if (_customerGst.text.trim().isEmpty) _customerGst.text = s.gst;
      if (_customerAddress.text.trim().isEmpty) _customerAddress.text = s.address;
      if (_customerCity.text.trim().isEmpty) _customerCity.text = s.city;
      if (_customerState.text.trim().isEmpty) _customerState.text = s.state;
      if (_customerPincode.text.trim().isEmpty) _customerPincode.text = s.pincode;
    });
  }

  double _parse(TextEditingController c) =>
      double.tryParse(c.text.trim().replaceAll(',', '')) ?? 0;

  QuotationModel _compose() => _draft.copyWith(
        quotationDate: _quotationDate.toIso8601String(),
        validUpto: _validUpto?.toIso8601String() ?? '',
        customerId: _customerId,
        customerName: _customerName.text.trim(),
        customerPhone: _customerPhone.text.trim(),
        customerGst: _customerGst.text.trim().toUpperCase(),
        customerAddress: _customerAddress.text.trim(),
        customerCity: _customerCity.text.trim(),
        customerState: _customerState.text.trim(),
        customerPincode: _customerPincode.text.trim(),
        fromCity: _fromCity.text.trim(),
        toCity: _toCity.text.trim(),
        moveDate: _moveDate?.toIso8601String() ?? '',
        storageMonths: _parse(_storageMonths),
        storageNote: _storageNote.text.trim(),
        goodsDescription: _goodsDescription.text.trim(),
        discountValue: _parse(_discount),
        gstPercent: _parse(_gstPercent),
        notes: _notes.text.trim(),
        terms: _terms.text.trim(),
        lines: List.of(_lines),
      );

  Future<void> _save() async {
    if (_customerName.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter the customer name.')),
      );
      return;
    }

    setState(() => _saving = true);
    try {
      final saved = await QuotationRepository.instance.save(_compose());
      voiceFilled.clear();
      if (!mounted) return;
      context.pop(saved.id);
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      showSaveProblem(context, error);
    }
  }

  Future<void> _editLine({QuotationLineModel? existing, int? index}) async {
    final name = TextEditingController(text: existing?.serviceName ?? '');
    final description = TextEditingController(text: existing?.description ?? '');
    final quantity = TextEditingController(
      text: existing == null ? '1' : _num(existing.quantity),
    );
    final rate = TextEditingController(
      text: (existing?.rate ?? 0) == 0 ? '' : _num(existing!.rate),
    );
    var mode = existing?.mode ?? ChargeMode.amount;
    var taxable = existing?.taxable ?? true;

    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: Text(existing == null ? 'Add Service' : 'Edit Service'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: name,
                  autofocus: existing == null,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(labelText: 'Service *'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: description,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(labelText: 'Details'),
                ),
                const SizedBox(height: 14),
                const Text('How it is quoted'),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  children: [
                    for (final option in ChargeMode.values)
                      ChoiceChip(
                        label: Text(option.label),
                        selected: mode == option,
                        onSelected: (_) => setDialogState(() => mode = option),
                      ),
                  ],
                ),
                if (mode == ChargeMode.amount) ...[
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: quantity,
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          decoration: const InputDecoration(labelText: 'Qty'),
                          onChanged: (_) => setDialogState(() {}),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: TextField(
                          controller: rate,
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          decoration: const InputDecoration(labelText: 'Rate (₹)'),
                          onChanged: (_) => setDialogState(() {}),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Amount: ₹${(((double.tryParse(quantity.text) ?? 1) * (double.tryParse(rate.text) ?? 0))).toStringAsFixed(2)}',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 4),
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    value: taxable,
                    title: const Text('GST applies'),
                    onChanged: (v) => setDialogState(() => taxable = v ?? true),
                  ),
                ],
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
      ),
    );

    if (saved != true) return;

    final qty = double.tryParse(quantity.text.trim()) ?? 1;
    final rateValue = double.tryParse(rate.text.trim()) ?? 0;

    final line = (existing ??
            QuotationLineModel(id: IdGenerator.generateId(), serviceName: ''))
        .copyWith(
      serviceName: name.text.trim(),
      description: description.text.trim(),
      mode: mode,
      quantity: qty <= 0 ? 1 : qty,
      rate: rateValue,
      amount: mode == ChargeMode.amount ? (qty <= 0 ? 1 : qty) * rateValue : 0,
      taxable: taxable,
    );

    setState(() {
      if (index == null) {
        _lines.add(line);
      } else {
        _lines[index] = line;
      }
    });
  }

  /// Puts what the operator accepted on the voice sheet into the
  /// quotation. A service the company already lists keeps its own row -
  /// only its amount is filled in - so the printed order stays put.
  Future<void> _fillByVoice() async {
    final spoken = await VoiceEntrySheet.show<VoiceQuotationDraft>(
      context,
      recipe: VoiceRecipe(
        example: 'Anil Sharma, 9812345678, Gurgaon se Jaipur, packing das '
            'hazaar, transport pandrah hazaar, teen mahine storage, '
            'GST atharah percent',
        parse: (text) => VoiceQuotationParser().parse(text),
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
      if (spoken.fromCity != null) _fromCity.text = spoken.fromCity!;
      if (spoken.toCity != null) _toCity.text = spoken.toCity!;
      if (spoken.moveDate != null) _moveDate = spoken.moveDate;
      if (spoken.storageMonths != null) {
        _storageMonths.text = _num(spoken.storageMonths!);
      }

      for (final service in spoken.services) {
        final at = _lines.indexWhere((l) =>
            l.serviceName.toLowerCase() == service.name.toLowerCase());
        if (at >= 0) {
          _lines[at] = _lines[at].copyWith(
            mode: ChargeMode.amount,
            quantity: 1,
            rate: service.amount,
            amount: service.amount,
          );
        } else {
          _lines.add(QuotationLineModel(
            id: IdGenerator.generateId(),
            sortOrder: _lines.length,
            serviceName: service.name,
            quantity: 1,
            rate: service.amount,
            amount: service.amount,
          ));
        }
      }

      if (spoken.discount != null) _discount.text = _num(spoken.discount!);
      if (spoken.gstPercent != null) _gstPercent.text = _num(spoken.gstPercent!);
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

  @override
  Widget build(BuildContext context) {
    // NOT `_compose()` unguarded: _draft is late-initialised by _load(),
    // so composing on the first frame threw LateInitializationError and
    // the whole screen - app bar, back button and all - failed to build.
    final preview = _loading ? null : _compose();

    return Scaffold(
      appBar: AppBar(
        title: Text(_isEdit ? 'Edit Quotation' : 'New Quotation'),
        centerTitle: true,
        actions: [
          IconButton(
            tooltip: 'Bol kar bhariye',
            icon: const Icon(Icons.mic_none),
            onPressed: _loading ? null : _fillByVoice,
          ),
        ],
      ),
      bottomNavigationBar: preview == null
          ? null
          : SafeArea(
              child: Container(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  border: Border(top: BorderSide(color: Colors.grey.shade300)),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Text('Total', style: TextStyle(fontSize: 12, color: Colors.grey)),
                          Text(
                            '₹${preview.grandTotal.toStringAsFixed(2)}',
                            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                    ),
                    FilledButton.icon(
                      onPressed: _saving ? null : _save,
                      icon: _saving
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.save_outlined),
                      label: Text(_isEdit ? 'Save changes' : 'Save quotation'),
                    ),
                  ],
                ),
              ),
            ),
      body: preview == null
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
                _section('Customer'),
                CustomerNameField(
                  key: ValueKey('quotation-customer-$nameSeed'),
                  controller: _customerName,
                  label: 'Customer name *',
                  highlight: cameFromVoice(VoiceFieldKind.customerName),
                  onChanged: (_) => typedOver(VoiceFieldKind.customerName),
                  onSelected: _applySuggestion,
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
                        decoration: const InputDecoration(labelText: 'GST No. (if any)'),
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
                        decoration: const InputDecoration(labelText: 'City'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        controller: _customerPincode,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(labelText: 'Pincode'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                StateAutocompleteField(controller: _customerState, label: 'State'),
                const SizedBox(height: 20),

                _section('Job'),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _fromCity,
                        textCapitalization: TextCapitalization.words,
                        onChanged: (_) => typedOver(VoiceFieldKind.fromCity),
                        decoration: voiceDecoration(
                            'From (city)', VoiceFieldKind.fromCity),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        controller: _toCity,
                        textCapitalization: TextCapitalization.words,
                        onChanged: (_) => typedOver(VoiceFieldKind.toCity),
                        decoration:
                            voiceDecoration('To (city)', VoiceFieldKind.toCity),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: _dateTile('Quotation date', _quotationDate,
                          () => _pickDate(initial: _quotationDate, onPicked: (d) => _quotationDate = d)),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _dateTile('Valid upto', _validUpto,
                          () => _pickDate(initial: _validUpto ?? _quotationDate, onPicked: (d) => _validUpto = d),
                          onClear: _validUpto == null ? null : () => setState(() => _validUpto = null)),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _dateTile('Move date (if known)', _moveDate,
                    () => _pickDate(initial: _moveDate ?? DateTime.now(), onPicked: (d) => _moveDate = d),
                    onClear: _moveDate == null ? null : () => setState(() => _moveDate = null),
                    kind: VoiceFieldKind.moveDate),
                const SizedBox(height: 12),
                TextField(
                  controller: _goodsDescription,
                  maxLines: 2,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(
                    labelText: 'Goods',
                    hintText: '2 BHK household goods, approx 45 cartons',
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _storageMonths,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        onChanged: (_) =>
                            typedOver(VoiceFieldKind.storageMonths),
                        decoration: voiceDecoration(
                            'Storage (months)', VoiceFieldKind.storageMonths),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      flex: 2,
                      child: TextField(
                        controller: _storageNote,
                        decoration: const InputDecoration(
                          labelText: 'Storage note',
                          hintText: 'Rent ₹3,500 per month',
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 20),

                _section('Services'),
                for (var i = 0; i < _lines.length; i++)
                  Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      dense: true,
                      title: Text(_lines[i].serviceName),
                      subtitle: _lines[i].description.isEmpty ? null : Text(_lines[i].description),
                      onTap: () => _editLine(existing: _lines[i], index: i),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            _lines[i].mode == ChargeMode.amount
                                ? '₹${_lines[i].amount.toStringAsFixed(0)}'
                                : _lines[i].mode.label,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          IconButton(
                            icon: const Icon(Icons.close),
                            onPressed: () => setState(() => _lines.removeAt(i)),
                          ),
                        ],
                      ),
                    ),
                  ),
                OutlinedButton.icon(
                  onPressed: () => _editLine(),
                  icon: const Icon(Icons.add),
                  label: const Text('Add service'),
                ),
                const SizedBox(height: 20),

                _section('Totals'),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _discount,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        onChanged: (_) {
                          typedOver(VoiceFieldKind.discount);
                          setState(() {});
                        },
                        decoration: voiceDecoration(
                            'Discount (₹)', VoiceFieldKind.discount),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        controller: _gstPercent,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        onChanged: (_) {
                          typedOver(VoiceFieldKind.gstPercent);
                          setState(() {});
                        },
                        decoration:
                            voiceDecoration('GST %', VoiceFieldKind.gstPercent),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      children: [
                        _totalRow('Subtotal', preview.subtotal),
                        if (preview.discountValue > 0) _totalRow('Discount', -preview.discountValue),
                        if (preview.gstPercent > 0)
                          _totalRow('GST (${_num(preview.gstPercent)}%)', preview.taxableBase * preview.gstPercent / 100),
                        const Divider(),
                        _totalRow('Total', preview.grandTotal, bold: true),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 20),

                _section('Notes & terms'),
                TextField(
                  controller: _notes,
                  maxLines: 2,
                  decoration: const InputDecoration(labelText: 'Note printed on the quotation'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _terms,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    labelText: 'Terms for this quotation',
                    hintText: 'Blank = company / standard terms',
                  ),
                ),
                const SizedBox(height: 24),
              ],
            ),
    );
  }

  Widget _totalRow(String label, double value, {bool bold = false}) {
    final style = TextStyle(
      fontWeight: bold ? FontWeight.bold : FontWeight.normal,
      fontSize: bold ? 16 : 14,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: style),
          Text('₹${value.toStringAsFixed(2)}', style: style),
        ],
      ),
    );
  }

  Widget _dateTile(String label, DateTime? value, VoidCallback onTap,
      {VoidCallback? onClear, VoiceFieldKind? kind}) {
    final touched = kind != null && cameFromVoice(kind);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          suffixIcon: onClear != null
              ? IconButton(icon: const Icon(Icons.clear, size: 18), onPressed: onClear)
              : const Icon(Icons.calendar_today_outlined, size: 18),
          filled: touched,
          fillColor: touched
              ? Theme.of(context)
                  .colorScheme
                  .primaryContainer
                  .withValues(alpha: 0.45)
              : null,
        ),
        child: Text(value == null ? 'Not set' : _dateFormat.format(value)),
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
