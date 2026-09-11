import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/subscription/document_type.dart';
import '../../../shared/widgets/company_not_configured.dart';
import '../../../shared/widgets/document_pdf_view.dart';
import '../../../shared/widgets/pdf_document_actions.dart';
import '../../company/controllers/company_controller.dart';
import '../../company/models/company_model.dart';
import '../../customers/models/customer_model.dart';
import '../../customers/repositories/customer_repository.dart';
import '../repositories/billing_repository.dart';
import '../services/statement_pdf_service.dart';

/// One customer's account: every bill and receipt in date order, with
/// the balance, and the same thing as a PDF to send them.
class StatementScreen extends StatefulWidget {
  final String customerId;

  const StatementScreen({super.key, required this.customerId});

  @override
  State<StatementScreen> createState() => _StatementScreenState();
}

class _StatementScreenState extends State<StatementScreen> {
  static final _dateFormat = DateFormat('dd MMM yyyy');

  Uint8List? _menuPdfBytes;
  CustomerModel? _customer;
  CompanyModel? _company;
  List<StatementEntry> _entries = const [];
  double _openingBalance = 0;
  bool _loading = true;
  bool _showPdf = false;

  DateTime? _from;
  DateTime? _to;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final customer = await CustomerRepository.instance.getById(widget.customerId);
    final company = await CompanyController.instance.getCompany();
    final entries = await BillingRepository.instance
        .statementForCustomer(widget.customerId, from: _from, to: _to);
    final opening = _from == null
        ? 0.0
        : await BillingRepository.instance.openingBalance(widget.customerId, _from!);

    if (!mounted) return;
    setState(() {
      _customer = customer;
      _company = company;
      _entries = entries;
      _openingBalance = opening;
      _loading = false;
    });
  }

  double get _closing =>
      _entries.isEmpty ? _openingBalance : _entries.last.runningBalance;

  String get _fileName =>
      'Statement-${(_customer?.customerName ?? 'customer').replaceAll(' ', '-')}.pdf';

  @override
  Widget build(BuildContext context) {
    final customer = _customer;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Customer Statement'),
        centerTitle: true,
        actions: [
          if (_showPdf)
            PdfActionsMenu(
              documentLabel: 'Statement',
              fileName: () => _fileName,
              getPdfBytes: () => _menuPdfBytes,
              customerPhone: customer?.mobileNumber,
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : customer == null
              ? const Center(child: Text('Customer not found.'))
              : _showPdf
                  ? ((_company == null || !_company!.isConfigured)
                      ? CompanyNotConfigured(
                          missing: _company?.missingFields ?? const ['Company details'])
                      : DocumentPdfView(
                          documentType: DocumentType.statement,
                          fileName: _fileName,
                          rebuildKey: '${_from?.toIso8601String()}|${_to?.toIso8601String()}',
                          onBytes: (bytes) => _menuPdfBytes = bytes,
                          build: ({required showWatermark}) =>
                              StatementPdfService.instance.build(
                            customer: customer,
                            entries: _entries,
                            openingBalance: _openingBalance,
                            company: _company,
                            from: _from,
                            to: _to,
                            showWatermark: showWatermark,
                          ),
                        ))
                  : _summary(customer),
      floatingActionButton: _loading || customer == null
          ? null
          : FloatingActionButton.extended(
              onPressed: () => setState(() => _showPdf = !_showPdf),
              icon: Icon(_showPdf ? Icons.list_alt : Icons.picture_as_pdf_outlined),
              label: Text(_showPdf ? 'Back to list' : 'Statement PDF'),
            ),
    );
  }

  Widget _summary(CustomerModel customer) {
    final owed = _closing >= 0;

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(customer.customerName,
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  if (customer.mobileNumber.isNotEmpty) Text(customer.mobileNumber),
                  const Divider(height: 20),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(owed ? 'Outstanding' : 'Advance with us',
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                      Text(
                        '₹${_closing.abs().toStringAsFixed(2)}',
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.bold,
                          color: owed && _closing > 0
                              ? Colors.red.shade700
                              : Colors.green.shade700,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(child: _dateTile('From', _from, (d) => _from = d)),
              const SizedBox(width: 12),
              Expanded(child: _dateTile('To', _to, (d) => _to = d)),
            ],
          ),
          const SizedBox(height: 16),
          if (_entries.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 32),
              child: Center(
                child: Text('No bills or payments yet.',
                    style: TextStyle(color: Colors.grey)),
              ),
            )
          else
            for (final entry in _entries)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  dense: true,
                  leading: Icon(
                    entry.debit > 0 ? Icons.receipt_long_outlined : Icons.payments_outlined,
                    color: entry.debit > 0 ? Colors.red.shade700 : Colors.green.shade700,
                  ),
                  title: Text(entry.particulars),
                  subtitle: Text(
                    '${_short(entry.date)}${entry.reference.isEmpty ? '' : '  •  ${entry.reference}'}',
                  ),
                  trailing: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        entry.debit > 0
                            ? '+₹${entry.debit.toStringAsFixed(0)}'
                            : '-₹${entry.credit.toStringAsFixed(0)}',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color: entry.debit > 0 ? Colors.red.shade700 : Colors.green.shade700,
                        ),
                      ),
                      Text('bal ₹${entry.runningBalance.abs().toStringAsFixed(0)}',
                          style: const TextStyle(fontSize: 11, color: Colors.grey)),
                    ],
                  ),
                ),
              ),
        ],
      ),
    );
  }

  Widget _dateTile(String label, DateTime? value, ValueChanged<DateTime?> onPicked) {
    return InkWell(
      onTap: () async {
        final picked = await showDatePicker(
          context: context,
          initialDate: value ?? DateTime.now(),
          firstDate: DateTime(2015),
          lastDate: DateTime(2100),
        );
        if (picked != null) {
          onPicked(picked);
          await _load();
        }
      },
      borderRadius: BorderRadius.circular(8),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          isDense: true,
          suffixIcon: value == null
              ? const Icon(Icons.calendar_today_outlined, size: 18)
              : IconButton(
                  icon: const Icon(Icons.clear, size: 18),
                  onPressed: () {
                    onPicked(null);
                    _load();
                  },
                ),
        ),
        child: Text(value == null ? 'All' : _dateFormat.format(value)),
      ),
    );
  }

  static String _short(String iso) {
    final d = DateTime.tryParse(iso);
    return d == null ? iso : _dateFormat.format(d);
  }
}
