import 'package:sqflite/sqflite.dart';

import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../../../core/tenant/tenant_scope.dart';
import '../../../core/utils/financial_year.dart';
import '../../../core/utils/id_generator.dart';
import '../data/notice_dao.dart';
import '../models/notice_model.dart';

/// Letters sent to a customer about money owed. The row is the proof
/// that the letter went out, and on what date - which is what every
/// later step depends on.
class NoticeRepository {
  NoticeRepository._();

  static final NoticeRepository instance = NoticeRepository._();

  final DatabaseHelper _db = DatabaseHelper.instance;
  final NoticeDao _dao = NoticeDao.instance;

  /// Notices are numbered `NT/<FY>/0001` and up. There is no company
  /// setting for this prefix - a letter is not a tax document and its
  /// number only has to be unique and in order.
  static const String prefix = 'NT';

  Future<List<NoticeModel>> getAll() => _dao.getAll();

  Future<NoticeModel?> getById(String id) => _dao.getById(id);

  Future<List<NoticeModel>> getForCustomer(String customerId) =>
      _dao.getForCustomer(customerId);

  Future<List<NoticeModel>> getForBooking(String bookingId) =>
      _dao.getForBooking(bookingId);

  Future<int> _maxSerialInFinancialYear(
    DatabaseExecutor executor,
    int fyStart,
  ) async {
    final rows = await executor.query(
      DatabaseConstants.noticeTable,
      columns: ['notice_no'],
      where: 'company_id = ? AND notice_no LIKE ?',
      whereArgs: [TenantScope.companyId, '%/$fyStart/%'],
    );

    var maxNumber = 0;
    for (final row in rows) {
      final no = row['notice_no'] as String? ?? '';
      final match = RegExp(r'(\d+)$').firstMatch(no);
      final number = match != null ? int.tryParse(match.group(1)!) ?? 0 : 0;
      if (number > maxNumber) maxNumber = number;
    }
    return maxNumber;
  }

  /// Saves the letter and gives it its number. A notice is never
  /// edited afterwards: it has been sent.
  Future<NoticeModel> save(NoticeModel notice) async {
    final now = DateTime.now();
    final nowIso = now.toIso8601String();

    const maxAttempts = 5;
    final fyStart = FinancialYear.startYear(now);
    var idToUse = notice.id.isEmpty ? IdGenerator.generateId() : notice.id;

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await _db.transaction((txn) async {
          final serial = await _maxSerialInFinancialYear(txn, fyStart) + attempt;
          final noticeNo =
              '$prefix/${FinancialYear.documentNumber(date: now, serial: serial)}';

          final withNumber = notice.copyWith(
            id: idToUse,
            noticeNo: noticeNo,
            createdAt: notice.createdAt.isEmpty ? nowIso : notice.createdAt,
          );

          await _dao.insert(txn, withNumber);
          return withNumber;
        });
      } on DatabaseException catch (error) {
        final message = error.toString();
        final isUnique = message.contains('UNIQUE constraint failed');
        if (isUnique && message.contains('notices.id') && attempt < maxAttempts) {
          idToUse = IdGenerator.generateId();
          continue;
        }
        if (attempt == maxAttempts) rethrow;
      }
    }

    throw StateError('Could not allocate a notice number.');
  }

  /// Records how the letter was sent, so the trail is complete.
  Future<void> markSent(String id, String sentVia) async {
    final notice = await _dao.getById(id);
    if (notice == null) return;
    await _dao.update(notice.copyWith(sentVia: sentVia));
  }

  Future<void> delete(String id) => _dao.delete(id);
}
