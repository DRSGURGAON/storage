import 'package:sqflite/sqflite.dart';

import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../../../core/tenant/tenant_scope.dart';
import '../../../core/utils/financial_year.dart';
import '../../../core/utils/id_generator.dart';
import '../../billing/repositories/billing_repository.dart';
import '../../company/controllers/company_controller.dart';
import '../../storage_booking/models/storage_booking_model.dart';
import '../../storage_booking/repositories/storage_booking_repository.dart';
import '../data/goods_release_dao.dart';
import '../models/goods_release_model.dart';

/// Goods going back out: the record, and the stock it takes off the
/// storage record it came from.
class GoodsReleaseRepository {
  GoodsReleaseRepository._();

  static final GoodsReleaseRepository instance = GoodsReleaseRepository._();

  final DatabaseHelper _db = DatabaseHelper.instance;
  final GoodsReleaseDao _dao = GoodsReleaseDao.instance;

  Future<List<GoodsReleaseModel>> getAll() => _dao.getAll();

  Future<GoodsReleaseModel?> getById(String id) => _dao.getById(id);

  Future<List<GoodsReleaseModel>> getForBooking(String bookingId) async {
    final all = await _dao.getAll();
    return all.where((r) => r.bookingId == bookingId).toList();
  }

  /// A not-yet-saved release for [booking] with every remaining item
  /// filled in - the operator takes out whatever is not going.
  GoodsReleaseModel draftForBooking(StorageBookingModel booking) {
    return GoodsReleaseModel(
      id: IdGenerator.generateId(),
      releaseDate: DateTime.now().toIso8601String(),
      bookingId: booking.id,
      bookingNo: booking.bookingNo,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      collectedByName: booking.customerName,
      collectedByPhone: booking.customerPhone,
      createdAt: '',
      items: [
        for (final item in booking.items)
          if (item.remainingQty > 0)
            ReleaseItemModel(
              id: IdGenerator.generateId(),
              bookingItemId: item.id,
              itemName: item.itemName,
              quantity: item.remainingQty,
              unit: item.unit,
            ),
      ],
    );
  }

  Future<int> _maxSerialInFinancialYear(
    DatabaseExecutor executor,
    int fyStart,
  ) async {
    final rows = await executor.query(
      DatabaseConstants.goodsReleaseTable,
      columns: ['release_no'],
      where: 'company_id = ? AND release_no LIKE ?',
      whereArgs: [TenantScope.companyId, '%/$fyStart/%'],
    );

    var maxNumber = 0;
    for (final row in rows) {
      final no = row['release_no'] as String? ?? '';
      final match = RegExp(r'(\d+)$').firstMatch(no);
      final number = match != null ? int.tryParse(match.group(1)!) ?? 0 : 0;
      if (number > maxNumber) maxNumber = number;
    }
    return maxNumber;
  }

  /// Records goods going out and takes them off the storage record. The
  /// storage record refuses more than what is left, so a release can
  /// never take out goods that are not there.
  Future<GoodsReleaseModel> save(GoodsReleaseModel release) async {
    final now = DateTime.now();
    final nowIso = now.toIso8601String();

    final booking =
        await StorageBookingRepository.instance.getById(release.bookingId);
    if (booking == null) {
      throw StateError('The storage record for this release no longer exists.');
    }

    final going = release.items.where((i) => i.quantity > 0).toList();
    if (going.isEmpty) {
      throw StateError('Nothing to release - enter what is going out.');
    }

    var outstanding = release.outstandingAtRelease;
    if (booking.customerId.isNotEmpty) {
      try {
        final balance =
            await BillingRepository.instance.balanceForCustomer(booking.customerId);
        outstanding = balance.outstanding;
      } catch (_) {
        // The release must still save if the balance cannot be read.
      }
    }

    final company = await CompanyController.instance.getCompany();
    final prefix = (company?.releasePrefix.isNotEmpty ?? false)
        ? company!.releasePrefix
        : 'RL';

    const maxAttempts = 5;
    final fyStart = FinancialYear.startYear(now);
    var idToUse = release.id.isEmpty ? IdGenerator.generateId() : release.id;

    GoodsReleaseModel? saved;
    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        saved = await _db.transaction((txn) async {
          final serial = await _maxSerialInFinancialYear(txn, fyStart) + attempt;
          final releaseNo =
              '$prefix/${FinancialYear.documentNumber(date: now, serial: serial)}';

          final withNumber = release.copyWith(
            id: idToUse,
            releaseNo: releaseNo,
            outstandingAtRelease: outstanding,
            createdAt: release.createdAt.isEmpty ? nowIso : release.createdAt,
            items: [
              for (final item in going)
                item.copyWith(
                  id: item.id.isEmpty ? IdGenerator.generateId() : item.id,
                  releaseId: idToUse,
                ),
            ],
          );

          await _dao.writeWithItems(txn, withNumber);
          return withNumber;
        });
        break;
      } on DatabaseException catch (error) {
        final message = error.toString();
        final isUnique = message.contains('UNIQUE constraint failed');
        final isNumberCollision = isUnique && message.contains('release_no');
        final isIdCollision = isUnique && message.contains('goods_releases.id');

        if (isIdCollision && attempt < maxAttempts) {
          idToUse = IdGenerator.generateId();
          continue;
        }
        if (!isNumberCollision || attempt == maxAttempts) rethrow;
      }
    }

    if (saved == null) {
      throw StateError('Could not allocate a unique release number.');
    }

    // Take the goods off the storage record. If it refuses (more than
    // what is left), undo the release rather than leave a record of
    // goods that never went out.
    try {
      await StorageBookingRepository.instance.applyRelease(
        saved.bookingId,
        {for (final item in saved.items) item.bookingItemId: item.quantity},
        actualEndDate: saved.releaseDate,
      );
    } catch (error) {
      await _dao.delete(saved.id);
      rethrow;
    }

    return saved;
  }

  /// Deletes a release and puts the goods back on the storage record.
  Future<void> delete(String id) async {
    final release = await _dao.getById(id);
    if (release == null) return;

    await _dao.delete(id);
    await StorageBookingRepository.instance.applyRelease(
      release.bookingId,
      {for (final item in release.items) item.bookingItemId: -item.quantity},
    );
  }
}
