import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../../shared/widgets/save_problem.dart';

import '../../billing/repositories/billing_repository.dart';
import '../../billing/services/storage_charge_calculator.dart';
import '../../storage_booking/models/booking_item_model.dart';
import '../../storage_booking/models/storage_booking_model.dart';
import '../../storage_booking/models/storage_status.dart';
import '../../storage_booking/repositories/storage_booking_repository.dart';
import '../models/goods_release_model.dart';
import '../repositories/goods_release_repository.dart';

/// Release goods back to the customer. Opened from a storage record it
/// lists everything still with us, with quantities filled in.
class ReleaseFormScreen extends StatefulWidget {
  /// The storage record the goods are going out of.
  final String? bookingId;

  /// A release already recorded, when a wrong entry is corrected.
  final String? editReleaseId;

  const ReleaseFormScreen({super.key, this.bookingId, this.editReleaseId});

  @override
  State<ReleaseFormScreen> createState() => _ReleaseFormScreenState();
}

class _ReleaseFormScreenState extends State<ReleaseFormScreen> {
  static final _dateFormat = DateFormat('dd MMM yyyy');

  StorageBookingModel? _booking;
  List<StorageBookingModel> _openBookings = const [];
  GoodsReleaseModel? _draft;

  /// The release being corrected, when editing.
  GoodsReleaseModel? _existing;
  double _outstanding = 0;
  bool _loading = true;
  bool _saving = false;

  final _collectedByName = TextEditingController();
  final _collectedByPhone = TextEditingController();
  final _collectedByIdProof = TextEditingController();
  final _vehicleNumber = TextEditingController();
  final _driverName = TextEditingController();
  final _remarks = TextEditingController();

  DateTime _releaseDate = DateTime.now();
  final Map<String, TextEditingController> _quantities = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    _openBookings = await StorageBookingRepository.instance.getOpen();

    if (widget.editReleaseId != null) {
      final existing =
          await GoodsReleaseRepository.instance.getById(widget.editReleaseId!);
      if (existing != null) {
        _existing = existing;
        await _selectBooking(
          await StorageBookingRepository.instance.getById(existing.bookingId),
          existing: existing,
        );
      }
    } else if (widget.bookingId != null) {
      await _selectBooking(
        await StorageBookingRepository.instance.getById(widget.bookingId!),
      );
    }

    if (mounted) setState(() => _loading = false);
  }

  /// Shows [booking]'s goods. When correcting [existing], what that
  /// release took out counts as still available (it is being decided
  /// again), and its own quantities are filled in.
  Future<void> _selectBooking(
    StorageBookingModel? booking, {
    GoodsReleaseModel? existing,
  }) async {
    if (booking == null) return;

    var draft = GoodsReleaseRepository.instance.draftForBooking(booking);
    final earlier = <String, ReleaseItemModel>{
      for (final item in existing?.items ?? const <ReleaseItemModel>[])
        item.bookingItemId: item,
    };
    if (existing != null) {
      draft = existing.copyWith(
        items: [
          for (final item in booking.items)
            if (item.remainingQty + (earlier[item.id]?.quantity ?? 0) > 0)
              ReleaseItemModel(
                id: earlier[item.id]?.id ?? '',
                bookingItemId: item.id,
                itemName: item.itemName,
                quantity: item.remainingQty + (earlier[item.id]?.quantity ?? 0),
                unit: item.unit,
              ),
        ],
      );
      _collectedByIdProof.text = existing.collectedByIdProof;
      _vehicleNumber.text = existing.vehicleNumber;
      _driverName.text = existing.driverName;
      _remarks.text = existing.remarks;
      _releaseDate = DateTime.tryParse(existing.releaseDate) ?? _releaseDate;
    }

    var outstanding = 0.0;
    if (booking.customerId.isNotEmpty) {
      try {
        final balance =
            await BillingRepository.instance.balanceForCustomer(booking.customerId);
        outstanding = balance.outstanding;
      } catch (_) {}
    }

    for (final controller in _quantities.values) {
      controller.dispose();
    }
    _quantities.clear();
    for (final item in draft.items) {
      final typed = existing == null
          ? item.quantity
          : (earlier[item.bookingItemId]?.quantity ?? 0);
      _quantities[item.bookingItemId] = TextEditingController(text: _num(typed));
    }

    if (!mounted) return;
    setState(() {
      _booking = booking;
      _draft = draft;
      _outstanding = outstanding;
      _collectedByName.text =
          existing?.collectedByName ?? booking.customerName;
      _collectedByPhone.text =
          existing?.collectedByPhone ?? booking.customerPhone;
    });
  }

  static String _num(double v) =>
      v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toString();

  @override
  void dispose() {
    for (final c in [
      _collectedByName, _collectedByPhone, _collectedByIdProof,
      _vehicleNumber, _driverName, _remarks,
    ]) {
      c.dispose();
    }
    for (final controller in _quantities.values) {
      controller.dispose();
    }
    super.dispose();
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
              title: Text('Whose goods are going out?',
                  style: TextStyle(fontWeight: FontWeight.bold)),
            ),
            const Divider(height: 1),
            for (final booking in _openBookings)
              ListTile(
                leading: const Icon(Icons.inventory_2_outlined),
                title: Text('${booking.customerName}  •  ${booking.bookingNo}'),
                subtitle: Text(
                  '${_num(booking.remainingQuantity)} in stock'
                  '${booking.locationName.isEmpty ? '' : '  •  ${booking.locationName}'}',
                ),
                onTap: () => Navigator.pop(sheetContext, booking),
              ),
          ],
        ),
      ),
    );

    if (selected != null) await _selectBooking(selected);
  }

  Future<void> _save() async {
    final draft = _draft;
    final booking = _booking;
    if (draft == null || booking == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pick whose goods are going out.')),
      );
      return;
    }

    final items = <ReleaseItemModel>[];
    for (final item in draft.items) {
      final typed = double.tryParse(_quantities[item.bookingItemId]?.text.trim() ?? '') ?? 0;
      if (typed > 0) items.add(item.copyWith(quantity: typed));
    }

    if (items.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter what is going out.')),
      );
      return;
    }

    // What is available to go out: what is left, plus - when correcting
    // a release - what that release itself had taken.
    final earlier = <String, double>{
      for (final item in _existing?.items ?? const <ReleaseItemModel>[])
        item.bookingItemId: item.quantity,
    };
    double available(BookingItemModel i) => i.remainingQty + (earlier[i.id] ?? 0);

    // Catch an over-release here, where the operator can still see
    // which line is wrong. Without this the repository throws after the
    // release row has been written and rolled back, and the message
    // that reaches the screen is a technical one.
    for (final item in items) {
      final matches = booking.items.where((i) => i.id == item.bookingItemId);
      if (matches.isEmpty) continue;
      final source = matches.first;
      final left = available(source);
      if (item.quantity > left) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Only ${_num(left)} left of ${source.itemName} - '
              'you entered ${_num(item.quantity)}.',
            ),
          ),
        );
        return;
      }
    }

    final everything = items.length == booking.items.where((i) => available(i) > 0).length &&
        items.every((item) {
          final source = booking.items.firstWhere((i) => i.id == item.bookingItemId);
          return item.quantity >= available(source);
        });

    setState(() => _saving = true);
    try {
      final corrected = draft.copyWith(
        releaseDate: _releaseDate.toIso8601String(),
        releaseType: everything ? ReleaseType.full : ReleaseType.partial,
        collectedByName: _collectedByName.text.trim(),
        collectedByPhone: _collectedByPhone.text.trim(),
        collectedByIdProof: _collectedByIdProof.text.trim(),
        vehicleNumber: _vehicleNumber.text.trim().toUpperCase(),
        driverName: _driverName.text.trim(),
        gateOutTime: _existing?.gateOutTime.isNotEmpty == true
            ? _existing!.gateOutTime
            : TimeOfDay.fromDateTime(DateTime.now()).format(context),
        remarks: _remarks.text.trim(),
        items: items,
      );
      final saved = _existing == null
          ? await GoodsReleaseRepository.instance.save(corrected)
          : await GoodsReleaseRepository.instance.update(corrected);

      if (!mounted) return;
      await _offerFinalBill(saved.bookingId);
      if (!mounted) return;
      context.pop(saved.id);
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      showSaveProblem(context, error);
    }
  }

  /// Once the last of the goods has gone out, rent stops on that day -
  /// and whatever ran up to it is usually still unbilled. Offer the
  /// final bill right here so it is not forgotten; "Later" leaves the
  /// storage record showing "Make Final Bill" until it is done.
  Future<void> _offerFinalBill(String bookingId) async {
    final closed = await StorageBookingRepository.instance.getById(bookingId);
    if (closed == null ||
        closed.status != StorageStatus.released ||
        !StorageChargeCalculator.hasUnbilledRent(closed)) {
      return;
    }
    if (!mounted) return;

    final makeBill = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Make the final bill?'),
        content: Text(
          'All goods have gone out. Rent up to '
          '${_dateFormat.format(DateTime.tryParse(closed.actualEndDate) ?? DateTime.now())} '
          'has not been billed yet.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Later'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Make Final Bill'),
          ),
        ],
      ),
    );
    if (makeBill == true && mounted) {
      await context.push('/bill-create', extra: bookingId);
    }
  }

  @override
  Widget build(BuildContext context) {
    final draft = _draft;

    return Scaffold(
      appBar: AppBar(
        title: Text(_existing == null
            ? 'Release Goods'
            : 'Edit Release ${_existing!.releaseNo}'),
        centerTitle: true,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.inventory_2_outlined),
                    title: Text(_booking == null
                        ? 'Pick a customer'
                        : '${_booking!.customerName}  •  ${_booking!.bookingNo}'),
                    subtitle: Text(_booking == null
                        ? 'Whose goods are going out'
                        : '${_num(_booking!.remainingQuantity)} still in storage'),
                    trailing: _existing == null
                        ? const Icon(Icons.chevron_right)
                        : null,
                    // A release is corrected on the record it was made
                    // on; it never moves to another customer.
                    onTap: _existing == null ? _pickBooking : null,
                  ),
                ),
                if (_outstanding > 0) ...[
                  const SizedBox(height: 12),
                  Card(
                    color: Colors.red.shade50,
                    child: ListTile(
                      leading: Icon(Icons.warning_amber_rounded, color: Colors.red.shade700),
                      title: Text(
                        '₹${_outstanding.toStringAsFixed(0)} still unpaid',
                        style: TextStyle(
                            color: Colors.red.shade900, fontWeight: FontWeight.bold),
                      ),
                      subtitle: const Text('Collect the dues before the goods leave.'),
                      trailing: TextButton(
                        onPressed: () async {
                          await context.push('/payment-create',
                              extra: {'customerId': _booking?.customerId});
                          if (_booking != null) await _selectBooking(_booking);
                        },
                        child: const Text('Receive'),
                      ),
                    ),
                  ),
                ],
                if (draft != null) ...[
                  const SizedBox(height: 20),
                  _section('What is going out'),
                  for (final item in draft.items)
                    Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(item.itemName,
                                      style: const TextStyle(fontWeight: FontWeight.w500)),
                                  Text('${_num(item.quantity)} ${item.unit} in storage',
                                      style: const TextStyle(fontSize: 12, color: Colors.grey)),
                                ],
                              ),
                            ),
                            SizedBox(
                              width: 90,
                              child: TextField(
                                textInputAction: TextInputAction.next,
                                controller: _quantities[item.bookingItemId],
                                keyboardType:
                                    const TextInputType.numberWithOptions(decimal: true),
                                textAlign: TextAlign.right,
                                decoration: const InputDecoration(
                                  labelText: 'Going',
                                  isDense: true,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  const SizedBox(height: 20),
                  _section('Who is collecting'),
                  TextField(
                    textInputAction: TextInputAction.next,
                    controller: _collectedByName,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(labelText: 'Collected by'),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          textInputAction: TextInputAction.next,
                          controller: _collectedByPhone,
                          keyboardType: TextInputType.phone,
                          decoration: const InputDecoration(labelText: 'Mobile'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          textInputAction: TextInputAction.next,
                          controller: _collectedByIdProof,
                          decoration: const InputDecoration(labelText: 'ID shown'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  _section('Taken away in'),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          textInputAction: TextInputAction.next,
                          controller: _vehicleNumber,
                          textCapitalization: TextCapitalization.characters,
                          decoration: const InputDecoration(labelText: 'Vehicle no.'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          textInputAction: TextInputAction.next,
                          controller: _driverName,
                          textCapitalization: TextCapitalization.words,
                          decoration: const InputDecoration(labelText: 'Driver'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  InkWell(
                    onTap: () async {
                      final picked = await showDatePicker(
                        context: context,
                        initialDate: _releaseDate,
                        firstDate: DateTime(2015),
                        lastDate: DateTime(2100),
                      );
                      if (picked != null) setState(() => _releaseDate = picked);
                    },
                    borderRadius: BorderRadius.circular(8),
                    child: InputDecorator(
                      decoration: const InputDecoration(
                        labelText: 'Release date',
                        suffixIcon: Icon(Icons.calendar_today_outlined, size: 18),
                      ),
                      child: Text(_dateFormat.format(_releaseDate)),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _remarks,
                    maxLines: 2,
                    decoration: const InputDecoration(labelText: 'Remarks'),
                  ),
                  const SizedBox(height: 24),
                  FilledButton.icon(
                    onPressed: _saving ? null : _save,
                    icon: _saving
                        ? const SizedBox(
                            width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.outbox_outlined),
                    label: Text(_existing == null ? 'Release goods' : 'Save changes'),
                  ),
                  const SizedBox(height: 24),
                ],
              ],
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
