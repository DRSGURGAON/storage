/// A photo of the goods - their condition, the boxes, or the area they
/// are kept in. The image itself lives on the device; only this record
/// is stored and backed up.
class StoragePhotoModel {
  final String id;
  final String bookingId;

  /// Set when the photo is evidence on a damage / loss report rather
  /// than a picture of the goods as they came in.
  final String incidentId;

  /// Set when the photo shows one listed item in particular. Empty for
  /// a photo of the consignment as a whole.
  final String itemId;

  final String filePath;
  final String caption;
  final int sortOrder;
  final String createdAt;

  const StoragePhotoModel({
    required this.id,
    required this.bookingId,
    this.incidentId = '',
    this.itemId = '',
    required this.filePath,
    this.caption = '',
    this.sortOrder = 0,
    required this.createdAt,
  });

  StoragePhotoModel copyWith({String? caption, int? sortOrder}) {
    return StoragePhotoModel(
      id: id,
      bookingId: bookingId,
      incidentId: incidentId,
      itemId: itemId,
      filePath: filePath,
      caption: caption ?? this.caption,
      sortOrder: sortOrder ?? this.sortOrder,
      createdAt: createdAt,
    );
  }

  Map<String, dynamic> toMap() => {
        'id': id,
        'booking_id': bookingId,
        'incident_id': incidentId,
        'item_id': itemId,
        'file_path': filePath,
        'caption': caption,
        'sort_order': sortOrder,
        'created_at': createdAt,
      };

  factory StoragePhotoModel.fromMap(Map<String, dynamic> map) {
    String text(String key) => (map[key] as String?) ?? '';

    return StoragePhotoModel(
      id: map['id'] as String,
      bookingId: text('booking_id'),
      incidentId: text('incident_id'),
      itemId: text('item_id'),
      filePath: text('file_path'),
      caption: text('caption'),
      sortOrder: (map['sort_order'] as int?) ?? 0,
      createdAt: text('created_at'),
    );
  }
}
