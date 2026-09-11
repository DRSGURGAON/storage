/// One line of goods on a storage booking - the Inventory List is
/// these rows. [releasedQty] is maintained by the goods-release flow so
/// [remainingQty] is always what is still in the godown.
class BookingItemModel {
  final String id;
  final String bookingId;
  final int sortOrder;

  final String itemName;
  final String description;
  final double quantity;
  final String unit;
  final String weight;
  final String marks;
  final String conditionNote;

  final double releasedQty;

  const BookingItemModel({
    required this.id,
    required this.bookingId,
    this.sortOrder = 0,
    required this.itemName,
    this.description = '',
    this.quantity = 1,
    this.unit = 'Nos',
    this.weight = '',
    this.marks = '',
    this.conditionNote = '',
    this.releasedQty = 0,
  });

  double get remainingQty {
    final remaining = quantity - releasedQty;
    return remaining < 0 ? 0 : remaining;
  }

  bool get isFullyReleased => remainingQty <= 0;

  BookingItemModel copyWith({
    String? id,
    String? bookingId,
    int? sortOrder,
    String? itemName,
    String? description,
    double? quantity,
    String? unit,
    String? weight,
    String? marks,
    String? conditionNote,
    double? releasedQty,
  }) {
    return BookingItemModel(
      id: id ?? this.id,
      bookingId: bookingId ?? this.bookingId,
      sortOrder: sortOrder ?? this.sortOrder,
      itemName: itemName ?? this.itemName,
      description: description ?? this.description,
      quantity: quantity ?? this.quantity,
      unit: unit ?? this.unit,
      weight: weight ?? this.weight,
      marks: marks ?? this.marks,
      conditionNote: conditionNote ?? this.conditionNote,
      releasedQty: releasedQty ?? this.releasedQty,
    );
  }

  Map<String, dynamic> toMap() => {
        'id': id,
        'booking_id': bookingId,
        'sort_order': sortOrder,
        'item_name': itemName,
        'description': description,
        'quantity': quantity,
        'unit': unit,
        'weight': weight,
        'marks': marks,
        'condition_note': conditionNote,
        'released_qty': releasedQty,
      };

  factory BookingItemModel.fromMap(Map<String, dynamic> map) {
    String text(String key) => (map[key] as String?) ?? '';
    double number(String key) => (map[key] as num?)?.toDouble() ?? 0;

    return BookingItemModel(
      id: map['id'] as String,
      bookingId: text('booking_id'),
      sortOrder: (map['sort_order'] as int?) ?? 0,
      itemName: text('item_name'),
      description: text('description'),
      quantity: number('quantity'),
      unit: text('unit').isEmpty ? 'Nos' : text('unit'),
      weight: text('weight'),
      marks: text('marks'),
      conditionNote: text('condition_note'),
      releasedQty: number('released_qty'),
    );
  }
}
