import 'package:sqflite/sqflite.dart';

import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../../../core/tenant/tenant_scope.dart';
import '../../../core/utils/financial_year.dart';
import '../../../core/utils/id_generator.dart';
import '../../company/controllers/company_controller.dart';
import '../../storage_booking/models/storage_booking_model.dart';
import '../data/consignment_dao.dart';
import '../models/consignment_model.dart';

/// Consignments moved by road, and the three papers that come off each
/// one. The Lorry Receipt number is allocated when the consignment is
/// first saved; the Delivery Challan number only when a challan is
/// actually printed, so that series has no gaps.
class ConsignmentRepository {
  ConsignmentRepository._();

  static final ConsignmentRepository instance = ConsignmentRepository._();

  final DatabaseHelper _db = DatabaseHelper.instance;
  final ConsignmentDao _dao = ConsignmentDao.instance;

  static const String lrPrefix = 'LR';
  static const String challanPrefix = 'DC';

  Future<List<ConsignmentModel>> getAll() => _dao.getAll();

  Future<ConsignmentModel?> getById(String id) => _dao.getById(id);

  Future<List<ConsignmentModel>> getForBooking(String bookingId) =>
      _dao.getForBooking(bookingId);

  /// A consignment started from a storage record: the customer is the
  /// consignor, and everything still in the godown is the load.
  ConsignmentModel draftForBooking(StorageBookingModel booking) {
    return ConsignmentModel(
      id: IdGenerator.generateId(),
      lrDate: DateTime.now().toIso8601String(),
      bookingId: booking.id,
      bookingNo: booking.bookingNo,
      customerId: booking.customerId,
      consignorName: booking.customerName,
      consignorPhone: booking.customerPhone,
      consignorAddress: booking.customerFullAddress,
      consignorGst: booking.customerGst,
      consigneeName: booking.customerName,
      consigneePhone: booking.customerPhone,
      fromPlace: booking.locationName,
      goodsDescription: booking.goodsDescription,
      packages: booking.totalPackages,
      declaredValue: booking.declaredValue,
      createdAt: '',
      items: [
        for (final item in booking.items)
          if (item.remainingQty > 0)
            ConsignmentItemModel(
              id: IdGenerator.generateId(),
              itemName: item.itemName,
              quantity: item.remainingQty,
              unit: item.unit,
              marks: item.marks,
              conditionNote: item.conditionNote,
            ),
      ],
    );
  }

  Future<int> _maxSerial(
    DatabaseExecutor executor,
    String column,
    int fyStart,
  ) async {
    final rows = await executor.query(
      DatabaseConstants.consignmentTable,
      columns: [column],
      where: 'company_id = ? AND $column LIKE ?',
      whereArgs: [TenantScope.companyId, '%/$fyStart/%'],
    );

    var maxNumber = 0;
    for (final row in rows) {
      final no = row[column] as String? ?? '';
      final match = RegExp(r'(\d+)$').firstMatch(no);
      final number = match != null ? int.tryParse(match.group(1)!) ?? 0 : 0;
      if (number > maxNumber) maxNumber = number;
    }
    return maxNumber;
  }

  /// Saves a consignment. A new one gets its LR number here; an
  /// existing one keeps the number it was issued with - a bilty that
  /// has travelled cannot be renumbered.
  Future<ConsignmentModel> save(ConsignmentModel consignment) async {
    final now = DateTime.now();
    final nowIso = now.toIso8601String();

    final existing = consignment.id.isEmpty
        ? null
        : await _dao.getById(consignment.id);

    if (existing != null) {
      final updated = consignment.copyWith(
        lrNo: existing.lrNo,
        challanNo: existing.challanNo,
        challanDate: existing.challanDate,
        createdAt: existing.createdAt,
        updatedAt: nowIso,
        items: [
          for (final item in consignment.items)
            item.copyWith(
              id: item.id.isEmpty ? IdGenerator.generateId() : item.id,
              consignmentId: existing.id,
            ),
        ],
      );

      await _db.transaction((txn) async {
        await _dao.writeWithItems(txn, updated, replaceExisting: true);
      });
      return updated;
    }

    final company = await CompanyController.instance.getCompany();
    final prefix = (company?.consignmentPrefix.isNotEmpty ?? false)
        ? company!.consignmentPrefix
        : lrPrefix;

    const maxAttempts = 5;
    final fyStart = FinancialYear.startYear(now);
    var idToUse =
        consignment.id.isEmpty ? IdGenerator.generateId() : consignment.id;

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await _db.transaction((txn) async {
          final serial = await _maxSerial(txn, 'lr_no', fyStart) + attempt;
          final lrNo =
              '$prefix/${FinancialYear.documentNumber(date: now, serial: serial)}';

          final withNumber = consignment.copyWith(
            id: idToUse,
            lrNo: lrNo,
            createdAt:
                consignment.createdAt.isEmpty ? nowIso : consignment.createdAt,
            updatedAt: nowIso,
            items: [
              for (final item in consignment.items)
                item.copyWith(
                  id: item.id.isEmpty ? IdGenerator.generateId() : item.id,
                  consignmentId: idToUse,
                ),
            ],
          );

          await _dao.writeWithItems(txn, withNumber);
          return withNumber;
        });
      } on DatabaseException catch (error) {
        final message = error.toString();
        final isUnique = message.contains('UNIQUE constraint failed');
        if (isUnique &&
            message.contains('consignments.id') &&
            attempt < maxAttempts) {
          idToUse = IdGenerator.generateId();
          continue;
        }
        if (attempt == maxAttempts) rethrow;
      }
    }

    throw StateError('Could not allocate an LR number.');
  }

  /// Gives the consignment its delivery-challan number, the first time
  /// one is printed. Calling it again returns what was already issued.
  Future<ConsignmentModel> ensureChallanNumber(String id) async {
    final consignment = await _dao.getById(id);
    if (consignment == null) {
      throw StateError('This consignment no longer exists.');
    }
    if (consignment.challanNo.isNotEmpty) return consignment;

    final now = DateTime.now();
    final fyStart = FinancialYear.startYear(now);

    final numbered = await _db.transaction((txn) async {
      final serial = await _maxSerial(txn, 'challan_no', fyStart) + 1;
      final challanNo =
          '$challanPrefix/${FinancialYear.documentNumber(date: now, serial: serial)}';

      final updated = consignment.copyWith(
        challanNo: challanNo,
        challanDate: now.toIso8601String(),
        updatedAt: now.toIso8601String(),
      );

      await txn.update(
        DatabaseConstants.consignmentTable,
        updated.toMap(),
        where: 'id = ? AND company_id = ?',
        whereArgs: [id, TenantScope.companyId],
      );
      return updated;
    });

    return numbered;
  }

  Future<void> setStatus(String id, ConsignmentStatus status) async {
    final consignment = await _dao.getById(id);
    if (consignment == null) return;
    await _dao.update(consignment.copyWith(
      status: status,
      updatedAt: DateTime.now().toIso8601String(),
    ));
  }

  /// Records the delivery at the other end. The same paper then doubles
  /// as proof of delivery.
  Future<ConsignmentModel?> markDelivered(
    String id, {
    required String receivedBy,
    required DateTime deliveredOn,
    String remarks = '',
  }) async {
    final consignment = await _dao.getById(id);
    if (consignment == null) return null;

    final delivered = consignment.copyWith(
      status: ConsignmentStatus.delivered,
      receivedBy: receivedBy,
      deliveredOn: deliveredOn.toIso8601String(),
      deliveryRemarks: remarks,
      updatedAt: DateTime.now().toIso8601String(),
    );
    await _dao.update(delivered);
    return delivered;
  }

  Future<void> delete(String id) => _dao.delete(id);
}
