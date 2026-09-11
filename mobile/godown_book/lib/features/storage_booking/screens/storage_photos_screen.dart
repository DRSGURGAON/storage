import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../models/storage_photo_model.dart';
import '../repositories/storage_photo_repository.dart';

/// Photos of one customer's goods - what came in, and what condition it
/// was in. Nothing here is required; it is evidence when it is needed.
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
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final photos =
        await StoragePhotoRepository.instance.getForBooking(widget.bookingId);
    if (!mounted) return;
    setState(() {
      _photos = photos;
      _loading = false;
    });
  }

  Future<void> _add(ImageSource source) async {
    try {
      await StoragePhotoRepository.instance
          .addPhoto(bookingId: widget.bookingId, source: source);
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
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(32),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.photo_camera_outlined, size: 48),
                        SizedBox(height: 12),
                        Text(
                          'No photos yet.\nPhotos of the goods and their condition '
                          'settle most questions later.',
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  ),
                )
              : GridView.builder(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                    childAspectRatio: 0.85,
                  ),
                  itemCount: _photos.length,
                  itemBuilder: (context, index) {
                    final photo = _photos[index];
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
                  },
                ),
    );
  }
}
