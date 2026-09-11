import 'package:sqflite/sqflite.dart';

import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../../../core/tenant/tenant_scope.dart';
import '../models/notice_model.dart';

class NoticeDao {
  NoticeDao._();

  static final NoticeDao instance = NoticeDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  Future<List<NoticeModel>> getAll() async {
    final rows = await _db.queryScoped(
      DatabaseConstants.noticeTable,
      orderBy: 'notice_date DESC, created_at DESC',
    );
    return rows.map(NoticeModel.fromMap).toList();
  }

  Future<NoticeModel?> getById(String id) async {
    final rows = await _db.queryScoped(
      DatabaseConstants.noticeTable,
      where: 'id = ?',
      whereArgs: [id],
      limit: 1,
    );
    return rows.isEmpty ? null : NoticeModel.fromMap(rows.first);
  }

  Future<List<NoticeModel>> getForCustomer(String customerId) async {
    final rows = await _db.queryScoped(
      DatabaseConstants.noticeTable,
      where: 'customer_id = ?',
      whereArgs: [customerId],
      orderBy: 'notice_date DESC',
    );
    return rows.map(NoticeModel.fromMap).toList();
  }

  Future<List<NoticeModel>> getForBooking(String bookingId) async {
    final rows = await _db.queryScoped(
      DatabaseConstants.noticeTable,
      where: 'booking_id = ?',
      whereArgs: [bookingId],
      orderBy: 'notice_date DESC',
    );
    return rows.map(NoticeModel.fromMap).toList();
  }

  Future<void> insert(DatabaseExecutor txn, NoticeModel notice) async {
    await txn.insert(DatabaseConstants.noticeTable, {
      ...notice.toMap(),
      DatabaseConstants.companyIdColumn: TenantScope.companyId,
    });
  }

  Future<void> update(NoticeModel notice) =>
      _db.updateScoped(DatabaseConstants.noticeTable, notice.toMap(), notice.id);

  Future<void> delete(String id) =>
      _db.deleteScoped(DatabaseConstants.noticeTable, id);
}
