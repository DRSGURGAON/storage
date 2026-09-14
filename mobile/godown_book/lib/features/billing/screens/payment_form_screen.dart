import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/utils/id_generator.dart';
import '../../../shared/widgets/customer_name_field.dart';
import '../../../shared/widgets/save_problem.dart';
import '../../voice_entry/models/voice_payment_draft.dart';
import '../../voice_entry/models/voice_reading.dart';
import '../../voice_entry/services/voice_payment_parser.dart';
import '../../voice_entry/widgets/voice_entry_sheet.dart';
import '../../voice_entry/widgets/voice_fill.dart';
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

  /// A receipt already issued, when a wrong entry is being corrected.
  final String? editPaymentId;

  const PaymentFormScreen({
    super.key,
    this.billId,
    this.customerId,
    this.editPaymentId,
  });

  @override
  State<PaymentFormScreen> createState() => _PaymentFormScreenState();
}

class _PaymentFormScreenState extends State<PaymentFormScreen>
    with VoiceFill {
  static final _dateFormat = DateFormat('dd MMM yyyy');

  BillModel? _bill;

  /// The receipt being corrected, when editing.
  PaymentModel? _existing;

  /// Bills of the customer that still owe money, when the screen was
  /// opened for a customer rather than a bill - the operator picks
  /// which one this receipt settles (oldest is picked for them).
  List<BillModel> _openBills = const [];
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
    if (widget.editPaymentId != null) {
      await _loadExisting(widget.editPaymentId!);
    } else if (widget.billId != null) {
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
      // Money received from a customer settles their bills - oldest
      // first - not a nameless "on account" entry that leaves every
      // bill showing as unpaid. On account stays available when they
      // owe nothing, or when the operator picks it deliberately.
      _openBills =
          await BillingRepository.instance.openBillsForCustomer(widget.customerId!);
      if (_openBills.isNotEmpty) {
        _applyBill(_openBills.first);
      } else if (balance.outstanding > 0) {
        _amount.text = balance.outstanding.toStringAsFixed(2);
      }
    }

    if (mounted) setState(() => _loading = false);
  }

  /// Fills the form with a receipt already issued, so the operator
  /// changes only what was wrong. The bill it settles stays what it
  /// was; the receipt number never changes.
  Future<void> _loadExisting(String paymentId) async {
    final payment = await BillingRepository.instance.getPaymentById(paymentId);
    if (payment == null) return;
    _existing = payment;
    if (payment.billId.isNotEmpty) {
      _bill = await BillingRepository.instance.getBillById(payment.billId);
    }
    _customerId = payment.customerId;
    _bookingId = payment.bookingId;
    _payerName.text = payment.payerName;
    _payerPhone.text = payment.payerPhone;
    _amount.text = payment.amount == payment.amount.roundToDouble()
        ? payment.amount.toStringAsFixed(0)
        : payment.amount.toStringAsFixed(2);
    _against.text = payment.against;
    _reference.text = payment.referenceNo;
    _notes.text = payment.notes;
    _mode = payment.mode;
    _type = payment.paymentType;
    _paymentDate = DateTime.tryParse(payment.paymentDate) ?? _paymentDate;
  }

  /// Points this receipt at [bill] (or at nothing, for on account).
  void _applyBill(BillModel? bill) {
    _bill = bill;
    if (bill == null) {
      _bookingId = '';
      _amount.clear();
      _against.clear();
      _type = PaymentType.advance;
      return;
    }
    _customerId = bill.customerId.isEmpty ? _customerId : bill.customerId;
    _bookingId = bill.bookingId;
    if (_payerName.text.trim().isEmpty) _payerName.text = bill.customerName;
    if (_payerPhone.text.trim().isEmpty) _payerPhone.text = bill.customerPhone;
    _amount.text = bill.balanceDue.toStringAsFixed(2);
    _type = bill.balanceDue >= bill.grandTotal
        ? PaymentType.fullPayment
        : PaymentType.partPayment;
    _against.text = 'Bill ${bill.billNo}';
  }

  /// Puts what the operator accepted on the voice sheet into the form.
  /// Only the rows they ticked are touched, and nothing is saved - Save
  /// is still their tap.
  Future<void> _fillByVoice() async {
    final spoken = await VoiceEntrySheet.show<VoicePaymentDraft>(
      context,
      recipe: VoiceRecipe(
        example: 'Rajesh Kumar se paanch hazaar cash mile aaj  /  '
            'Suresh ne das hazaar UPI se diye, reference 445566',
        parse: (text) => VoicePaymentParser().parse(text),
      ),
    );
    if (spoken == null || !mounted) return;

    setState(() {
      markVoice(spoken.fields);
      // On a payment against a bill the payer is already known and the
      // name box is not editable, so voice leaves it alone.
      if (spoken.payerName != null && _bill == null) {
        _payerName.text = spoken.payerName!;
        _customerId = '';
        nameSeed++;
      }
      if (spoken.payerPhone != null) _payerPhone.text = spoken.payerPhone!;
      if (spoken.amount != null) {
        _amount.text = spoken.amount!.toStringAsFixed(
            spoken.amount! == spoken.amount!.roundToDouble() ? 0 : 2);
      }
      if (spoken.mode != null) _mode = spoken.mode!;
      if (spoken.type != null) _type = spoken.type!;
      if (spoken.paymentDate != null) _paymentDate = spoken.paymentDate!;
      if (spoken.reference != null) _reference.text = spoken.reference!;
    });

    announceVoice(spoken.fields.length);
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

    final bill = _bill;
    final existing = _existing;

    if (existing != null) {
      await _saveEdit(existing, bill, amount);
      return;
    }

    var splitExcess = false;
    if (bill != null && _type.settlesDues && amount > bill.balanceDue + 0.004) {
      final choice = await _askAboutOverpayment(bill, amount);
      if (choice != true) return;
      splitExcess = true;
    }

    setState(() => _saving = true);
    try {
      final payment = PaymentModel(
        id: IdGenerator.generateId(),
        billId: bill?.id ?? '',
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
      );

      final PaymentModel saved;
      if (splitExcess) {
        final result =
            await BillingRepository.instance.recordPaymentSplittingExcess(payment);
        saved = result.applied;
        if (result.advance != null && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(
              'Bill settled. ₹${result.advance!.amount.toStringAsFixed(2)} '
              'kept as advance (receipt ${result.advance!.receiptNo}).',
            ),
          ));
        }
      } else {
        saved = await BillingRepository.instance.recordPayment(payment);
      }

      if (!mounted) return;
      voiceFilled.clear();
      context.pop(saved.id);
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      showSaveProblem(context, error);
    }
  }

  /// Saves a correction to an issued receipt. Against a bill, the
  /// amount may not exceed what the bill owes once this receipt's own
  /// earlier figure is set aside.
  Future<void> _saveEdit(PaymentModel existing, BillModel? bill, double amount) async {
    if (bill != null && _type.settlesDues) {
      final ownEarlier = existing.billId == bill.id && existing.paymentType.settlesDues
          ? existing.amount
          : 0.0;
      final allowed = bill.balanceDue + ownEarlier;
      if (amount > allowed + 0.004) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(
            'Amount exceeds outstanding balance. Only '
            '₹${allowed.toStringAsFixed(2)} can be applied to bill ${bill.billNo}.',
          ),
        ));
        return;
      }
    }

    setState(() => _saving = true);
    try {
      final updated = existing.copyWith(
        payerName: _payerName.text.trim(),
        payerPhone: _payerPhone.text.trim(),
        against: _against.text.trim(),
        amount: amount,
        mode: _mode,
        paymentType: _type,
        paymentDate: _paymentDate.toIso8601String(),
        referenceNo: _reference.text.trim(),
        notes: _notes.text.trim(),
      );
      await BillingRepository.instance.updatePayment(updated);
      if (!mounted) return;
      voiceFilled.clear();
      context.pop(existing.id);
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      showSaveProblem(context, error);
    }
  }

  /// The amount is more than the bill still owes. Money is never
  /// quietly swallowed into the bill: settle the bill at its balance
  /// and keep the rest as an advance, or go back and change the amount.
  Future<bool?> _askAboutOverpayment(BillModel bill, double amount) {
    final outstanding = bill.balanceDue;
    final excess = amount - outstanding;
    return showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        icon: const Icon(Icons.warning_amber_rounded, size: 36),
        title: const Text('Amount exceeds outstanding balance'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Bill ${bill.billNo} outstanding: ₹${outstanding.toStringAsFixed(2)}'),
            Text('Amount entered: ₹${amount.toStringAsFixed(2)}'),
            const SizedBox(height: 12),
            Text(
              'Apply ₹${outstanding.toStringAsFixed(2)} to the bill and keep '
              '₹${excess.toStringAsFixed(2)} as an advance on the customer\'s '
              'account? Two receipts will be made.',
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Change amount'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Apply and keep advance'),
          ),
        ],
      ),
    );
  }

  /// Which bill this receipt settles - shown only when the screen was
  /// opened for a customer with unpaid bills.
  Widget _billPicker() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Against which bill?'),
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            for (final open in _openBills)
              ChoiceChip(
                label: Text('${open.billNo}  ₹${open.balanceDue.toStringAsFixed(0)}'),
                selected: _bill?.id == open.id,
                onSelected: (_) => setState(() => _applyBill(open)),
              ),
            ChoiceChip(
              label: const Text('On account / advance'),
              selected: _bill == null,
              onSelected: (_) => setState(() => _applyBill(null)),
            ),
          ],
        ),
        const SizedBox(height: 16),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final bill = _bill;

    return Scaffold(
      appBar: AppBar(
        title: Text(_existing == null
            ? 'Receive Payment'
            : 'Edit Receipt ${_existing!.receiptNo}'),
        centerTitle: true,
        actions: [
          IconButton(
            tooltip: 'Bol kar bhariye',
            icon: const Icon(Icons.mic_none),
            onPressed: _loading ? null : _fillByVoice,
          ),
        ],
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
                if (_openBills.isNotEmpty) _billPicker(),
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
                    key: ValueKey('payer-name-$nameSeed'),
                    controller: _payerName,
                    label: 'Received from *',
                    highlight: cameFromVoice(VoiceFieldKind.customerName),
                    onChanged: (_) => typedOver(VoiceFieldKind.customerName),
                    onSelected: (s) => setState(() {
                      _customerId = s.customerId;
                      if (_payerPhone.text.trim().isEmpty) _payerPhone.text = s.phone;
                    }),
                  ),
                  const SizedBox(height: 12),
                ] else ...[
                  TextField(
                    textInputAction: TextInputAction.next,
                    controller: _payerName,
                    decoration: const InputDecoration(labelText: 'Received from *'),
                  ),
                  const SizedBox(height: 12),
                ],
                TextField(
                  textInputAction: TextInputAction.next,
                  controller: _payerPhone,
                  keyboardType: TextInputType.phone,
                  onChanged: (_) => typedOver(VoiceFieldKind.customerPhone),
                  decoration:
                      voiceDecoration('Mobile', VoiceFieldKind.customerPhone),
                ),
                const SizedBox(height: 12),
                TextField(
                  textInputAction: TextInputAction.next,
                  controller: _amount,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                  onChanged: (_) => typedOver(VoiceFieldKind.amount),
                  decoration: voiceDecoration(
                    'Amount received (₹) *',
                    VoiceFieldKind.amount,
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
                    for (final option in PaymentType.receivable)
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
                  textInputAction: TextInputAction.next,
                  controller: _reference,
                  onChanged: (_) => typedOver(VoiceFieldKind.reference),
                  decoration: voiceDecoration(
                      'Reference / UTR / cheque no.', VoiceFieldKind.reference),
                ),
                if (bill == null) ...[
                  const SizedBox(height: 12),
                  TextField(
                    textInputAction: TextInputAction.next,
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
                  label: Text(_existing == null
                      ? 'Save and make receipt'
                      : 'Save changes'),
                ),
                const SizedBox(height: 24),
              ],
            ),
    );
  }
}
