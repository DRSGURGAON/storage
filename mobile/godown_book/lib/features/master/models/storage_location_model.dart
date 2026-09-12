/// A place inside the godown goods can be kept - a hall, room, rack or
/// bay. A label for finding the goods again, and, when [capacity] is
/// set, how many lots it holds - which is what lets the dashboard show
/// empty space as well as full.
class StorageLocationModel {
  final String id;
  final String code;
  final String name;
  final String description;
  final int sortOrder;
  final bool isActive;

  /// How many lots (customers' consignments) this place holds. Zero
  /// means nobody has said, and the place simply does not count
  /// towards the godown's capacity.
  final int capacity;

  const StorageLocationModel({
    required this.id,
    required this.code,
    required this.name,
    this.description = '',
    this.sortOrder = 0,
    this.isActive = true,
    this.capacity = 0,
  });

  StorageLocationModel copyWith({
    String? code,
    String? name,
    String? description,
    int? sortOrder,
    bool? isActive,
    int? capacity,
  }) {
    return StorageLocationModel(
      id: id,
      code: code ?? this.code,
      name: name ?? this.name,
      description: description ?? this.description,
      sortOrder: sortOrder ?? this.sortOrder,
      isActive: isActive ?? this.isActive,
      capacity: capacity ?? this.capacity,
    );
  }

  Map<String, dynamic> toMap() => {
        'id': id,
        'code': code,
        'name': name,
        'description': description,
        'sort_order': sortOrder,
        'is_active': isActive ? 1 : 0,
        'capacity': capacity,
      };

  factory StorageLocationModel.fromMap(Map<String, dynamic> map) {
    return StorageLocationModel(
      id: map['id'] as String,
      code: (map['code'] as String?) ?? '',
      name: (map['name'] as String?) ?? '',
      description: (map['description'] as String?) ?? '',
      sortOrder: (map['sort_order'] as int?) ?? 0,
      isActive: ((map['is_active'] as int?) ?? 1) == 1,
      capacity: (map['capacity'] as int?) ?? 0,
    );
  }
}
