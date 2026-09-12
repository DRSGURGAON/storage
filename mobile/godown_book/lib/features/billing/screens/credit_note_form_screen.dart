import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/utils/id_generator.dart';
import '../../../shared/widgets/save_problem.dart';
import '../models/bill_model.dart';
import '../models/payment_model.dart';
import '../repositories/billing_repository.dart';

/// Issue a credit note against a bill - a waiver, a goodwill discount,
/// or a correction. No money moves; the bill simply comes down by the
/// amount, and the customer gets a numbered paper saying so.
class CreditNoteFormScreen extends StatefulWidget {
  final String billId;

  const CreditNoteFormScreen({super.key, required this.billId});

  @override
  State<CreditNoteFormScreen> createState() => _CreditNoteFormScreenState();
}

class _CreditNoteFormScreenState extends State<CreditNoteFormScreen> {
  static final _dateFormat = DateFormat('dd MMM yyyy');

  BillModel? _bill;
  bool _loading = true;
  bool _saving = false;

  final _amount = TextEditingController();
  final _reason = TextEditingController();
  DateTime _date = DateTime.now();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final bill = await BillingRepository.instance.getBillById(widget.billId);
    if (!mounted) return;
    setState(() {
      _bill = bill;
      _loading = false;
    });
  }

  @override
  void dispose() {
    _amount.dispose();
    _reason.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final bill = _bill;
    if (bill == null) return;

    final amount = double.tryParse(_amount.text.trim().replaceAll(',', '')) ?? 0;
    if (amount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter the amount to credit.')),
      );
      return;
    }
    if (amount > bill.balanceDue + 0.004) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Only ₹${bill.balanceDue.toStringAsFixed(2)} is still due on this bill.',
          ),
        ),
      );
      return;
    }
    if (_reason.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Say why the credit is being given.')),
      );
      return;
    }

    setState(() => _saving = true);
    try {
      final saved = await BillingRepository.instance.recordPayment(PaymentModel(
        id: IdGenerator.generateId(),
        billId: bill.id,
        customerId: bill.customerId,
        bookingId: bill.bookingId,
        payerName: bill.customerName,
        payerPhone: bill.customerPhone,
        against: 'Bill ${bill.billNo}',
        amount: amount,
        mode: PaymentMode.other,
        paymentType: PaymentType.creditNote,
        paymentDate: _date.toIso8601String(),
        notes: _reason.text.trim(),
        createdAt: '',
      ));

      if (!mounted) return;
      context.pop(saved.id);
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      showSaveProblem(context, error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bill = _bill;

    return Scaffold(
      appBar: AppBar(title: const Text('Issue Credit Note'), centerTitle: true),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : bill == null
              ? const Center(child: Text('Bill not found.'))
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Card(
                      color: Theme.of(context).colorScheme.primaryContainer,
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Bill ${bill.billNo}  •  ${bill.customerName}',
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
                    const SizedBox(height: 16),
                    TextField(
                      controller: _amount,
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                      decoration: const InputDecoration(
                        labelText: 'Amount to credit (₹) *',
                        prefixText: '₹ ',
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _reason,
                      maxLines: 3,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: const InputDecoration(
                        labelText: 'Reason *',
                        hintText: 'Handling charge waived, rent reduced for '
                            'the damaged carton, and so on',
                      ),
                    ),
                    const SizedBox(height: 12),
                    InkWell(
                      onTap: () async {
                        final picked = await showDatePicker(
                          context: context,
                          initialDate: _date,
                          firstDate: DateTime(2015),
                          lastDate: DateTime(2100),
                        );
                        if (picked != null) setState(() => _date = picked);
                      },
                      borderRadius: BorderRadius.circular(8),
                      child: InputDecorator(
                        decoration: const InputDecoration(
                          labelText: 'Date',
                          suffixIcon: Icon(Icons.calendar_today_outlined, size: 18),
                        ),
                        child: Text(_dateFormat.format(_date)),
                      ),
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'The bill comes down by this amount and the credit note '
                      'prints with its own number. Nothing is recorded as '
                      'money received.',
                      style: TextStyle(fontSize: 12, color: Colors.black54),
                    ),
                    const SizedBox(height: 24),
                    FilledButton.icon(
                      onPressed: _saving ? null : _save,
                      icon: _saving
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.check),
                      label: const Text('Save and print credit note'),
                    ),
                    const SizedBox(height: 24),
                  ],
                ),
    );
  }
}
