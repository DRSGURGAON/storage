import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../billing/repositories/billing_repository.dart';
import '../../customers/models/customer_model.dart';
import '../../customers/repositories/customer_repository.dart';
import '../../storage_booking/models/storage_booking_model.dart';
import '../../storage_booking/repositories/storage_booking_repository.dart';
import '../models/notice_model.dart';
import '../repositories/notice_repository.dart';

/// Writing the letter: pick which one, check the amount, pick the date
/// to pay by. Everything else is filled in from the storage record.
class NoticeFormScreen extends StatefulWidget {
  /// The storage record the dues sit on, when the letter starts there.
  final String? bookingId;

  /// The customer, when the letter starts from their page instead.
  final String? customerId;

  const NoticeFormScreen({super.key, this.bookingId, this.customerId});

  @override
  State<NoticeFormScreen> createState() => _NoticeFormScreenState();
}

class _NoticeFormScreenState extends State<NoticeFormScreen> {
  static final _dateFormat = DateFormat('dd MMM yyyy');

  final _amount = TextEditingController();
  final _note = TextEditingController();

  NoticeKind _kind = NoticeKind.reminder;
  StorageBookingModel? _booking;
  CustomerModel? _customer;
  DateTime _payBy = DateTime.now().add(const Duration(days: 7));
  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    StorageBookingModel? booking;
    if ((widget.bookingId ?? '').isNotEmpty) {
      booking = await StorageBookingRepository.instance.getById(widget.bookingId!);
    }

    final customerId = booking?.customerId.isNotEmpty == true
        ? booking!.customerId
        : (widget.customerId ?? '');

    CustomerModel? customer;
    if (customerId.isNotEmpty) {
      customer = await CustomerRepository.instance.getById(customerId);
    }

    var due = 0.0;
    if (customerId.isNotEmpty) {
      final balance = await BillingRepository.instance.balanceForCustomer(customerId);
      due = balance.outstanding;
    }

    if (!mounted) return;
    setState(() {
      _booking = booking;
      _customer = customer;
      _amount.text = due > 0.004 ? due.toStringAsFixed(0) : '';
      _loading = false;
    });
  }

  String get _customerName =>
      _customer?.customerName ?? _booking?.customerName ?? '';

  String get _customerPhone =>
      _customer?.mobileNumber ?? _booking?.customerPhone ?? '';

  String get _customerAddress {
    final customer = _customer;
    if (customer != null) {
      final parts = [
        customer.address,
        customer.city,
        customer.state,
        customer.pincode,
      ].where((p) => p.trim().isNotEmpty);
      if (parts.isNotEmpty) return parts.join(', ');
    }
    final booking = _booking;
    if (booking == null) return '';
    return [booking.customerAddress, booking.customerCity, booking.customerState]
        .where((p) => p.trim().isNotEmpty)
        .join(', ');
  }

  void _pickKind(NoticeKind kind) {
    setState(() {
      _kind = kind;
      _payBy = DateTime.now().add(Duration(days: kind.defaultDays));
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/notices'),
        ),
        title: const Text('Send a Notice'),
        centerTitle: true,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 110),
              children: [
                _whoCard(),
                const SizedBox(height: 12),
                const Padding(
                  padding: EdgeInsets.fromLTRB(4, 4, 4, 8),
                  child: Text('Which letter?',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                ),
                for (final kind in NoticeKind.values) _kindCard(kind),
                const SizedBox(height: 12),
                _detailsCard(),
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
                    icon: const Icon(Icons.description_outlined),
                    label: Text(_saving ? 'Please wait...' : 'Make the letter'),
                    onPressed: _saving ? null : _save,
                  ),
                ),
              ),
            ),
    );
  }

  Widget _whoCard() {
    return Card(
      child: ListTile(
        leading: const CircleAvatar(child: Icon(Icons.person_outline)),
        title: Text(_customerName.isEmpty ? 'No customer' : _customerName,
            style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text([
          if (_customerPhone.isNotEmpty) _customerPhone,
          if ((_booking?.bookingNo ?? '').isNotEmpty) 'Storage ${_booking!.bookingNo}',
        ].join('  ·  ')),
      ),
    );
  }

  Widget _kindCard(NoticeKind kind) {
    final selected = _kind == kind;

    return Card(
      color: selected ? Theme.of(context).colorScheme.primaryContainer : null,
      child: ListTile(
        leading: Icon(
          switch (kind) {
            NoticeKind.reminder => Icons.notifications_outlined,
            NoticeKind.finalNotice => Icons.warning_amber_outlined,
            NoticeKind.disposal => Icons.gavel_outlined,
          },
          color: selected ? Theme.of(context).colorScheme.primary : null,
        ),
        title: Text(kind.label,
            style: TextStyle(
                fontWeight: selected ? FontWeight.bold : FontWeight.normal)),
        subtitle: Text(kind.hint),
        trailing: selected ? const Icon(Icons.check_circle) : null,
        onTap: () => _pickKind(kind),
      ),
    );
  }

  Widget _detailsCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: _amount,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: 'Amount outstanding',
                prefixText: '₹ ',
                helperText: 'Taken from the bills and payments - change if needed',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 14),
            OutlinedButton.icon(
              icon: const Icon(Icons.event_outlined, size: 18),
              label: Text('Pay by ${_dateFormat.format(_payBy)}'),
              onPressed: () async {
                final picked = await showDatePicker(
                  context: context,
                  initialDate: _payBy,
                  firstDate: DateTime.now(),
                  lastDate: DateTime.now().add(const Duration(days: 365)),
                );
                if (picked != null) setState(() => _payBy = picked);
              },
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _note,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'Anything to add (optional)',
                hintText: 'In your own words',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _save() async {
    final amount = double.tryParse(_amount.text.trim()) ?? 0;
    if (amount <= 0) {
      _tell('Enter the amount outstanding.');
      return;
    }
    if (_customerName.trim().isEmpty) {
      _tell('This letter needs a customer.');
      return;
    }

    setState(() => _saving = true);
    try {
      final notice = await NoticeRepository.instance.save(NoticeModel(
        id: '',
        noticeDate: DateTime.now().toIso8601String(),
        kind: _kind,
        customerId: _customer?.id ?? _booking?.customerId ?? '',
        bookingId: _booking?.id ?? '',
        customerName: _customerName,
        customerPhone: _customerPhone,
        customerAddress: _customerAddress,
        bookingNo: _booking?.bookingNo ?? '',
        amountDue: amount,
        dueAsOn: DateTime.now().toIso8601String(),
        payByDate: _payBy.toIso8601String(),
        bodyNote: _note.text.trim(),
        createdAt: '',
      ));

      if (!mounted) return;
      setState(() => _saving = false);
      context.pop(notice.id);
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
