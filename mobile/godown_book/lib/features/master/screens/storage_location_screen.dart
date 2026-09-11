import 'package:flutter/material.dart';

import '../models/storage_location_model.dart';
import '../repositories/storage_location_repository.dart';
import '../widgets/master_list_screen.dart';

/// Masters -> Storage Locations: the halls, rooms, racks and bays goods
/// are kept in. Picked on a Warehouse Receipt so the goods can be
/// found again.
class StorageLocationScreen extends StatefulWidget {
  const StorageLocationScreen({super.key});

  @override
  State<StorageLocationScreen> createState() => _StorageLocationScreenState();
}

class _StorageLocationScreenState extends State<StorageLocationScreen> {
  List<StorageLocationModel> _locations = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final locations = await StorageLocationRepository.instance.getAll();
    if (!mounted) return;
    setState(() {
      _locations = locations;
      _loading = false;
    });
  }

  Future<void> _edit({StorageLocationModel? existing}) async {
    final nameController = TextEditingController(text: existing?.name ?? '');
    final codeController = TextEditingController(text: existing?.code ?? '');
    final descriptionController =
        TextEditingController(text: existing?.description ?? '');

    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(existing == null ? 'New Location' : 'Edit Location'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameController,
                autofocus: existing == null,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(
                  labelText: 'Name',
                  hintText: 'Hall A / Rack 3 / Cold Room',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: codeController,
                textCapitalization: TextCapitalization.characters,
                decoration: const InputDecoration(
                  labelText: 'Code (optional)',
                  hintText: 'Auto if left blank',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: descriptionController,
                maxLines: 2,
                decoration: const InputDecoration(labelText: 'Description'),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (nameController.text.trim().isEmpty) return;
              Navigator.pop(dialogContext, true);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );

    if (saved != true) return;

    if (existing == null) {
      await StorageLocationRepository.instance.create(
        name: nameController.text,
        code: codeController.text,
        description: descriptionController.text,
      );
    } else {
      await StorageLocationRepository.instance.update(
        existing.copyWith(
          name: nameController.text.trim(),
          code: codeController.text.trim().isEmpty
              ? existing.code
              : codeController.text.trim().toUpperCase(),
          description: descriptionController.text.trim(),
        ),
      );
    }

    await _load();
  }

  Future<void> _delete(StorageLocationModel location) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Remove location?'),
        content: Text(
          'Remove "${location.name}"? Receipts already saved keep it.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    await StorageLocationRepository.instance.delete(location.id);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return MasterListScreen(
      title: 'Storage Locations',
      onAdd: () => _edit(),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _locations.isEmpty
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(32),
                    child: Text(
                      'No locations yet. Add the halls, rooms or racks of '
                      'your godown so each receipt can say where the goods are.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.grey),
                    ),
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
                  itemCount: _locations.length,
                  itemBuilder: (context, index) {
                    final location = _locations[index];
                    return Card(
                      margin: const EdgeInsets.only(bottom: 10),
                      child: ListTile(
                        leading: const Icon(Icons.warehouse_outlined),
                        title: Text(location.name),
                        subtitle: Text(
                          location.description.isEmpty
                              ? location.code
                              : '${location.code}  •  ${location.description}',
                        ),
                        onTap: () => _edit(existing: location),
                        trailing: IconButton(
                          icon: const Icon(Icons.delete_outline),
                          onPressed: () => _delete(location),
                        ),
                      ),
                    );
                  },
                ),
    );
  }
}
