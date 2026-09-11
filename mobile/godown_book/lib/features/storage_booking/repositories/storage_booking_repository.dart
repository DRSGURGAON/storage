import 'package:sqflite/sqflite.dart';

import '../../../core/customer/customer_lookup_service.dart';
import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../../../core/tenant/tenant_scope.dart';
import '../../../core/utils/financial_year.dart';
import '../../../core/utils/id_generator.dart';
import '../../company/controllers/company_controller.dart';
import '../../customers/repositories/customer_repository.dart';
import '../data/storage_booking_dao.dart';
import '../models/booking_item_model.dart';
import '../models/storage_booking_model.dart';
import '../models/storage_status.dart';

/// Storage entries (the goods a customer has with us) - numbering,
/// item list and status.
class StorageBookingRepository {
  StorageBookingRepository._() {
    // Bookings feed the customer-name suggestions on every other form,
    // without the core lookup service importing this feature.
    CustomerLookupService.instance.extraSources.add(_suggestions);
  }

  static final StorageBookingRepository instance = StorageBookingRepository._();

  final DatabaseHelper _db = DatabaseHelper.instance;
  final StorageBookingDao _dao = StorageBookingDao.instance;

  Future<List<StorageBookingModel>> getAll() => _dao.getAll();

  /// Bookings with goods still inside - what a Delivery Order or rent
  /// bill can be raised against.
  Future<List<StorageBookingModel>> getOpen() async {
    final all = await _dao.getAll();
    return all.where((b) => b.status.isOpen).toList();
  }

  Future<StorageBookingModel?> getById(String id) => _dao.getById(id);

  Future<List<CustomerSuggestion>> _suggestions() async {
    final all = await _dao.getAll();
    return [
      for (final b in all)
        CustomerSuggestion(
          name: b.customerName,
          phone: b.customerPhone,
          gst: b.customerGst,
          address: b.customerAddress,
          city: b.customerCity,
          state: b.customerState,
          pincode: b.customerPincode,
          customerId: b.customerId,
          source: 'Storage Receipt',
        ),
    ];
  }

  Future<int> _maxSerialInFinancialYear(
    DatabaseExecutor executor,
    int fyStart,
  ) async {
    final rows = await executor.query(
      DatabaseConstants.storageBookingTable,
      columns: ['booking_no'],
      where: 'company_id = ? AND booking_no LIKE ?',
      whereArgs: [TenantScope.companyId, '%/$fyStart/%'],
    );

    var maxNumber = 0;
    for (final row in rows) {
      final no = row['booking_no'] as String? ?? '';
      // Prefix-agnostic: the prefix is configurable (Company Settings)
      // and may change, the trailing serial is what matters.
      final match = RegExp(r'(\d+)$').firstMatch(no);
      final number = match != null ? int.tryParse(match.group(1)!) ?? 0 : 0;
      if (number > maxNumber) maxNumber = number;
    }
    return maxNumber;
  }

  /// Creates a NEW booking with a financial-year-scoped number allocated
  /// atomically (computed and inserted inside one transaction, retried
  /// on a UNIQUE collision), or UPDATEs the existing record when
  /// [booking.id] is already saved - its number is never reallocated.
  ///
  /// Also makes sure the customer exists in the Customer master, so a
  /// depositor entered straight on the receipt shows up in Customers
  /// and on the next receipt's suggestions.
  Future<StorageBookingModel> save(StorageBookingModel booking) async {
    final now = DateTime.now();
    final nowIso = now.toIso8601String();

    var customerId = booking.customerId;
    try {
      customerId = await CustomerRepository.instance.ensureCustomer(
        name: booking.customerName,
        phone: booking.customerPhone,
        gst: booking.customerGst,
        address: booking.customerAddress,
        city: booking.customerCity,
        state: booking.customerState,
        pincode: booking.customerPincode,
      );
    } catch (_) {
      // The receipt must still save even if the master write fails.
    }

    final existing = await _dao.getById(booking.id);
    if (existing != null) {
      // Editing never touches numbering, status or rent progress - and
      // keeps each item's released quantity, matched by item id.
      final releasedById = {
        for (final item in existing.items) item.id: item.releasedQty,
      };
      final withPreserved = booking.copyWith(
        bookingNo: existing.bookingNo,
        customerId: customerId,
        status: existing.status,
        rentBilledUpto: existing.rentBilledUpto,
        createdAt: existing.createdAt,
        updatedAt: nowIso,
        items: [
          for (final item in booking.items)
            item.copyWith(
              id: item.id.isEmpty ? IdGenerator.generateId() : item.id,
              bookingId: booking.id,
              releasedQty: releasedById[item.id] ?? 0,
            ),
        ],
      );
      final restated = withPreserved.copyWith(
        status: withPreserved.derivedStatus,
      );
      await _db.transaction(
        (txn) => _dao.writeWithItems(txn, restated, isNew: false),
      );
      CustomerLookupService.instance.invalidate();
      return restated;
    }

    const maxAttempts = 5;
    final fyStart = FinancialYear.startYear(now);

    final company = await CompanyController.instance.getCompany();
    final prefix = (company?.bookingPrefix.isNotEmpty ?? false)
        ? company!.bookingPrefix
        : 'SR';

    var idToUse = booking.id.isEmpty ? IdGenerator.generateId() : booking.id;

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        final saved = await _db.transaction((txn) async {
          final serial = await _maxSerialInFinancialYear(txn, fyStart) + attempt;
          final bookingNo =
              '$prefix/${FinancialYear.documentNumber(date: now, serial: serial)}';

          final withNumber = booking.copyWith(
            id: idToUse,
            bookingNo: bookingNo,
            customerId: customerId,
            status: StorageStatus.inStorage,
            createdAt: booking.createdAt.isEmpty ? nowIso : booking.createdAt,
            updatedAt: nowIso,
            items: [
              for (final item in booking.items)
                item.copyWith(
                  id: item.id.isEmpty ? IdGenerator.generateId() : item.id,
                  bookingId: idToUse,
                  releasedQty: 0,
                ),
            ],
          );

          await _dao.writeWithItems(txn, withNumber, isNew: true);
          return withNumber;
        });
        CustomerLookupService.instance.invalidate();
        return saved;
      } on DatabaseException catch (error) {
        final message = error.toString();
        final isUnique = message.contains('UNIQUE constraint failed');
        final isNumberCollision = isUnique && message.contains('booking_no');
        final isIdCollision = isUnique && message.contains('storage_bookings.id');

        if (isIdCollision && attempt < maxAttempts) {
          idToUse = IdGenerator.generateId();
          continue;
        }
        if (!isNumberCollision || attempt == maxAttempts) rethrow;
      }
    }

    throw StateError('Could not allocate a unique Storage Receipt number.');
  }

  /// Applies released quantities (from a goods release) to the items
  /// and restates the booking's status. [releasedByItemId] is the
  /// delta to add per item; negative deltas undo a deleted release.
  Future<StorageBookingModel> applyRelease(
    String bookingId,
    Map<String, double> releasedByItemId, {
    String? actualEndDate,
  }) async {
    final booking = await _dao.getById(bookingId);
    if (booking == null) {
      throw StateError('Booking $bookingId not found.');
    }

    final updatedItems = <BookingItemModel>[];
    for (final item in booking.items) {
      final delta = releasedByItemId[item.id] ?? 0;
      if (delta == 0) {
        updatedItems.add(item);
        continue;
      }
      var released = item.releasedQty + delta;
      if (released < 0) released = 0;
      if (released > item.quantity) {
        throw StateError(
          'Cannot release ${item.remainingQty + delta} of "${item.itemName}": '
          'only ${item.remainingQty} remaining.',
        );
      }
      final updated = item.copyWith(releasedQty: released);
      updatedItems.add(updated);
      await _dao.updateItem(updated);
    }

    final withItems = booking.copyWith(items: updatedItems);
    final status = withItems.derivedStatus;
    final restated = withItems.copyWith(
      status: status,
      actualEndDate: status == StorageStatus.released
          ? (actualEndDate ?? booking.actualEndDate)
          : (status == StorageStatus.inStorage ? '' : booking.actualEndDate),
      updatedAt: DateTime.now().toIso8601String(),
    );
    await _dao.updateRow(restated);
    return restated;
  }

  /// Moves the rent-billed watermark forward (or back, when a rent bill
  /// is deleted). Stored as an ISO date (yyyy-MM-dd).
  Future<void> setRentBilledUpto(String bookingId, String isoDate) async {
    final booking = await _dao.getById(bookingId);
    if (booking == null) return;
    await _dao.updateRow(booking.copyWith(
      rentBilledUpto: isoDate,
      updatedAt: DateTime.now().toIso8601String(),
    ));
  }

  Future<void> cancel(String bookingId) async {
    final booking = await _dao.getById(bookingId);
    if (booking == null) return;
    await _dao.updateRow(booking.copyWith(
      status: StorageStatus.cancelled,
      updatedAt: DateTime.now().toIso8601String(),
    ));
  }

  /// Permanently removes a booking and its items. Releases and rent
  /// bills raised against it hold their own snapshots (booking_no,
  /// customer) so they keep printing; their "open booking" link simply
  /// stops resolving.
  Future<void> delete(String id) async {
    await _dao.delete(id);
    CustomerLookupService.instance.invalidate();
  }
}
