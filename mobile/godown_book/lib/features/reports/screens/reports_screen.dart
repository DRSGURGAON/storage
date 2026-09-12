import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// The two pages an owner reads at month end: what is inside and what
/// it earns, and who owes what and for how long.
class ReportsScreen extends StatelessWidget {
  const ReportsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/dashboard'),
        ),
        title: const Text('Reports'),
        centerTitle: true,
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: ListTile(
              leading: const Icon(Icons.warehouse_outlined),
              title: const Text('Rent Roll'),
              subtitle: const Text(
                'Everything in storage right now, where it sits, and the '
                'rent it earns a month',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/reports/rent-roll'),
            ),
          ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.hourglass_bottom_outlined),
              title: const Text('Aged Outstanding'),
              subtitle: const Text(
                'Who owes what, split by how long it has been due - the '
                'oldest first',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/reports/aged-outstanding'),
            ),
          ),
          const SizedBox(height: 12),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 4),
            child: Text(
              'Both reports are built from the storage records and bills '
              'already in the app, as of today. Print or share them like any '
              'other document.',
              style: TextStyle(fontSize: 12, color: Colors.black54),
            ),
          ),
        ],
      ),
    );
  }
}
