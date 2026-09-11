/// A place inside the godown goods can be kept - a hall, room, rack or
/// bay. Purely a label for finding the goods again.
class StorageLocationModel {
  final String id;
  final String code;
  final String name;
  final String description;
  final int sortOrder;
  final bool isActive;

  const StorageLocationModel({
    required this.id,
    required this.code,
    required this.name,
    this.description = '',
    this.sortOrder = 0,
    this.isActive = true,
  });

  StorageLocationModel copyWith({
    String? code,
    String? name,
    String? description,
    int? sortOrder,
    bool? isActive,
  }) {
    return StorageLocationModel(
      id: id,
      code: code ?? this.code,
      name: name ?? this.name,
      description: description ?? this.description,
      sortOrder: sortOrder ?? this.sortOrder,
      isActive: isActive ?? this.isActive,
    );
  }

  Map<String, dynamic> toMap() => {
        'id': id,
        'code': code,
        'name': name,
        'description': description,
        'sort_order': sortOrder,
        'is_active': isActive ? 1 : 0,
      };

  factory StorageLocationModel.fromMap(Map<String, dynamic> map) {
    return StorageLocationModel(
      id: map['id'] as String,
      code: (map['code'] as String?) ?? '',
      name: (map['name'] as String?) ?? '',
      description: (map['description'] as String?) ?? '',
      sortOrder: (map['sort_order'] as int?) ?? 0,
      isActive: ((map['is_active'] as int?) ?? 1) == 1,
    );
  }
}
