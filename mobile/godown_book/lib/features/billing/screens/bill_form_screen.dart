import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/utils/id_generator.dart';
import '../../../shared/widgets/customer_name_field.dart';
import '../../../shared/widgets/save_problem.dart';
import '../../master/repositories/charge_head_repository.dart';
import '../../storage_booking/models/storage_booking_model.dart';
import '../../storage_booking/repositories/storage_booking_repository.dart';
import '../../voice_entry/models/voice_bill_draft.dart';
import '../../voice_entry/models/voice_reading.dart';
import '../../voice_entry/services/voice_bill_parser.dart';
import '../../voice_entry/widgets/voice_entry_sheet.dart';
import '../../voice_entry/widgets/voice_fill.dart';
import '../models/bill_model.dart';
import '../repositories/billing_repository.dart';
import '../services/storage_charge_calculator.dart';

/// Raise or edit a storage bill. Opened from a storage record it fills
/// itself in: the period picks up where the last bill stopped and the
/// storage charge is worked out from the agreed rate.
class BillFormScreen extends StatefulWidget {
  final String? editBillId;

  /// Storage record to bill, when started from one.
  final String? bookingId;

  const BillFormScreen({super.key, this.editBillId, this.bookingId});

  @override
  State<BillFormScreen> createState() => _BillFormScreenState();
}

class _BillFormScreenState extends State<BillFormScreen> with VoiceFill {
  static final _dateFormat = DateFormat('dd MMM yyyy');

  BillModel? _draft;
  StorageBookingModel? _booking;
  List<StorageBookingModel> _openBookings = const [];
  bool _loading = true;
  bool _saving = false;

  final _customerName = TextEditingController();
  final _customerPhone = TextEditingController();
  final _customerGst = TextEditingController();
  final _discount = TextEditingController();
  final _gstPercent = TextEditingController();
  final _notes = TextEditingController();

  String _customerId = '';
  String _customerAddress = '';
  String _customerCity = '';
  String _customerState = '';
  String _customerPincode = '';
  DateTime _billDate = DateTime.now();
  DateTime? _periodFrom;
  DateTime? _periodTo;
  DateTime? _dueDate;
  final List<BillLineModel> _lines = [];

  bool get _isEdit => widget.editBillId != null;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    _openBookings = await StorageBookingRepository.instance.getOpen();

    if (_isEdit) {
      final bill = await BillingRepository.instance.getBillById(widget.editBillId!);
      if (bill != null) {
        _draft = bill;
        if (bill.bookingId.isNotEmpty) {
          _booking = await StorageBookingRepository.instance.getById(bill.bookingId);
        }
        _apply(bill);
        if (mounted) setState(() => _loading = false);
        return;
      }
    }

    if (widget.bookingId != null) {
      final booking = await StorageBookingRepository.instance.getById(widget.bookingId!);
      if (booking != null) {
        _booking = booking;
        final draft = await BillingRepository.instance.draftForBooking(booking);
        _draft = draft;
        _apply(draft);
        if (mounted) setState(() => _loading = false);
        return;
      }
    }

    _draft = BillModel(
      id: IdGenerator.generateId(),
      billDate: DateTime.now().toIso8601String(),
      customerName: '',
      createdAt: '',
    );
    _dueDate = DateTime.now().add(const Duration(days: 7));
    if (mounted) setState(() => _loading = false);
  }

  void _apply(BillModel bill) {
    _customerId = bill.customerId;
    _customerName.text = bill.customerName;
    _customerPhone.text = bill.customerPhone;
    _customerGst.text = bill.customerGst;
    _customerAddress = bill.customerAddress;
    _customerCity = bill.customerCity;
    _customerState = bill.customerState;
    _customerPincode = bill.customerPincode;
    _discount.text = bill.discountValue == 0 ? '' : _num(bill.discountValue);
    _gstPercent.text = bill.gstPercent == 0 ? '' : _num(bill.gstPercent);
    _notes.text = bill.notes;
    _billDate = DateTime.tryParse(bill.billDate) ?? DateTime.now();
    _periodFrom = DateTime.tryParse(bill.periodFrom);
    _periodTo = DateTime.tryParse(bill.periodTo);
    _dueDate = DateTime.tryParse(bill.dueDate);
    _lines
      ..clear()
      ..addAll(bill.lines);
  }

  static String _num(double v) =>
      v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toString();

  @override
  void dispose() {
    for (final c in [_customerName, _customerPhone, _customerGst, _discount, _gstPercent, _notes]) {
      c.dispose();
    }
    super.dispose();
  }

  double _parse(TextEditingController c) =>
      double.tryParse(c.text.trim().replaceAll(',', '')) ?? 0;

  BillModel _compose() => (_draft ?? BillModel(
        id: IdGenerator.generateId(),
        billDate: _billDate.toIso8601String(),
        customerName: '',
        createdAt: '',
      )).copyWith(
        billDate: _billDate.toIso8601String(),
        bookingId: _booking?.id ?? '',
        bookingNo: _booking?.bookingNo ?? '',
        customerId: _customerId,
        customerName: _customerName.text.trim(),
        customerPhone: _customerPhone.text.trim(),
        customerGst: _customerGst.text.trim().toUpperCase(),
        customerAddress: _customerAddress,
        customerCity: _customerCity,
        customerState: _customerState,
        customerPincode: _customerPincode,
        periodFrom: _periodFrom == null ? '' : _isoDate(_periodFrom!),
        periodTo: _periodTo == null ? '' : _isoDate(_periodTo!),
        dueDate: _dueDate == null ? '' : _isoDate(_dueDate!),
        discountValue: _parse(_discount),
        gstPercent: _parse(_gstPercent),
        notes: _notes.text.trim(),
        lines: List.of(_lines),
      );

  static String _isoDate(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';

  /// Re-derives the storage line whenever the record or the period
  /// changes, leaving every other line the operator added alone.
  void _refreshStorageLine() {
    final booking = _booking;
    final from = _periodFrom;
    final to = _periodTo;
    _lines.removeWhere((l) => l.chargeName == 'Storage Charge');
    if (booking == null || from == null || to == null || booking.rentRate <= 0) return;
    if (to.isBefore(from)) return;

    _lines.insert(
      0,
      StorageChargeCalculator.line(
        booking,
        id: IdGenerator.generateId(),
        from: from,
        to: to,
      ),
    );
  }

  Future<void> _pickBooking() async {
    final selected = await showModalBottomSheet<StorageBookingModel>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const ListTile(
              title: Text('Bill against which storage?',
                  style: TextStyle(fontWeight: FontWeight.bold)),
            ),
            ListTile(
              leading: const Icon(Icons.receipt_long_outlined),
              title: const Text('No storage record'),
              subtitle: const Text('A one-off bill'),
              onTap: () => Navigator.pop(sheetContext, null),
            ),
            const Divider(height: 1),
            for (final booking in _openBookings)
              ListTile(
                leading: const Icon(Icons.inventory_2_outlined),
                title: Text('${booking.bookingNo}  •  ${booking.customerName}'),
                subtitle: Text(
                  booking.rentRate > 0
                      ? '₹${_num(booking.rentRate)} ${booking.rentBasis.rateHint}'
                          '${booking.rentBilledUpto.isEmpty ? '' : '  •  billed to ${_dateFormat.format(DateTime.parse(booking.rentBilledUpto))}'}'
                      : 'No rate set',
                ),
                onTap: () => Navigator.pop(sheetContext, booking),
              ),
          ],
        ),
      ),
    );

    if (!mounted) return;

    setState(() {
      _booking = selected;
      if (selected != null) {
        _customerId = selected.customerId;
        _customerName.text = selected.customerName;
        _customerPhone.text = selected.customerPhone;
        _customerGst.text = selected.customerGst;
        _customerAddress = selected.customerAddress;
        _customerCity = selected.customerCity;
        _customerState = selected.customerState;
        _customerPincode = selected.customerPincode;
        _periodFrom = StorageChargeCalculator.nextPeriodStart(selected);
        _periodTo ??= DateTime.now();
        _refreshStorageLine();
      }
    });
  }

  Future<void> _addCharge() async {
    final heads = await ChargeHeadRepository.instance.getAll();
    if (!mounted) return;

    final nameController = TextEditingController();
    final amountController = TextEditingController();
    var taxable = true;

    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: const Text('Add Charge'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: [
                    for (final head in heads.where((h) => h.chargeName != 'Storage Rent'))
                      ActionChip(
                        label: Text(head.chargeName, style: const TextStyle(fontSize: 12)),
                        onPressed: () => setDialogState(() {
                          nameController.text = head.chargeName;
                          if (head.defaultAmount > 0) {
                            amountController.text = _num(head.defaultAmount);
                          }
                          taxable = head.taxable;
                        }),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: nameController,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(labelText: 'Charge *'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: amountController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Amount (₹)'),
                ),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  value: taxable,
                  title: const Text('GST applies'),
                  onChanged: (v) => setDialogState(() => taxable = v ?? true),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('Cancel')),
            FilledButton(
              onPressed: () {
                if (nameController.text.trim().isEmpty) return;
                Navigator.pop(dialogContext, true);
              },
              child: const Text('Add'),
            ),
          ],
        ),
      ),
    );

    if (saved != true) return;

    final amount = double.tryParse(amountController.text.trim()) ?? 0;
    setState(() {
      _lines.add(BillLineModel(
        id: IdGenerator.generateId(),
        chargeName: nameController.text.trim(),
        quantity: 1,
        rate: amount,
        amount: amount,
        taxable: taxable,
      ));
    });
  }

  /// Puts what the operator accepted on the voice sheet into the bill.
  /// The storage line is still worked out from the agreed rate - a
  /// spoken one never overwrites the calculated one.
  Future<void> _fillByVoice() async {
    final spoken = await VoiceEntrySheet.show<VoiceBillDraft>(
      context,
      recipe: VoiceRecipe(
        example: 'Rajesh Kumar, ek October se atharah October tak, '
            'storage teen hazaar, mazdoori paanch sau, GST atharah percent',
        parse: (text) => VoiceBillParser().parse(text),
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
      if (spoken.periodFrom != null) _periodFrom = spoken.periodFrom;
      if (spoken.periodTo != null) _periodTo = spoken.periodTo;
      if (spoken.periodFrom != null || spoken.periodTo != null) {
        _refreshStorageLine();
      }

      for (final charge in spoken.charges) {
        final alreadyCalculated = charge.name == 'Storage Charge' &&
            _lines.any((l) => l.chargeName == 'Storage Charge');
        if (alreadyCalculated) continue;
        _lines.add(BillLineModel(
          id: IdGenerator.generateId(),
          chargeName: charge.name,
          quantity: 1,
          rate: charge.amount,
          amount: charge.amount,
        ));
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
    if (picked != null) {
      setState(() {
        onPicked(picked);
        _refreshStorageLine();
      });
    }
  }

  Future<void> _save() async {
    if (_customerName.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter the customer name.')),
      );
      return;
    }
    if (_lines.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Add at least one charge.')),
      );
      return;
    }

    setState(() => _saving = true);
    try {
      final saved = await BillingRepository.instance.saveBill(_compose());
      if (!mounted) return;
      voiceFilled.clear();
      context.pop(saved.id);
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      showSaveProblem(context, error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final preview = _loading ? null : _compose();

    return Scaffold(
      appBar: AppBar(
        title: Text(_isEdit ? 'Edit Bill' : 'New Storage Bill'),
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
                          const Text('Bill total',
                              style: TextStyle(fontSize: 12, color: Colors.grey)),
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
                          ? const SizedBox(
                              width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.save_outlined),
                      label: Text(_isEdit ? 'Save changes' : 'Save bill'),
                    ),
                  ],
                ),
              ),
            ),
      body: _loading
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
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.inventory_2_outlined),
                    title: Text(_booking == null
                        ? 'No storage record'
                        : '${_booking!.bookingNo}  •  ${_booking!.customerName}'),
                    subtitle: Text(_booking == null
                        ? 'Tap to bill against a customer\'s storage'
                        : '₹${_num(_booking!.rentRate)} ${_booking!.rentBasis.rateHint}'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: _pickBooking,
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: _dateTile('Period from', _periodFrom,
                          () => _pickDate(initial: _periodFrom ?? DateTime.now(),
                              onPicked: (d) => _periodFrom = d),
                          kind: VoiceFieldKind.periodFrom),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _dateTile('Period to', _periodTo,
                          () => _pickDate(initial: _periodTo ?? DateTime.now(),
                              onPicked: (d) => _periodTo = d),
                          kind: VoiceFieldKind.periodTo),
                    ),
                  ],
                ),
                const SizedBox(height: 20),

                _section('Customer'),
                CustomerNameField(
                  key: ValueKey('bill-customer-$nameSeed'),
                  controller: _customerName,
                  label: 'Customer name *',
                  highlight: cameFromVoice(VoiceFieldKind.customerName),
                  onChanged: (_) => typedOver(VoiceFieldKind.customerName),
                  onSelected: (s) => setState(() {
                    _customerId = s.customerId;
                    if (_customerPhone.text.trim().isEmpty) _customerPhone.text = s.phone;
                    if (_customerGst.text.trim().isEmpty) _customerGst.text = s.gst;
                    _customerAddress = s.address;
                    _customerCity = s.city;
                    _customerState = s.state;
                    _customerPincode = s.pincode;
                  }),
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
                const SizedBox(height: 20),

                _section('Charges'),
                for (var i = 0; i < _lines.length; i++)
                  Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      dense: true,
                      title: Text(_lines[i].chargeName),
                      subtitle: _lines[i].description.isEmpty
                          ? null
                          : Text(_lines[i].description, style: const TextStyle(fontSize: 12)),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text('₹${_lines[i].amount.toStringAsFixed(0)}',
                              style: const TextStyle(fontWeight: FontWeight.w600)),
                          IconButton(
                            icon: const Icon(Icons.close),
                            onPressed: () => setState(() => _lines.removeAt(i)),
                          ),
                        ],
                      ),
                    ),
                  ),
                OutlinedButton.icon(
                  onPressed: _addCharge,
                  icon: const Icon(Icons.add),
                  label: const Text('Add charge'),
                ),
                const SizedBox(height: 20),

                _section('Bill'),
                Row(
                  children: [
                    Expanded(
                      child: _dateTile('Bill date', _billDate,
                          () => _pickDate(initial: _billDate, onPicked: (d) => _billDate = d)),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _dateTile('Due date', _dueDate,
                          () => _pickDate(initial: _dueDate ?? DateTime.now(),
                              onPicked: (d) => _dueDate = d)),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
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
                TextField(
                  controller: _notes,
                  maxLines: 2,
                  decoration: const InputDecoration(labelText: 'Note printed on the bill'),
                ),
                const SizedBox(height: 24),
              ],
            ),
    );
  }

  Widget _dateTile(String label, DateTime? value, VoidCallback onTap,
      {VoiceFieldKind? kind}) {
    final touched = kind != null && cameFromVoice(kind);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          suffixIcon: const Icon(Icons.calendar_today_outlined, size: 18),
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
