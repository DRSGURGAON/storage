import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../models/storage_booking_model.dart';
import '../repositories/storage_booking_repository.dart';
import 'storage_booking_list_screen.dart';
import 'storage_booking_pdf_screen.dart';

/// One storage record at a glance: customer, goods still with us,
/// charges, and the papers that hang off it.
class StorageBookingDetailScreen extends StatefulWidget {
  final String bookingId;

  const StorageBookingDetailScreen({super.key, required this.bookingId});

  @override
  State<StorageBookingDetailScreen> createState() => _StorageBookingDetailScreenState();
}

class _StorageBookingDetailScreenState extends State<StorageBookingDetailScreen> {
  static final _dateFormat = DateFormat('dd MMM yyyy');

  StorageBookingModel? _booking;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final booking = await StorageBookingRepository.instance.getById(widget.bookingId);
    if (!mounted) return;
    setState(() {
      _booking = booking;
      _loading = false;
    });
  }

  String _date(String iso) {
    final d = DateTime.tryParse(iso);
    return d == null ? '-' : _dateFormat.format(d);
  }

  static String _qty(double v) =>
      v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(2);

  @override
  Widget build(BuildContext context) {
    final b = _booking;

    return Scaffold(
      appBar: AppBar(
        title: Text(b?.bookingNo ?? 'Storage'),
        centerTitle: true,
        actions: [
          if (b != null)
            IconButton(
              icon: const Icon(Icons.more_vert),
              onPressed: () => showBookingActions(context, b, () {
                if (!mounted) return;
                _load();
              }),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : b == null
              ? const Center(child: Text('Storage record not found.'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      _headerCard(b),
                      const SizedBox(height: 12),
                      _papersCard(b),
                      const SizedBox(height: 12),
                      _itemsCard(b),
                      const SizedBox(height: 12),
                      _rentCard(b),
                      if (b.notes.trim().isNotEmpty) ...[
                        const SizedBox(height: 12),
                        Card(
                          child: ListTile(
                            leading: const Icon(Icons.sticky_note_2_outlined),
                            title: const Text('Notes'),
                            subtitle: Text(b.notes),
                          ),
                        ),
                      ],
                      const SizedBox(height: 24),
                    ],
                  ),
                ),
    );
  }

  Widget _headerCard(StorageBookingModel b) {
    final color = statusColor(b.status);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    b.customerName,
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    b.status.label,
                    style: TextStyle(fontWeight: FontWeight.w600, color: color, fontSize: 12),
                  ),
                ),
              ],
            ),
            if (b.customerPhone.isNotEmpty) Text(b.customerPhone),
            if (b.customerFullAddress.isNotEmpty)
              Text(b.customerFullAddress, style: const TextStyle(color: Colors.grey)),
            const Divider(height: 20),
            _row('Entry date', _date(b.bookingDate)),
            _row('Storage from', _date(b.storageStartDate)),
            _row('Expected upto', b.expectedEndDate.isEmpty ? 'Open' : _date(b.expectedEndDate)),
            if (b.actualEndDate.isNotEmpty) _row('Released on', _date(b.actualEndDate)),
            _row('Location', b.locationName.isEmpty ? '-' : b.locationName),
            if (b.vehicleNumber.isNotEmpty) _row('Vehicle', b.vehicleNumber),
            if (b.receivedBy.isNotEmpty) _row('Received by', b.receivedBy),
          ],
        ),
      ),
    );
  }

  Widget _papersCard(StorageBookingModel b) {
    Widget tile(IconData icon, String title, String subtitle, BookingDocumentKind kind) {
      return ListTile(
        leading: Icon(icon),
        title: Text(title),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.chevron_right),
        onTap: () async {
          await context.push('/storage-pdf', extra: {'id': b.id, 'kind': kind.name});
          _load();
        },
      );
    }

    return Card(
      child: Column(
        children: [
          tile(Icons.picture_as_pdf_outlined, 'Storage Receipt', 'Customer and office copies', BookingDocumentKind.receipt),
          const Divider(height: 1),
          tile(Icons.list_alt_outlined, 'Goods List', 'What is stored, what has gone out', BookingDocumentKind.inventory),
          const Divider(height: 1),
          tile(Icons.handshake_outlined, 'Storage Agreement', 'Terms both sides sign', BookingDocumentKind.agreement),
        ],
      ),
    );
  }

  Widget _itemsCard(StorageBookingModel b) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.inventory_2_outlined, size: 20),
                const SizedBox(width: 8),
                const Text('Goods', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                const Spacer(),
                Text(
                  b.items.isEmpty
                      ? '${b.totalPackages} pkgs'
                      : '${_qty(b.remainingQuantity)} of ${_qty(b.totalQuantity)} in stock',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ],
            ),
            if (b.goodsDescription.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(b.goodsDescription, style: const TextStyle(color: Colors.grey)),
            ],
            if (b.items.isNotEmpty) const Divider(height: 20),
            for (final item in b.items)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(item.itemName, style: const TextStyle(fontWeight: FontWeight.w500)),
                          if (item.description.isNotEmpty)
                            Text(item.description, style: const TextStyle(fontSize: 12, color: Colors.grey)),
                        ],
                      ),
                    ),
                    Text(
                      '${_qty(item.remainingQty)} / ${_qty(item.quantity)} ${item.unit}',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: item.isFullyReleased ? Colors.grey : null,
                        decoration: item.isFullyReleased ? TextDecoration.lineThrough : null,
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _rentCard(StorageBookingModel b) {
    final rate = b.rentRate > 0
        ? '₹${_qty(b.rentRate)} ${b.rentUnitLabel.isEmpty ? b.rentBasis.label.toLowerCase() : b.rentUnitLabel}'
        : 'Not set';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.currency_rupee, size: 20),
                SizedBox(width: 8),
                Text('Rent', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
              ],
            ),
            const SizedBox(height: 8),
            _row('Rent', rate),
            if (b.areaSqft > 0) _row('Area', '${_qty(b.areaSqft)} sq.ft'),
            _row('Security deposit', b.securityDeposit > 0 ? '₹${_qty(b.securityDeposit)}' : 'Nil'),
            _row('Rent billed upto', b.rentBilledUpto.isEmpty ? 'Not billed yet' : _date(b.rentBilledUpto)),
          ],
        ),
      ),
    );
  }

  Widget _row(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          SizedBox(width: 130, child: Text(label, style: const TextStyle(color: Colors.grey))),
          Expanded(child: Text(value, style: const TextStyle(fontWeight: FontWeight.w500))),
        ],
      ),
    );
  }
}
