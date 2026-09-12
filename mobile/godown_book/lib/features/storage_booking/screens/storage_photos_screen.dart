import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../models/booking_item_model.dart';
import '../models/storage_photo_model.dart';
import '../repositories/storage_booking_repository.dart';
import '../repositories/storage_photo_repository.dart';

/// Photos of one customer's goods - what came in, and what condition it
/// was in. Nothing here is required; it is evidence when it is needed.
///
/// A photo can be of the consignment as a whole, or of one listed item
/// - the tear on the sofa, the dent on the fridge - so the picture sits
/// next to the item it is about.
class StoragePhotosScreen extends StatefulWidget {
  final String bookingId;
  final String title;

  const StoragePhotosScreen({
    super.key,
    required this.bookingId,
    this.title = 'Photos',
  });

  @override
  State<StoragePhotosScreen> createState() => _StoragePhotosScreenState();
}

class _StoragePhotosScreenState extends State<StoragePhotosScreen> {
  List<StoragePhotoModel> _photos = const [];
  List<BookingItemModel> _items = const [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final booking =
        await StorageBookingRepository.instance.getById(widget.bookingId);
    final photos =
        await StoragePhotoRepository.instance.getForBooking(widget.bookingId);
    if (!mounted) return;
    setState(() {
      _items = booking?.items ?? const [];
      _photos = photos;
      _loading = false;
    });
  }

  /// Which item the photo is of - asked only when the record lists
  /// items. Returns null when the operator backs out, '' for the whole
  /// consignment.
  Future<String?> _pickItem() async {
    if (_items.isEmpty) return '';

    return showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 4, 20, 8),
              child: Text('What is this photo of?',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ),
            ListTile(
              leading: const Icon(Icons.inventory_2_outlined),
              title: const Text('The whole consignment'),
              onTap: () => Navigator.pop(sheetContext, ''),
            ),
            for (final item in _items)
              ListTile(
                leading: const Icon(Icons.label_outline),
                title: Text(item.itemName),
                subtitle: item.conditionNote.trim().isEmpty
                    ? null
                    : Text(item.conditionNote,
                        maxLines: 1, overflow: TextOverflow.ellipsis),
                onTap: () => Navigator.pop(sheetContext, item.id),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _add(ImageSource source) async {
    final itemId = await _pickItem();
    if (itemId == null || !mounted) return;

    try {
      await StoragePhotoRepository.instance.addPhoto(
        bookingId: widget.bookingId,
        source: source,
        itemId: itemId,
      );
      await _load();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not add the photo: $error')),
      );
    }
  }

  Future<void> _editCaption(StoragePhotoModel photo) async {
    final controller = TextEditingController(text: photo.caption);
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Describe this photo'),
        content: TextField(
          controller: controller,
          autofocus: true,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(
            labelText: 'Caption',
            hintText: 'Sofa - small tear on left arm',
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Save')),
        ],
      ),
    );

    if (saved != true) return;
    await StoragePhotoRepository.instance.updateCaption(photo, controller.text.trim());
    await _load();
  }

  Future<void> _delete(StoragePhotoModel photo) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Remove photo?'),
        content: const Text('The photo will be deleted from this storage record.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel')),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;
    await StoragePhotoRepository.instance.delete(photo);
    await _load();
  }

  /// Photos grouped under the item they are of; the whole-consignment
  /// photos first, then each item in the order the goods were listed.
  /// An item with no photos is left out, so the page is never a list
  /// of empty headings.
  List<_PhotoGroup> get _groups {
    final byItem = <String, List<StoragePhotoModel>>{};
    for (final photo in _photos) {
      byItem.putIfAbsent(photo.itemId, () => []).add(photo);
    }

    final groups = <_PhotoGroup>[];
    if (byItem.containsKey('')) {
      groups.add(_PhotoGroup(
        title: _items.isEmpty ? '' : 'Whole consignment',
        photos: byItem['']!,
      ));
    }
    final seen = <String>{''};
    for (final item in _items) {
      final photos = byItem[item.id];
      seen.add(item.id);
      if (photos == null) continue;
      groups.add(_PhotoGroup(title: item.itemName, photos: photos));
    }
    // Photos of an item that has since been removed from the list
    // still belong to the record; keep them visible.
    for (final entry in byItem.entries) {
      if (seen.contains(entry.key)) continue;
      groups.add(_PhotoGroup(title: 'Item no longer listed', photos: entry.value));
    }
    return groups;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title), centerTitle: true),
      floatingActionButton: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          FloatingActionButton.small(
            heroTag: 'gallery',
            onPressed: () => _add(ImageSource.gallery),
            tooltip: 'From gallery',
            child: const Icon(Icons.photo_library_outlined),
          ),
          const SizedBox(height: 10),
          FloatingActionButton.extended(
            heroTag: 'camera',
            onPressed: () => _add(ImageSource.camera),
            icon: const Icon(Icons.photo_camera_outlined),
            label: const Text('Take Photo'),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _photos.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(32),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.photo_camera_outlined, size: 48),
                        const SizedBox(height: 12),
                        Text(
                          _items.isEmpty
                              ? 'No photos yet.\nPhotos of the goods and their '
                                  'condition settle most questions later.'
                              : 'No photos yet.\nTake one of the whole load, or '
                                  'of any listed item - a scratch, a tear, a dent.',
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
                  children: [
                    for (final group in _groups) ...[
                      if (group.title.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(4, 8, 4, 8),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(
                                  group.title,
                                  style: const TextStyle(
                                      fontWeight: FontWeight.bold, fontSize: 15),
                                ),
                              ),
                              Text(
                                '${group.photos.length}',
                                style: const TextStyle(color: Colors.grey),
                              ),
                            ],
                          ),
                        ),
                      GridView.builder(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        gridDelegate:
                            const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 2,
                          crossAxisSpacing: 10,
                          mainAxisSpacing: 10,
                          childAspectRatio: 0.85,
                        ),
                        itemCount: group.photos.length,
                        itemBuilder: (context, index) =>
                            _tile(group.photos[index]),
                      ),
                      const SizedBox(height: 8),
                    ],
                  ],
                ),
    );
  }

  Widget _tile(StoragePhotoModel photo) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => _editCaption(photo),
        onLongPress: () => _delete(photo),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: Image.file(
                File(photo.filePath),
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) => const ColoredBox(
                  color: Color(0xffEEEEEE),
                  child: Center(
                    child: Icon(Icons.broken_image_outlined, color: Colors.grey),
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(8),
              child: Text(
                photo.caption.isEmpty ? 'Tap to describe' : photo.caption,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 12,
                  color: photo.caption.isEmpty ? Colors.grey : null,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PhotoGroup {
  final String title;
  final List<StoragePhotoModel> photos;

  const _PhotoGroup({required this.title, required this.photos});
}
