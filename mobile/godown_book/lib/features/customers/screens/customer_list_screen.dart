import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/contact/contact_launcher.dart';
import '../models/customer_model.dart';
import '../repositories/customer_repository.dart';

/// The Customer master - search, add, edit, deactivate.
class CustomerListScreen extends StatefulWidget {
  const CustomerListScreen({super.key});

  @override
  State<CustomerListScreen> createState() => _CustomerListScreenState();
}

class _CustomerListScreenState extends State<CustomerListScreen> {
  final TextEditingController _searchController = TextEditingController();

  List<CustomerModel> _customers = [];
  List<CustomerModel> _filtered = [];
  bool _showInactive = false;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _load();
    _searchController.addListener(_applyFilter);
  }

  @override
  void dispose() {
    _searchController.removeListener(_applyFilter);
    _searchController.dispose();
    super.dispose();
  }

  void _applyFilter() {
    final query = _searchController.text.trim().toLowerCase();

    setState(() {
      _filtered = _customers.where((c) {
        if (!_showInactive && !c.isActive) return false;
        if (query.isEmpty) return true;
        return c.customerName.toLowerCase().contains(query) ||
            c.mobileNumber.contains(query) ||
            c.city.toLowerCase().contains(query) ||
            c.gstNumber.toLowerCase().contains(query);
      }).toList();
    });
  }

  Future<void> _load() async {
    final customers = await CustomerRepository.instance.getAll();

    if (!mounted) return;

    setState(() {
      _customers = customers;
      _isLoading = false;
    });

    _applyFilter();
  }

  Future<void> _openAdd() async {
    final result = await context.push('/customer-create');
    if (result == true) await _load();
  }

  Future<void> _openCustomer(CustomerModel customer) async {
    await context.push('/customer-detail', extra: customer.id);
    await _load();
  }

  Future<void> _openEdit(CustomerModel customer) async {
    final result = await context.push('/customer-edit', extra: customer.id);
    if (result == true) await _load();
  }

  Future<void> _toggleActive(CustomerModel customer) async {
    if (customer.isActive) {
      await CustomerRepository.instance.deactivate(customer.id);
    } else {
      await CustomerRepository.instance.reactivate(customer.id);
    }
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Customers'),
        actions: [
          IconButton(
            tooltip: _showInactive ? 'Hide inactive' : 'Show inactive',
            icon: Icon(
              _showInactive ? Icons.visibility_off_outlined : Icons.visibility_outlined,
            ),
            onPressed: () {
              setState(() => _showInactive = !_showInactive);
              _applyFilter();
            },
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openAdd,
        icon: const Icon(Icons.person_add_alt_1_outlined),
        label: const Text('New Customer'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Search by name, phone, city or GST',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searchController.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: _searchController.clear,
                      ),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                isDense: true,
              ),
            ),
          ),
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _filtered.isEmpty
                    ? _EmptyState(hasAny: _customers.isNotEmpty)
                    : RefreshIndicator(
                        onRefresh: _load,
                        child: ListView.builder(
                          padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
                          itemCount: _filtered.length,
                          itemBuilder: (context, index) {
                            final customer = _filtered[index];
                            return _CustomerCard(
                              customer: customer,
                              onTap: () => _openCustomer(customer),
                              onEdit: () => _openEdit(customer),
                              onToggleActive: () => _toggleActive(customer),
                            );
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }
}

class _CustomerCard extends StatelessWidget {
  final CustomerModel customer;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onToggleActive;

  const _CustomerCard({
    required this.customer,
    required this.onTap,
    required this.onEdit,
    required this.onToggleActive,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final initial = customer.customerName.trim().isEmpty
        ? '?'
        : customer.customerName.trim()[0].toUpperCase();

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        onTap: onTap,
        leading: CircleAvatar(
          backgroundColor:
              customer.isActive ? scheme.primaryContainer : Colors.grey.shade300,
          foregroundColor:
              customer.isActive ? scheme.onPrimaryContainer : Colors.grey,
          child: Text(initial),
        ),
        title: Text(
          customer.customerName,
          style: TextStyle(
            fontWeight: FontWeight.w600,
            decoration: customer.isActive ? null : TextDecoration.lineThrough,
          ),
        ),
        subtitle: Text(
          [
            if (customer.mobileNumber.isNotEmpty) customer.mobileNumber,
            if (customer.city.isNotEmpty) customer.city,
            if (customer.gstNumber.isNotEmpty) 'GST ${customer.gstNumber}',
          ].join('  •  '),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: PopupMenuButton<String>(
          onSelected: (value) {
            switch (value) {
              case 'call':
                ContactLauncher.call(customer.mobileNumber);
              case 'whatsapp':
                ContactLauncher.openWhatsAppWithChoice(
                  context,
                  customer.mobileNumber,
                );
              case 'edit':
                onEdit();
              case 'toggle':
                onToggleActive();
            }
          },
          itemBuilder: (context) => [
            if (customer.mobileNumber.isNotEmpty) ...[
              const PopupMenuItem(value: 'call', child: Text('Call')),
              const PopupMenuItem(value: 'whatsapp', child: Text('WhatsApp')),
            ],
            const PopupMenuItem(value: 'edit', child: Text('Edit')),
            PopupMenuItem(
              value: 'toggle',
              child: Text(customer.isActive ? 'Deactivate' : 'Reactivate'),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final bool hasAny;

  const _EmptyState({required this.hasAny});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.people_outline, size: 56, color: Colors.grey.shade400),
            const SizedBox(height: 12),
            Text(
              hasAny ? 'No customers match your search.' : 'No customers yet.',
              style: const TextStyle(color: Colors.grey),
              textAlign: TextAlign.center,
            ),
            if (!hasAny) ...[
              const SizedBox(height: 4),
              const Text(
                'Customers are also added automatically when you issue a '
                'Warehouse Receipt.',
                style: TextStyle(color: Colors.grey, fontSize: 12),
                textAlign: TextAlign.center,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
