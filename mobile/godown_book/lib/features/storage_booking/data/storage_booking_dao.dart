import 'package:sqflite/sqflite.dart';

import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../../../core/tenant/tenant_scope.dart';
import '../models/booking_item_model.dart';
import '../models/storage_booking_model.dart';

class StorageBookingDao {
  StorageBookingDao._();

  static final StorageBookingDao instance = StorageBookingDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  Future<List<StorageBookingModel>> getAll() async {
    final rows = await _db.queryScoped(
      DatabaseConstants.storageBookingTable,
      orderBy: 'booking_date DESC, created_at DESC',
    );
    if (rows.isEmpty) return const [];

    final itemRows = await _db.queryScoped(
      DatabaseConstants.bookingItemTable,
      orderBy: 'sort_order ASC',
    );

    final itemsByBooking = <String, List<BookingItemModel>>{};
    for (final row in itemRows) {
      final item = BookingItemModel.fromMap(row);
      itemsByBooking.putIfAbsent(item.bookingId, () => []).add(item);
    }

    return [
      for (final row in rows)
        StorageBookingModel.fromMap(
          row,
          items: itemsByBooking[row['id'] as String] ?? const [],
        ),
    ];
  }

  Future<StorageBookingModel?> getById(String id) async {
    final rows = await _db.queryScoped(
      DatabaseConstants.storageBookingTable,
      where: 'id = ?',
      whereArgs: [id],
      limit: 1,
    );
    if (rows.isEmpty) return null;

    return StorageBookingModel.fromMap(rows.first, items: await getItems(id));
  }

  Future<List<BookingItemModel>> getItems(String bookingId) async {
    final rows = await _db.queryScoped(
      DatabaseConstants.bookingItemTable,
      where: 'booking_id = ?',
      whereArgs: [bookingId],
      orderBy: 'sort_order ASC',
    );
    return rows.map(BookingItemModel.fromMap).toList();
  }

  /// Writes the booking row and replaces its items inside [txn] - the
  /// caller owns the transaction so numbering and rows commit together.
  Future<void> writeWithItems(
    DatabaseExecutor txn,
    StorageBookingModel booking, {
    required bool isNew,
  }) async {
    final companyId = TenantScope.companyId;

    if (isNew) {
      await txn.insert(DatabaseConstants.storageBookingTable, {
        ...booking.toMap(),
        DatabaseConstants.companyIdColumn: companyId,
      });
    } else {
      await txn.update(
        DatabaseConstants.storageBookingTable,
        booking.toMap(),
        where: 'id = ? AND ${DatabaseConstants.companyIdColumn} = ?',
        whereArgs: [booking.id, companyId],
      );
      await txn.delete(
        DatabaseConstants.bookingItemTable,
        where: 'booking_id = ? AND ${DatabaseConstants.companyIdColumn} = ?',
        whereArgs: [booking.id, companyId],
      );
    }

    var order = 0;
    for (final item in booking.items) {
      await txn.insert(DatabaseConstants.bookingItemTable, {
        ...item.copyWith(bookingId: booking.id, sortOrder: order).toMap(),
        DatabaseConstants.companyIdColumn: companyId,
      });
      order += 10;
    }
  }

  Future<void> updateRow(StorageBookingModel booking) async {
    await _db.updateScoped(
      DatabaseConstants.storageBookingTable,
      booking.toMap(),
      booking.id,
    );
  }

  Future<void> updateItem(BookingItemModel item) async {
    await _db.updateScoped(
      DatabaseConstants.bookingItemTable,
      item.toMap(),
      item.id,
    );
  }

  Future<void> delete(String id) async {
    await _db.deleteWhereScoped(
      DatabaseConstants.bookingItemTable,
      'booking_id = ?',
      [id],
    );
    await _db.deleteScoped(DatabaseConstants.storageBookingTable, id);
  }
}
