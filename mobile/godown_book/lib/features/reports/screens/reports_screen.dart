import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class _Report {
  final String title;
  final String subtitle;
  final IconData icon;
  final String route;
  final Color color;

  const _Report(this.title, this.subtitle, this.icon, this.route, this.color);
}

/// Every report, grouped the way an owner looks for them: the money,
/// the godown, and what was quoted and billed. The money reports export
/// to Excel for the CA; the godown reports print as PDFs.
class ReportsScreen extends StatelessWidget {
  const ReportsScreen({super.key});

  static const _accounts = [
    _Report('Customer Ledger', 'Billed, received and due - per customer',
        Icons.menu_book_outlined, '/reports/ledger', Color(0xff1E6FD9)),
    _Report('Outstanding Report', 'Unpaid bills, with a WhatsApp reminder',
        Icons.warning_amber_outlined, '/reports/outstanding', Color(0xffD64545)),
    _Report('Payment / Collection', 'Every payment received, by period',
        Icons.payments_outlined, '/reports/payments', Color(0xff0A7D8C)),
    _Report('GST Summary', 'Month-wise taxable value and GST for filing',
        Icons.account_balance_outlined, '/reports/gst', Color(0xff6F4CC9)),
  ];

  static const _godown = [
    _Report('Rent Roll',
        'Everything in storage now, where it sits, and its monthly rent',
        Icons.warehouse_outlined, '/reports/rent-roll', Color(0xff1E9E5A)),
    _Report('Aged Outstanding', 'Who owes what, by how long it has been due',
        Icons.hourglass_bottom_outlined, '/reports/aged-outstanding',
        Color(0xffE0731F)),
  ];

  static const _documents = [
    _Report('Bill Report', 'All bills with paid and balance',
        Icons.receipt_long_outlined, '/reports/bills', Color(0xff0E8F7E)),
    _Report('Quotation Report', 'Quotations and their status',
        Icons.description_outlined, '/reports/quotations', Color(0xffE0731F)),
  ];

  @override
  Widget build(BuildContext context) {
    Widget section(String title, List<_Report> reports) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 12, 4, 6),
              child: Text(
                title,
                style: Theme.of(context)
                    .textTheme
                    .titleSmall
                    ?.copyWith(fontWeight: FontWeight.w700),
              ),
            ),
            for (final r in reports)
              Card(
                margin: const EdgeInsets.symmetric(vertical: 4),
                child: ListTile(
                  leading: Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: r.color.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(r.icon, color: r.color),
                  ),
                  title: Text(r.title,
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text(r.subtitle),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.push(r.route),
                ),
              ),
          ],
        );

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/dashboard'),
        ),
        title: const Text('Reports'),
        centerTitle: true,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        children: [
          section('Accounts', _accounts),
          section('Godown', _godown),
          section('Quotations & Bills', _documents),
          const SizedBox(height: 12),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 4),
            child: Text(
              'Built from the records already in the app. Money reports '
              'export to Excel (Save, WhatsApp or Email) for your CA; the '
              'godown reports print or share as PDFs.',
              style: TextStyle(fontSize: 12, color: Colors.black54),
            ),
          ),
        ],
      ),
    );
  }
}
