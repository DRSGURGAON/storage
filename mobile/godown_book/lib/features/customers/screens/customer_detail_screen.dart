import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/contact/contact_launcher.dart';
import '../../billing/models/bill_model.dart';
import '../../billing/repositories/billing_repository.dart';
import '../../quotation/models/quotation_model.dart';
import '../../quotation/repositories/quotation_repository.dart';
import '../../storage_booking/models/storage_booking_model.dart';
import '../../storage_booking/repositories/storage_booking_repository.dart';
import '../models/customer_model.dart';
import '../repositories/customer_repository.dart';

/// One customer, and everything an operator does for them: what is in
/// storage, what they owe, and the six things they can make next.
class CustomerDetailScreen extends StatefulWidget {
  final String customerId;

  const CustomerDetailScreen({super.key, required this.customerId});

  @override
  State<CustomerDetailScreen> createState() => _CustomerDetailScreenState();
}

class _CustomerDetailScreenState extends State<CustomerDetailScreen> {
  static final _dateFormat = DateFormat('dd MMM yyyy');

  CustomerModel? _customer;
  List<StorageBookingModel> _storage = const [];
  List<BillModel> _bills = const [];
  List<QuotationModel> _quotations = const [];
  CustomerBalance? _balance;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final customer = await CustomerRepository.instance.getById(widget.customerId);
    final allStorage = await StorageBookingRepository.instance.getAll();
    final bills = await BillingRepository.instance.getBillsForCustomer(widget.customerId);
    final quotations =
        await QuotationRepository.instance.getForCustomer(widget.customerId);
    final balance =
        await BillingRepository.instance.balanceForCustomer(widget.customerId);

    if (!mounted) return;
    setState(() {
      _customer = customer;
      _storage = allStorage.where((b) => b.customerId == widget.customerId).toList();
      _bills = bills;
      _quotations = quotations;
      _balance = balance;
      _loading = false;
    });
  }

  List<StorageBookingModel> get _openStorage =>
      _storage.where((b) => b.status.isOpen).toList();

  double get _itemsInStorage =>
      _openStorage.fold(0.0, (sum, b) => sum + (b.items.isEmpty
          ? b.totalPackages.toDouble()
          : b.remainingQuantity));

  String? get _storedSince {
    DateTime? earliest;
    for (final booking in _openStorage) {
      final date = DateTime.tryParse(booking.storageStartDate);
      if (date == null) continue;
      if (earliest == null || date.isBefore(earliest)) earliest = date;
    }
    return earliest == null ? null : _dateFormat.format(earliest);
  }

  double get _monthlyStorage =>
      _openStorage.fold(0.0, (sum, b) => sum + b.rentRate);

  static String _qty(double v) =>
      v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(1);

  @override
  Widget build(BuildContext context) {
    final customer = _customer;

    return Scaffold(
      appBar: AppBar(
        title: Text(customer?.customerName ?? 'Customer'),
        centerTitle: true,
        actions: [
          if (customer != null)
            IconButton(
              icon: const Icon(Icons.edit_outlined),
              tooltip: 'Edit customer',
              onPressed: () async {
                await context.push('/customer-edit', extra: customer.id);
                _load();
              },
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : customer == null
              ? const Center(child: Text('Customer not found.'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                    children: [
                      _contactCard(customer),
                      const SizedBox(height: 12),
                      _storageCard(),
                      const SizedBox(height: 16),
                      _actionsGrid(customer),
                      const SizedBox(height: 16),
                      if (_openStorage.isNotEmpty) _storageList(),
                      if (_bills.isNotEmpty) _billsList(),
                      if (_quotations.isNotEmpty) _quotationsList(),
                    ],
                  ),
                ),
    );
  }

  Widget _contactCard(CustomerModel customer) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(customer.customerName,
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            if (customer.mobileNumber.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(customer.mobileNumber, style: const TextStyle(fontSize: 15)),
            ],
            if (customer.fullAddress.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(customer.fullAddress, style: const TextStyle(color: Colors.grey)),
            ],
            if (customer.mobileNumber.isNotEmpty) ...[
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => ContactLauncher.call(customer.mobileNumber),
                      icon: const Icon(Icons.call, size: 18),
                      label: const Text('Call'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => ContactLauncher.openWhatsAppWithChoice(
                        context,
                        customer.mobileNumber,
                      ),
                      icon: const Icon(Icons.chat_outlined, size: 18),
                      label: const Text('WhatsApp'),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _storageCard() {
    final balance = _balance;
    final outstanding = balance?.outstanding ?? 0;
    final advance = balance?.advance ?? 0;
    final since = _storedSince;

    return Card(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('STORAGE',
                style: TextStyle(fontWeight: FontWeight.bold, letterSpacing: 0.5, fontSize: 12)),
            const SizedBox(height: 10),
            if (_openStorage.isEmpty)
              const Text('Nothing in storage right now.',
                  style: TextStyle(color: Colors.grey))
            else ...[
              _line(Icons.inventory_2_outlined,
                  '${_qty(_itemsInStorage)} items / boxes'),
              if (_openStorage.first.locationName.isNotEmpty)
                _line(Icons.place_outlined, _openStorage.map((b) => b.locationName)
                    .where((n) => n.isNotEmpty)
                    .toSet()
                    .join(', ')),
              if (since != null) _line(Icons.calendar_today_outlined, 'Stored since $since'),
              if (_monthlyStorage > 0)
                _line(Icons.currency_rupee,
                    'Storage ₹${_qty(_monthlyStorage)} ${_openStorage.first.rentBasis.rateHint}'),
            ],
            const SizedBox(height: 8),
            if (outstanding > 0)
              _line(Icons.error_outline, 'Outstanding ₹${outstanding.toStringAsFixed(0)}',
                  color: Colors.red.shade700)
            else if (advance > 0)
              _line(Icons.savings_outlined, 'Advance with us ₹${advance.toStringAsFixed(0)}',
                  color: Colors.green.shade700)
            else
              _line(Icons.check_circle_outline, 'Nothing outstanding',
                  color: Colors.green.shade700),
          ],
        ),
      ),
    );
  }

  Widget _line(IconData icon, String text, {Color? color}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Icon(icon, size: 18, color: color ?? Colors.grey.shade700),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                fontWeight: color == null ? FontWeight.w500 : FontWeight.bold,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _actionsGrid(CustomerModel customer) {
    final openBooking = _openStorage.isNotEmpty ? _openStorage.first : null;

    Widget button(IconData icon, String label, VoidCallback onTap) {
      return InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.primaryContainer,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            children: [
              Icon(icon, color: Theme.of(context).colorScheme.onPrimaryContainer),
              const SizedBox(height: 6),
              Text(
                label,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: Theme.of(context).colorScheme.onPrimaryContainer,
                ),
              ),
            ],
          ),
        ),
      );
    }

    return GridView.count(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisCount: 3,
      crossAxisSpacing: 10,
      mainAxisSpacing: 10,
      childAspectRatio: 1.15,
      children: [
        button(Icons.request_quote_outlined, 'Quotation', () async {
          await context.push('/quotation-create', extra: customer.id);
          _load();
        }),
        button(Icons.handshake_outlined, 'Agreement', () async {
          if (openBooking == null) {
            _needStorage('An agreement prints from a storage record.');
            return;
          }
          await context.push('/storage-pdf',
              extra: {'id': openBooking.id, 'kind': 'agreement'});
          _load();
        }),
        button(Icons.inventory_2_outlined, 'Storage', () async {
          await context.push('/storage-create');
          _load();
        }),
        button(Icons.receipt_long_outlined, 'Bill', () async {
          await context.push('/bill-create', extra: openBooking?.id);
          _load();
        }),
        button(Icons.payments_outlined, 'Receipt', () async {
          final paymentId = await context
              .push('/payment-create', extra: {'customerId': customer.id});
          if (paymentId is String && mounted) {
            await context.push('/receipt-pdf', extra: paymentId);
          }
          _load();
        }),
        button(Icons.account_balance_wallet_outlined, 'Statement', () async {
          await context.push('/statement', extra: customer.id);
          _load();
        }),
      ],
    );
  }

  void _needStorage(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Widget _storageList() {
    return _sectionList(
      'In storage',
      [
        for (final booking in _openStorage)
          ListTile(
            leading: const Icon(Icons.inventory_2_outlined),
            title: Text(booking.bookingNo),
            subtitle: Text(
              '${_qty(booking.remainingQuantity)} in stock  •  ${booking.status.label}'
              '${booking.locationName.isEmpty ? '' : '  •  ${booking.locationName}'}',
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              await context.push('/storage-detail', extra: booking.id);
              _load();
            },
          ),
      ],
    );
  }

  Widget _billsList() {
    final recent = _bills.take(5).toList();
    return _sectionList(
      'Bills',
      [
        for (final bill in recent)
          ListTile(
            leading: const Icon(Icons.receipt_long_outlined),
            title: Text(bill.billNo),
            subtitle: Text('${bill.derivedStatus.label}'
                '${bill.balanceDue > 0 ? '  •  due ₹${bill.balanceDue.toStringAsFixed(0)}' : ''}'),
            trailing: Text('₹${bill.grandTotal.toStringAsFixed(0)}',
                style: const TextStyle(fontWeight: FontWeight.bold)),
            onTap: () async {
              await context.push('/bill-pdf', extra: bill.id);
              _load();
            },
          ),
      ],
    );
  }

  Widget _quotationsList() {
    final recent = _quotations.take(3).toList();
    return _sectionList(
      'Quotations',
      [
        for (final quotation in recent)
          ListTile(
            leading: const Icon(Icons.request_quote_outlined),
            title: Text(quotation.quotationNo),
            subtitle: Text(quotation.status.label),
            trailing: Text('₹${quotation.grandTotal.toStringAsFixed(0)}',
                style: const TextStyle(fontWeight: FontWeight.bold)),
            onTap: () async {
              await context.push('/quotation-pdf', extra: quotation.id);
              _load();
            },
          ),
      ],
    );
  }

  Widget _sectionList(String title, List<Widget> children) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 6, left: 4),
            child: Text(
              title.toUpperCase(),
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: Theme.of(context).colorScheme.primary,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 0.5,
                  ),
            ),
          ),
          Card(child: Column(children: children)),
        ],
      ),
    );
  }
}
