import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/utils/id_generator.dart';
import '../../../shared/widgets/customer_name_field.dart';
import '../models/bill_model.dart';
import '../models/payment_model.dart';
import '../repositories/billing_repository.dart';

/// Receive a payment. Opened from a bill it fills in the customer and
/// the balance still due, so the operator only confirms.
class PaymentFormScreen extends StatefulWidget {
  /// The bill being settled, when there is one.
  final String? billId;

  /// The customer paying, when the payment is not against a bill.
  final String? customerId;

  const PaymentFormScreen({super.key, this.billId, this.customerId});

  @override
  State<PaymentFormScreen> createState() => _PaymentFormScreenState();
}

class _PaymentFormScreenState extends State<PaymentFormScreen> {
  static final _dateFormat = DateFormat('dd MMM yyyy');

  BillModel? _bill;
  bool _loading = true;
  bool _saving = false;

  final _payerName = TextEditingController();
  final _payerPhone = TextEditingController();
  final _amount = TextEditingController();
  final _reference = TextEditingController();
  final _against = TextEditingController();
  final _notes = TextEditingController();

  String _customerId = '';
  String _bookingId = '';
  DateTime _paymentDate = DateTime.now();
  PaymentMode _mode = PaymentMode.cash;
  PaymentType _type = PaymentType.fullPayment;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (widget.billId != null) {
      final bill = await BillingRepository.instance.getBillById(widget.billId!);
      if (bill != null) {
        _bill = bill;
        _customerId = bill.customerId;
        _bookingId = bill.bookingId;
        _payerName.text = bill.customerName;
        _payerPhone.text = bill.customerPhone;
        _amount.text = bill.balanceDue.toStringAsFixed(2);
        _type = bill.balanceDue >= bill.grandTotal
            ? PaymentType.fullPayment
            : PaymentType.partPayment;
        _against.text = 'Bill ${bill.billNo}';
      }
    } else if (widget.customerId != null) {
      _customerId = widget.customerId!;
      final balance =
          await BillingRepository.instance.balanceForCustomer(widget.customerId!);
      _payerName.text = balance.customerName;
      if (balance.outstanding > 0) {
        _amount.text = balance.outstanding.toStringAsFixed(2);
      }
    }

    if (mounted) setState(() => _loading = false);
  }

  @override
  void dispose() {
    for (final c in [_payerName, _payerPhone, _amount, _reference, _against, _notes]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final amount = double.tryParse(_amount.text.trim().replaceAll(',', '')) ?? 0;

    if (_payerName.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter who paid.')),
      );
      return;
    }
    if (amount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter the amount received.')),
      );
      return;
    }

    setState(() => _saving = true);
    try {
      final saved = await BillingRepository.instance.recordPayment(PaymentModel(
        id: IdGenerator.generateId(),
        billId: _bill?.id ?? '',
        customerId: _customerId,
        bookingId: _bookingId,
        payerName: _payerName.text.trim(),
        payerPhone: _payerPhone.text.trim(),
        against: _against.text.trim(),
        amount: amount,
        mode: _mode,
        paymentType: _type,
        paymentDate: _paymentDate.toIso8601String(),
        referenceNo: _reference.text.trim(),
        notes: _notes.text.trim(),
        createdAt: '',
      ));

      if (!mounted) return;
      context.pop(saved.id);
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not save: $error')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final bill = _bill;

    return Scaffold(
      appBar: AppBar(title: const Text('Receive Payment'), centerTitle: true),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (bill != null)
                  Card(
                    color: Theme.of(context).colorScheme.primaryContainer,
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Bill ${bill.billNo}',
                              style: const TextStyle(fontWeight: FontWeight.bold)),
                          const SizedBox(height: 4),
                          Text('Total ₹${bill.grandTotal.toStringAsFixed(2)}  •  '
                              'Received ₹${bill.amountPaid.toStringAsFixed(2)}'),
                          Text('Balance ₹${bill.balanceDue.toStringAsFixed(2)}',
                              style: const TextStyle(fontWeight: FontWeight.bold)),
                        ],
                      ),
                    ),
                  ),
                if (bill != null) const SizedBox(height: 16),

                if (bill == null) ...[
                  CustomerNameField(
                    controller: _payerName,
                    label: 'Received from *',
                    onSelected: (s) => setState(() {
                      _customerId = s.customerId;
                      if (_payerPhone.text.trim().isEmpty) _payerPhone.text = s.phone;
                    }),
                  ),
                  const SizedBox(height: 12),
                ] else ...[
                  TextField(
                    controller: _payerName,
                    decoration: const InputDecoration(labelText: 'Received from *'),
                  ),
                  const SizedBox(height: 12),
                ],
                TextField(
                  controller: _payerPhone,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(labelText: 'Mobile'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _amount,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                  decoration: const InputDecoration(
                    labelText: 'Amount received (₹) *',
                    prefixText: '₹ ',
                  ),
                ),
                const SizedBox(height: 16),
                const Text('How was it paid?'),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  children: [
                    for (final option in PaymentMode.values)
                      ChoiceChip(
                        label: Text(option.label),
                        selected: _mode == option,
                        onSelected: (_) => setState(() => _mode = option),
                      ),
                  ],
                ),
                const SizedBox(height: 16),
                const Text('What is it for?'),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  children: [
                    for (final option in PaymentType.values)
                      ChoiceChip(
                        label: Text(option.label),
                        selected: _type == option,
                        onSelected: (_) => setState(() => _type = option),
                      ),
                  ],
                ),
                const SizedBox(height: 16),
                InkWell(
                  onTap: () async {
                    final picked = await showDatePicker(
                      context: context,
                      initialDate: _paymentDate,
                      firstDate: DateTime(2015),
                      lastDate: DateTime(2100),
                    );
                    if (picked != null) setState(() => _paymentDate = picked);
                  },
                  borderRadius: BorderRadius.circular(8),
                  child: InputDecorator(
                    decoration: const InputDecoration(
                      labelText: 'Payment date',
                      suffixIcon: Icon(Icons.calendar_today_outlined, size: 18),
                    ),
                    child: Text(_dateFormat.format(_paymentDate)),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _reference,
                  decoration: const InputDecoration(
                    labelText: 'Reference / UTR / cheque no.',
                  ),
                ),
                if (bill == null) ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: _against,
                    decoration: const InputDecoration(
                      labelText: 'Against',
                      hintText: 'Advance for storage, security deposit...',
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                TextField(
                  controller: _notes,
                  maxLines: 2,
                  decoration: const InputDecoration(labelText: 'Note'),
                ),
                const SizedBox(height: 24),
                FilledButton.icon(
                  onPressed: _saving ? null : _save,
                  icon: _saving
                      ? const SizedBox(
                          width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.check),
                  label: const Text('Save and make receipt'),
                ),
                const SizedBox(height: 24),
              ],
            ),
    );
  }
}
