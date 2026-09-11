import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/utils/id_generator.dart';
import '../../storage_booking/models/storage_booking_model.dart';
import '../../storage_booking/repositories/storage_booking_repository.dart';
import '../models/consignment_model.dart';
import '../repositories/consignment_repository.dart';

/// Making a bilty: who is sending, who is receiving, what is going, in
/// which truck, and who pays the freight. Long-ish, but every section
/// is short and most of it fills itself in from the storage record.
class ConsignmentFormScreen extends StatefulWidget {
  /// A storage record the goods are coming from or going to.
  final String? bookingId;

  /// An existing bilty being corrected.
  final String? consignmentId;

  const ConsignmentFormScreen({super.key, this.bookingId, this.consignmentId});

  @override
  State<ConsignmentFormScreen> createState() => _ConsignmentFormScreenState();
}

class _ConsignmentFormScreenState extends State<ConsignmentFormScreen> {
  static final _dateFormat = DateFormat('dd MMM yyyy');

  final _from = TextEditingController();
  final _to = TextEditingController();

  final _consignorName = TextEditingController();
  final _consignorPhone = TextEditingController();
  final _consignorAddress = TextEditingController();

  final _consigneeName = TextEditingController();
  final _consigneePhone = TextEditingController();
  final _consigneeAddress = TextEditingController();

  final _goods = TextEditingController();
  final _packages = TextEditingController();
  final _weight = TextEditingController();
  final _declaredValue = TextEditingController();

  final _vehicle = TextEditingController();
  final _driver = TextEditingController();
  final _driverPhone = TextEditingController();
  final _licence = TextEditingController();

  final _freight = TextEditingController();
  final _otherCharges = TextEditingController();
  final _advance = TextEditingController();

  final _insurer = TextEditingController();
  final _policy = TextEditingController();
  final _notes = TextEditingController();

  DateTime _lrDate = DateTime.now();
  FreightBasis _freightBasis = FreightBasis.toPay;
  RiskBasis _riskBasis = RiskBasis.owner;
  bool _insured = false;
  bool _sameAsSender = true;

  ConsignmentModel? _existing;
  StorageBookingModel? _booking;
  List<ConsignmentItemModel> _items = [];
  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  @override
  void dispose() {
    for (final controller in [
      _from, _to,
      _consignorName, _consignorPhone, _consignorAddress,
      _consigneeName, _consigneePhone, _consigneeAddress,
      _goods, _packages, _weight, _declaredValue,
      _vehicle, _driver, _driverPhone, _licence,
      _freight, _otherCharges, _advance,
      _insurer, _policy, _notes,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    ConsignmentModel? existing;
    if ((widget.consignmentId ?? '').isNotEmpty) {
      existing =
          await ConsignmentRepository.instance.getById(widget.consignmentId!);
    }

    StorageBookingModel? booking;
    final bookingId =
        existing?.bookingId.isNotEmpty == true ? existing!.bookingId : (widget.bookingId ?? '');
    if (bookingId.isNotEmpty) {
      booking = await StorageBookingRepository.instance.getById(bookingId);
    }

    final draft = existing ??
        (booking != null
            ? ConsignmentRepository.instance.draftForBooking(booking)
            : ConsignmentModel(
                id: '',
                lrDate: DateTime.now().toIso8601String(),
                consignorName: '',
                createdAt: '',
              ));

    _from.text = draft.fromPlace;
    _to.text = draft.toPlace;
    _consignorName.text = draft.consignorName;
    _consignorPhone.text = draft.consignorPhone;
    _consignorAddress.text = draft.consignorAddress;
    _consigneeName.text = draft.consigneeName;
    _consigneePhone.text = draft.consigneePhone;
    _consigneeAddress.text = draft.consigneeAddress;
    _goods.text = draft.goodsDescription;
    _packages.text = draft.packages > 0 ? '${draft.packages}' : '';
    _weight.text = draft.weight;
    _declaredValue.text =
        draft.declaredValue > 0 ? draft.declaredValue.toStringAsFixed(0) : '';
    _vehicle.text = draft.vehicleNumber;
    _driver.text = draft.driverName;
    _driverPhone.text = draft.driverPhone;
    _licence.text = draft.driverLicence;
    _freight.text =
        draft.freightAmount > 0 ? draft.freightAmount.toStringAsFixed(0) : '';
    _otherCharges.text =
        draft.otherCharges > 0 ? draft.otherCharges.toStringAsFixed(0) : '';
    _advance.text =
        draft.advancePaid > 0 ? draft.advancePaid.toStringAsFixed(0) : '';
    _insurer.text = draft.insurer;
    _policy.text = draft.policyNo;
    _notes.text = draft.notes;

    if (!mounted) return;
    setState(() {
      _existing = existing;
      _booking = booking;
      _items = [...draft.items];
      _lrDate = DateTime.tryParse(draft.lrDate) ?? DateTime.now();
      _freightBasis = draft.freightBasis;
      _riskBasis = draft.riskBasis;
      _insured = draft.insured;
      _sameAsSender = draft.consigneeName.trim().isEmpty ||
          draft.consigneeName.trim() == draft.consignorName.trim();
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/bilties'),
        ),
        title: Text(_existing == null ? 'New Bilty' : 'Edit ${_existing!.lrNo}'),
        centerTitle: true,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 110),
              children: [
                if (_booking != null) _bookingCard(_booking!),
                if (_booking != null) const SizedBox(height: 12),
                _routeCard(),
                const SizedBox(height: 12),
                _senderCard(),
                const SizedBox(height: 12),
                _receiverCard(),
                const SizedBox(height: 12),
                _goodsCard(),
                const SizedBox(height: 12),
                _vehicleCard(),
                const SizedBox(height: 12),
                _freightCard(),
                const SizedBox(height: 12),
                _riskCard(),
              ],
            ),
      bottomNavigationBar: _loading
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
                child: SizedBox(
                  height: 52,
                  child: FilledButton.icon(
                    icon: const Icon(Icons.save_outlined),
                    label: Text(_saving ? 'Please wait...' : 'Save bilty'),
                    onPressed: _saving ? null : _save,
                  ),
                ),
              ),
            ),
    );
  }

  Widget _card(String title, List<Widget> children) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title,
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
            const SizedBox(height: 12),
            ...children,
          ],
        ),
      ),
    );
  }

  Widget _field(
    TextEditingController controller,
    String label, {
    String? hint,
    TextInputType? keyboard,
    int maxLines = 1,
    String? prefix,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextField(
        controller: controller,
        keyboardType: keyboard,
        maxLines: maxLines,
        textCapitalization: keyboard == null
            ? TextCapitalization.words
            : TextCapitalization.none,
        decoration: InputDecoration(
          labelText: label,
          hintText: hint,
          prefixText: prefix,
          border: const OutlineInputBorder(),
        ),
      ),
    );
  }

  Widget _bookingCard(StorageBookingModel booking) {
    return Card(
      child: ListTile(
        leading: const CircleAvatar(child: Icon(Icons.inventory_2_outlined)),
        title: Text(booking.customerName,
            style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text('From storage ${booking.bookingNo}'),
      ),
    );
  }

  Widget _routeCard() {
    return _card('Where it is going', [
      Row(
        children: [
          Expanded(child: _field(_from, 'From')),
          const SizedBox(width: 10),
          Expanded(child: _field(_to, 'To')),
        ],
      ),
      OutlinedButton.icon(
        icon: const Icon(Icons.event_outlined, size: 18),
        label: Text('Bilty date ${_dateFormat.format(_lrDate)}'),
        onPressed: () async {
          final picked = await showDatePicker(
            context: context,
            initialDate: _lrDate,
            firstDate: DateTime(2020),
            lastDate: DateTime.now().add(const Duration(days: 30)),
          );
          if (picked != null) setState(() => _lrDate = picked);
        },
      ),
    ]);
  }

  Widget _senderCard() {
    return _card('Sender (consignor)', [
      _field(_consignorName, 'Name'),
      _field(_consignorPhone, 'Mobile', keyboard: TextInputType.phone),
      _field(_consignorAddress, 'Address', maxLines: 2),
    ]);
  }

  Widget _receiverCard() {
    return Card(
      child: Column(
        children: [
          SwitchListTile(
            value: _sameAsSender,
            title: const Text('Receiver is the same person'),
            subtitle: const Text('Goods go back to the sender'),
            onChanged: (value) => setState(() => _sameAsSender = value),
          ),
          if (!_sameAsSender)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
              child: Column(
                children: [
                  _field(_consigneeName, 'Receiver name'),
                  _field(_consigneePhone, 'Receiver mobile',
                      keyboard: TextInputType.phone),
                  _field(_consigneeAddress, 'Delivery address', maxLines: 2),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _goodsCard() {
    return _card('What is going', [
      for (var i = 0; i < _items.length; i++)
        ListTile(
          contentPadding: EdgeInsets.zero,
          dense: true,
          title: Text(_items[i].itemName),
          subtitle: Text(
              '${_items[i].quantity.toStringAsFixed(0)} ${_items[i].unit}'
              '${_items[i].conditionNote.trim().isEmpty ? '' : '  ·  ${_items[i].conditionNote}'}'),
          trailing: IconButton(
            icon: const Icon(Icons.close, size: 18),
            onPressed: () => setState(() => _items.removeAt(i)),
          ),
        ),
      Align(
        alignment: Alignment.centerLeft,
        child: TextButton.icon(
          icon: const Icon(Icons.add, size: 18),
          label: const Text('Add item'),
          onPressed: _addItem,
        ),
      ),
      const SizedBox(height: 8),
      _field(_goods, 'Or write it in one line',
          hint: 'Household goods of a 2 BHK', maxLines: 2),
      Row(
        children: [
          Expanded(
            child: _field(_packages, 'Packages',
                keyboard: TextInputType.number),
          ),
          const SizedBox(width: 10),
          Expanded(child: _field(_weight, 'Weight', hint: '1.5 ton')),
        ],
      ),
      _field(_declaredValue, 'Value declared by the sender',
          keyboard: const TextInputType.numberWithOptions(decimal: true),
          prefix: '₹ '),
      const Text(
        'This declared value is the limit of what can be claimed if the goods '
        'are lost or damaged. Ask the sender for it, and write what they say.',
        style: TextStyle(fontSize: 12, color: Colors.black54),
      ),
    ]);
  }

  Widget _vehicleCard() {
    return _card('Truck and driver', [
      _field(_vehicle, 'Vehicle number', hint: 'HR 45 A 1234'),
      _field(_driver, 'Driver name'),
      _field(_driverPhone, 'Driver mobile', keyboard: TextInputType.phone),
      _field(_licence, 'Licence number'),
    ]);
  }

  Widget _freightCard() {
    return _card('Freight', [
      Wrap(
        spacing: 8,
        children: [
          for (final basis in FreightBasis.values)
            ChoiceChip(
              label: Text(basis.label),
              selected: _freightBasis == basis,
              onSelected: (_) => setState(() => _freightBasis = basis),
            ),
        ],
      ),
      const SizedBox(height: 6),
      Text(_freightBasis.hint,
          style: const TextStyle(fontSize: 12, color: Colors.black54)),
      const SizedBox(height: 14),
      _field(_freight, 'Freight',
          keyboard: const TextInputType.numberWithOptions(decimal: true),
          prefix: '₹ '),
      _field(_otherCharges, 'Other charges (loading, toll)',
          keyboard: const TextInputType.numberWithOptions(decimal: true),
          prefix: '₹ '),
      _field(_advance, 'Advance already taken',
          keyboard: const TextInputType.numberWithOptions(decimal: true),
          prefix: '₹ '),
    ]);
  }

  Widget _riskCard() {
    return _card('Risk and insurance', [
      Wrap(
        spacing: 8,
        children: [
          for (final basis in RiskBasis.values)
            ChoiceChip(
              label: Text(basis.label),
              selected: _riskBasis == basis,
              onSelected: (_) => setState(() => _riskBasis = basis),
            ),
        ],
      ),
      const SizedBox(height: 10),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        value: _insured,
        title: const Text('Transit insurance taken'),
        onChanged: (value) => setState(() => _insured = value),
      ),
      if (_insured) ...[
        const SizedBox(height: 8),
        _field(_insurer, 'Insurance company'),
        _field(_policy, 'Policy number'),
      ],
      _field(_notes, 'Remarks (optional)', maxLines: 2),
    ]);
  }

  Future<void> _addItem() async {
    final name = TextEditingController();
    final qty = TextEditingController(text: '1');
    final unit = TextEditingController(text: 'Nos');
    final condition = TextEditingController();

    final added = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Add item'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: name,
                autofocus: true,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(labelText: 'Item'),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: qty,
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(labelText: 'Qty'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextField(
                      controller: unit,
                      decoration: const InputDecoration(labelText: 'Unit'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              TextField(
                controller: condition,
                decoration:
                    const InputDecoration(labelText: 'Condition / marks'),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Add'),
          ),
        ],
      ),
    );

    if (added != true || name.text.trim().isEmpty) return;

    setState(() {
      _items.add(ConsignmentItemModel(
        id: IdGenerator.generateId(),
        itemName: name.text.trim(),
        quantity: double.tryParse(qty.text.trim()) ?? 1,
        unit: unit.text.trim().isEmpty ? 'Nos' : unit.text.trim(),
        conditionNote: condition.text.trim(),
      ));
    });
  }

  double _number(TextEditingController controller) =>
      double.tryParse(controller.text.trim()) ?? 0;

  Future<void> _save() async {
    if (_consignorName.text.trim().isEmpty) {
      _tell('Who is sending the goods?');
      return;
    }
    if (_items.isEmpty && _goods.text.trim().isEmpty) {
      _tell('Write what is going - add an item or one line.');
      return;
    }

    setState(() => _saving = true);
    try {
      final saved = await ConsignmentRepository.instance.save(ConsignmentModel(
        id: _existing?.id ?? '',
        lrNo: _existing?.lrNo ?? '',
        lrDate: _lrDate.toIso8601String(),
        status: _existing?.status ?? ConsignmentStatus.booked,
        bookingId: _booking?.id ?? _existing?.bookingId ?? '',
        bookingNo: _booking?.bookingNo ?? _existing?.bookingNo ?? '',
        customerId: _booking?.customerId ?? _existing?.customerId ?? '',
        consignorName: _consignorName.text.trim(),
        consignorPhone: _consignorPhone.text.trim(),
        consignorAddress: _consignorAddress.text.trim(),
        consignorGst: _existing?.consignorGst ?? _booking?.customerGst ?? '',
        consigneeName: _sameAsSender
            ? _consignorName.text.trim()
            : _consigneeName.text.trim(),
        consigneePhone: _sameAsSender
            ? _consignorPhone.text.trim()
            : _consigneePhone.text.trim(),
        consigneeAddress: _sameAsSender
            ? _consignorAddress.text.trim()
            : _consigneeAddress.text.trim(),
        fromPlace: _from.text.trim(),
        toPlace: _to.text.trim(),
        vehicleNumber: _vehicle.text.trim(),
        driverName: _driver.text.trim(),
        driverPhone: _driverPhone.text.trim(),
        driverLicence: _licence.text.trim(),
        goodsDescription: _goods.text.trim(),
        packages: int.tryParse(_packages.text.trim()) ?? 0,
        weight: _weight.text.trim(),
        declaredValue: _number(_declaredValue),
        freightBasis: _freightBasis,
        freightAmount: _number(_freight),
        otherCharges: _number(_otherCharges),
        advancePaid: _number(_advance),
        riskBasis: _riskBasis,
        insured: _insured,
        insurer: _insurer.text.trim(),
        policyNo: _policy.text.trim(),
        deliveredOn: _existing?.deliveredOn ?? '',
        receivedBy: _existing?.receivedBy ?? '',
        deliveryRemarks: _existing?.deliveryRemarks ?? '',
        notes: _notes.text.trim(),
        createdAt: _existing?.createdAt ?? '',
        items: _items,
      ));

      if (!mounted) return;
      setState(() => _saving = false);
      context.pop(saved.id);
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      _tell('Could not save: $error');
    }
  }

  void _tell(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }
}
