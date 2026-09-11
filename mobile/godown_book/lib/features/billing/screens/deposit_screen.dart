import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../storage_booking/models/storage_booking_model.dart';
import '../../storage_booking/repositories/storage_booking_repository.dart';
import '../models/payment_model.dart';
import '../repositories/billing_repository.dart';

/// The security deposit on one storage record, in plain language: what
/// was agreed, what came in, what went back, and what the godown is
/// still holding. Three buttons, one job each.
class DepositScreen extends StatefulWidget {
  final String bookingId;

  const DepositScreen({super.key, required this.bookingId});

  @override
  State<DepositScreen> createState() => _DepositScreenState();
}

class _DepositScreenState extends State<DepositScreen> {
  static final _dateFormat = DateFormat('dd MMM yyyy');

  StorageBookingModel? _booking;
  DepositSummary _deposit = const DepositSummary();
  List<PaymentModel> _entries = const [];
  double _outstanding = 0;
  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final booking = await StorageBookingRepository.instance.getById(widget.bookingId);
    final deposit = await BillingRepository.instance.depositForBooking(
      widget.bookingId,
      agreed: booking?.securityDeposit ?? 0,
    );
    final entries =
        await BillingRepository.instance.getDepositEntriesForBooking(widget.bookingId);

    var outstanding = 0.0;
    if ((booking?.customerId ?? '').isNotEmpty) {
      final balance =
          await BillingRepository.instance.balanceForCustomer(booking!.customerId);
      outstanding = balance.outstanding;
    }

    if (!mounted) return;
    setState(() {
      _booking = booking;
      _deposit = deposit;
      _entries = entries..sort((a, b) => b.paymentDate.compareTo(a.paymentDate));
      _outstanding = outstanding;
      _loading = false;
    });
  }

  String _money(double value) => '₹${value.toStringAsFixed(0)}';

  String _date(String iso) {
    final parsed = DateTime.tryParse(iso);
    return parsed == null ? '-' : _dateFormat.format(parsed);
  }

  @override
  Widget build(BuildContext context) {
    final booking = _booking;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/storage'),
        ),
        title: const Text('Security Deposit'),
        centerTitle: true,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : booking == null
              ? const Center(child: Text('Storage record not found.'))
              : ListView(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
                  children: [
                    _heldCard(booking),
                    const SizedBox(height: 12),
                    _actions(booking),
                    const SizedBox(height: 12),
                    _historyCard(),
                    const SizedBox(height: 16),
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 4),
                      child: Text(
                        'A deposit is the customer\'s money kept with you. It is '
                        'not counted as rent received, so it never makes a '
                        'customer look paid up.',
                        style: TextStyle(fontSize: 12, color: Colors.black54),
                      ),
                    ),
                  ],
                ),
    );
  }

  Widget _heldCard(StorageBookingModel booking) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(booking.customerName,
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            Text('Storage ${booking.bookingNo}',
                style: const TextStyle(fontSize: 12, color: Colors.black54)),
            const SizedBox(height: 14),
            Text(_money(_deposit.held),
                style: const TextStyle(fontSize: 34, fontWeight: FontWeight.bold)),
            const Text('with you right now',
                style: TextStyle(fontSize: 13, color: Colors.black54)),
            const SizedBox(height: 14),
            _row('Agreed on the storage record', _money(_deposit.agreed)),
            _row('Deposit received', _money(_deposit.received)),
            if (_deposit.returned > 0.004)
              _row('Returned to customer', _money(_deposit.returned)),
            if (_deposit.adjusted > 0.004)
              _row('Adjusted against dues', _money(_deposit.adjusted)),
            if (_deposit.notYetTaken > 0.004)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  '${_money(_deposit.notYetTaken)} of the agreed deposit has no '
                  'receipt yet.',
                  style: const TextStyle(fontSize: 12, color: Colors.deepOrange),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _row(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(child: Text(label, style: const TextStyle(fontSize: 13))),
          Text(value,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _actions(StorageBookingModel booking) {
    return Card(
      child: Column(
        children: [
          ListTile(
            leading: const Icon(Icons.savings_outlined, color: Colors.teal),
            title: const Text('Deposit received'),
            subtitle: const Text('Take the deposit and print a receipt'),
            trailing: const Icon(Icons.chevron_right),
            onTap: _saving
                ? null
                : () => _ask(
                      booking,
                      PaymentType.securityDeposit,
                      title: 'Deposit received',
                      suggested: _deposit.notYetTaken > 0.004
                          ? _deposit.notYetTaken
                          : _deposit.agreed,
                    ),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.reply_outlined, color: Colors.indigo),
            title: const Text('Return the deposit'),
            subtitle: const Text('Give it back and print a refund voucher'),
            enabled: _deposit.held > 0.004,
            trailing: const Icon(Icons.chevron_right),
            onTap: _saving || _deposit.held <= 0.004
                ? null
                : () => _ask(
                      booking,
                      PaymentType.depositRefund,
                      title: 'Return the deposit',
                      suggested: _deposit.held,
                    ),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.call_merge_outlined, color: Colors.brown),
            title: const Text('Keep it against the dues'),
            subtitle: Text(
              _outstanding > 0.004
                  ? 'Outstanding ${_money(_outstanding)}'
                  : 'Nothing is outstanding',
            ),
            enabled: _deposit.held > 0.004,
            trailing: const Icon(Icons.chevron_right),
            onTap: _saving || _deposit.held <= 0.004
                ? null
                : () => _ask(
                      booking,
                      PaymentType.depositAdjusted,
                      title: 'Keep it against the dues',
                      suggested: _outstanding > 0.004 && _outstanding < _deposit.held
                          ? _outstanding
                          : _deposit.held,
                    ),
          ),
        ],
      ),
    );
  }

  Widget _historyCard() {
    if (_entries.isEmpty) {
      return const Card(
        child: ListTile(
          leading: Icon(Icons.history),
          title: Text('No deposit entry yet'),
          subtitle: Text('Whatever you record here will show in this list.'),
        ),
      );
    }

    return Card(
      child: Column(
        children: [
          for (var i = 0; i < _entries.length; i++) ...[
            if (i > 0) const Divider(height: 1),
            ListTile(
              leading: Icon(
                _entries[i].paymentType.isDepositIn
                    ? Icons.arrow_downward
                    : Icons.arrow_upward,
                color: _entries[i].paymentType.isDepositIn
                    ? Colors.teal
                    : Colors.indigo,
              ),
              title: Text(
                  '${_money(_entries[i].amount)}  ·  ${_entries[i].paymentType.label}'),
              subtitle: Text(
                  '${_date(_entries[i].paymentDate)}  ·  ${_entries[i].receiptNo}'),
              trailing: const Icon(Icons.picture_as_pdf_outlined),
              onTap: () async {
                await context.push('/receipt-pdf', extra: _entries[i].id);
                _load();
              },
            ),
          ],
        ],
      ),
    );
  }

  /// One sheet for all three actions: how much, and on what date.
  Future<void> _ask(
    StorageBookingModel booking,
    PaymentType type, {
    required String title,
    required double suggested,
  }) async {
    final amount = TextEditingController(
        text: suggested > 0.004 ? suggested.toStringAsFixed(0) : '');
    var date = DateTime.now();
    var mode = PaymentMode.cash;

    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (sheetContext, setSheetState) => Padding(
          padding: EdgeInsets.fromLTRB(
              16, 16, 16, MediaQuery.of(sheetContext).viewInsets.bottom + 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title,
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold)),
              const SizedBox(height: 12),
              TextField(
                controller: amount,
                autofocus: true,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(
                  labelText: 'Amount',
                  prefixText: '₹ ',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              if (type != PaymentType.depositAdjusted)
                DropdownButtonFormField<PaymentMode>(
                  initialValue: mode,
                  decoration: const InputDecoration(
                    labelText: 'How',
                    border: OutlineInputBorder(),
                  ),
                  items: [
                    for (final option in PaymentMode.values)
                      DropdownMenuItem(value: option, child: Text(option.label)),
                  ],
                  onChanged: (value) =>
                      setSheetState(() => mode = value ?? PaymentMode.cash),
                ),
              if (type != PaymentType.depositAdjusted) const SizedBox(height: 12),
              OutlinedButton.icon(
                icon: const Icon(Icons.calendar_today, size: 18),
                label: Text(_dateFormat.format(date)),
                onPressed: () async {
                  final picked = await showDatePicker(
                    context: sheetContext,
                    initialDate: date,
                    firstDate: DateTime(2020),
                    lastDate: DateTime.now().add(const Duration(days: 365)),
                  );
                  if (picked != null) setSheetState(() => date = picked);
                },
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () => Navigator.of(sheetContext).pop(true),
                  child: const Text('Save'),
                ),
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
    );

    if (saved != true) return;

    final value = double.tryParse(amount.text.trim()) ?? 0;
    if (value <= 0) {
      _tell('Enter an amount first.');
      return;
    }
    if (type != PaymentType.securityDeposit && value > _deposit.held + 0.004) {
      _tell('You are holding only ${_money(_deposit.held)}.');
      return;
    }

    setState(() => _saving = true);
    try {
      final payment = await BillingRepository.instance.recordPayment(PaymentModel(
        id: '',
        customerId: booking.customerId,
        bookingId: booking.id,
        payerName: booking.customerName,
        payerPhone: booking.customerPhone,
        amount: value,
        mode: type == PaymentType.depositAdjusted ? PaymentMode.other : mode,
        paymentType: type,
        paymentDate: date.toIso8601String(),
        against: switch (type) {
          PaymentType.securityDeposit =>
            'Security deposit for storage ${booking.bookingNo}',
          PaymentType.depositRefund =>
            'Deposit returned on storage ${booking.bookingNo}',
          _ => 'Deposit adjusted against dues',
        },
        createdAt: '',
      ));

      if (!mounted) return;
      setState(() => _saving = false);
      await _load();

      if (!mounted) return;
      await context.push('/receipt-pdf', extra: payment.id);
      if (mounted) _load();
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      _tell('Could not save: $error');
    }
  }

  void _tell(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }
}
