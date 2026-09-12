import 'dart:io';

import 'package:image_picker/image_picker.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../../../core/utils/id_generator.dart';
import '../models/storage_photo_model.dart';

/// Photos of a customer's goods.
///
/// image_picker hands back a path in the OS cache, which can be cleared
/// at any time, so every picked or captured image is copied into the
/// app's own documents directory before its path is stored - the same
/// reason the company logo is copied there.
class StoragePhotoRepository {
  StoragePhotoRepository._();

  static final StoragePhotoRepository instance = StoragePhotoRepository._();

  final DatabaseHelper _db = DatabaseHelper.instance;
  final ImagePicker _picker = ImagePicker();

  Future<List<StoragePhotoModel>> getForBooking(String bookingId) async {
    final rows = await _db.queryScoped(
      DatabaseConstants.storagePhotoTable,
      where: 'booking_id = ? AND incident_id = ?',
      whereArgs: [bookingId, ''],
      orderBy: 'sort_order ASC, created_at ASC',
    );
    return rows.map(StoragePhotoModel.fromMap).toList();
  }

  /// The photographs attached to one damage / loss report.
  Future<List<StoragePhotoModel>> getForIncident(String incidentId) async {
    final rows = await _db.queryScoped(
      DatabaseConstants.storagePhotoTable,
      where: 'incident_id = ?',
      whereArgs: [incidentId],
      orderBy: 'sort_order ASC, created_at ASC',
    );
    return rows.map(StoragePhotoModel.fromMap).toList();
  }

  Future<int> countForBooking(String bookingId) async =>
      (await getForBooking(bookingId)).length;

  /// The photos of one listed item.
  Future<List<StoragePhotoModel>> getForItem(String itemId) async {
    final rows = await _db.queryScoped(
      DatabaseConstants.storagePhotoTable,
      where: 'item_id = ?',
      whereArgs: [itemId],
      orderBy: 'sort_order ASC, created_at ASC',
    );
    return rows.map(StoragePhotoModel.fromMap).toList();
  }

  /// How many photos each item on a storage record has, keyed by item
  /// id. The whole-consignment photos sit under the empty key.
  Future<Map<String, int>> countByItem(String bookingId) async {
    final counts = <String, int>{};
    for (final photo in await getForBooking(bookingId)) {
      counts[photo.itemId] = (counts[photo.itemId] ?? 0) + 1;
    }
    return counts;
  }

  /// Takes a photo with the camera, or picks one from the gallery, and
  /// attaches it to [bookingId]. Returns null if the user backed out.
  Future<StoragePhotoModel?> addPhoto({
    required String bookingId,
    required ImageSource source,
    String caption = '',
    String incidentId = '',
    String itemId = '',
  }) async {
    final file = await _picker.pickImage(source: source, imageQuality: 80);
    if (file == null) return null;

    final documentsDir = await getApplicationDocumentsDirectory();
    final photosDir = Directory(p.join(documentsDir.path, 'storage-photos'));
    if (!await photosDir.exists()) {
      await photosDir.create(recursive: true);
    }

    final extension = p.extension(file.path).isEmpty ? '.jpg' : p.extension(file.path);
    final destination = File(p.join(
      photosDir.path,
      'photo-${DateTime.now().millisecondsSinceEpoch}$extension',
    ));
    await File(file.path).copy(destination.path);

    final existing = incidentId.isEmpty
        ? await getForBooking(bookingId)
        : await getForIncident(incidentId);
    final photo = StoragePhotoModel(
      id: IdGenerator.generateId(),
      bookingId: bookingId,
      incidentId: incidentId,
      itemId: itemId,
      filePath: destination.path,
      caption: caption,
      sortOrder: existing.length * 10,
      createdAt: DateTime.now().toIso8601String(),
    );

    await _db.insertScoped(DatabaseConstants.storagePhotoTable, photo.toMap());
    return photo;
  }

  /// Attaches an image that is already on disk - used by tests and by
  /// any caller that has its own file.
  Future<StoragePhotoModel> attachFile({
    required String bookingId,
    required String filePath,
    String caption = '',
    String incidentId = '',
    String itemId = '',
  }) async {
    final existing = incidentId.isEmpty
        ? await getForBooking(bookingId)
        : await getForIncident(incidentId);
    final photo = StoragePhotoModel(
      id: IdGenerator.generateId(),
      bookingId: bookingId,
      incidentId: incidentId,
      itemId: itemId,
      filePath: filePath,
      caption: caption,
      sortOrder: existing.length * 10,
      createdAt: DateTime.now().toIso8601String(),
    );

    await _db.insertScoped(DatabaseConstants.storagePhotoTable, photo.toMap());
    return photo;
  }

  Future<void> updateCaption(StoragePhotoModel photo, String caption) async {
    await _db.updateScoped(
      DatabaseConstants.storagePhotoTable,
      photo.copyWith(caption: caption).toMap(),
      photo.id,
    );
  }

  /// Removes the record and, best effort, the image file with it.
  Future<void> delete(StoragePhotoModel photo) async {
    await _db.deleteScoped(DatabaseConstants.storagePhotoTable, photo.id);
    try {
      final file = File(photo.filePath);
      if (await file.exists()) await file.delete();
    } catch (_) {
      // The record is gone either way; a leftover file is harmless.
    }
  }
}
