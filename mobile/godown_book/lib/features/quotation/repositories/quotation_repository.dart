import 'package:sqflite/sqflite.dart';

import '../../../core/customer/customer_lookup_service.dart';
import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../../../core/tenant/tenant_scope.dart';
import '../../../core/utils/financial_year.dart';
import '../../../core/utils/id_generator.dart';
import '../../company/controllers/company_controller.dart';
import '../../customers/repositories/customer_repository.dart';
import '../../master/models/charge_head_model.dart';
import '../../master/repositories/charge_head_repository.dart';
import '../data/quotation_dao.dart';
import '../models/quotation_model.dart';

class QuotationRepository {
  QuotationRepository._() {
    CustomerLookupService.instance.extraSources.add(_suggestions);
  }

  static final QuotationRepository instance = QuotationRepository._();

  final DatabaseHelper _db = DatabaseHelper.instance;
  final QuotationDao _dao = QuotationDao.instance;

  Future<List<QuotationModel>> getAll() => _dao.getAll();

  Future<QuotationModel?> getById(String id) => _dao.getById(id);

  Future<List<QuotationModel>> getForCustomer(String customerId) async {
    final all = await _dao.getAll();
    return all.where((q) => q.customerId == customerId).toList();
  }

  Future<List<CustomerSuggestion>> _suggestions() async {
    final all = await _dao.getAll();
    return [
      for (final q in all)
        CustomerSuggestion(
          name: q.customerName,
          phone: q.customerPhone,
          gst: q.customerGst,
          address: q.customerAddress,
          city: q.customerCity,
          state: q.customerState,
          pincode: q.customerPincode,
          customerId: q.customerId,
          source: 'Quotation',
        ),
    ];
  }

  /// The service lines a new quotation starts with - the active charge
  /// heads, in their configured order, each carrying its own default
  /// mode and amount. The operator edits or removes what doesn't apply.
  Future<List<QuotationLineModel>> defaultLines() async {
    final heads = await ChargeHeadRepository.instance.getAll();
    return [
      for (final head in heads)
        QuotationLineModel(
          id: IdGenerator.generateId(),
          chargeHeadId: head.id,
          serviceName: head.chargeName,
          mode: head.defaultMode,
          rate: head.defaultAmount,
          amount: head.defaultMode == ChargeMode.amount ? head.defaultAmount : 0,
          taxable: head.taxable,
        ),
    ];
  }

  Future<int> _maxSerialInFinancialYear(
    DatabaseExecutor executor,
    int fyStart,
  ) async {
    final rows = await executor.query(
      DatabaseConstants.quotationTable,
      columns: ['quotation_no'],
      where: 'company_id = ? AND quotation_no LIKE ?',
      whereArgs: [TenantScope.companyId, '%/$fyStart/%'],
    );

    var maxNumber = 0;
    for (final row in rows) {
      final no = row['quotation_no'] as String? ?? '';
      final match = RegExp(r'(\d+)$').firstMatch(no);
      final number = match != null ? int.tryParse(match.group(1)!) ?? 0 : 0;
      if (number > maxNumber) maxNumber = number;
    }
    return maxNumber;
  }

  /// Creates a NEW quotation with a financial-year-scoped number
  /// allocated atomically, or UPDATEs the existing record when
  /// [quotation.id] is already saved - its number never changes.
  ///
  /// The tax split follows the customer's state: same state as the
  /// company means CGST + SGST, a different one means IGST.
  Future<QuotationModel> save(QuotationModel quotation) async {
    final now = DateTime.now();
    final nowIso = now.toIso8601String();

    final company = await CompanyController.instance.getCompany();
    final companyState = (company?.state ?? '').trim().toLowerCase();
    final customerState = quotation.customerState.trim().toLowerCase();
    final interState = companyState.isNotEmpty &&
        customerState.isNotEmpty &&
        companyState != customerState;

    var customerId = quotation.customerId;
    try {
      customerId = await CustomerRepository.instance.ensureCustomer(
        name: quotation.customerName,
        phone: quotation.customerPhone,
        gst: quotation.customerGst,
        address: quotation.customerAddress,
        city: quotation.customerCity,
        state: quotation.customerState,
        pincode: quotation.customerPincode,
      );
    } catch (_) {
      // The quotation must still save even if the master write fails.
    }

    final priced = quotation
        .copyWith(customerId: customerId)
        .recalculated(interState: interState);

    final existing = await _dao.getById(quotation.id);
    if (existing != null) {
      final updated = priced.copyWith(
        quotationNo: existing.quotationNo,
        createdAt: existing.createdAt,
        updatedAt: nowIso,
        lines: [
          for (final line in priced.lines)
            line.copyWith(
              id: line.id.isEmpty ? IdGenerator.generateId() : line.id,
              quotationId: existing.id,
            ),
        ],
      );
      await _db.transaction(
        (txn) => _dao.writeWithLines(txn, updated, isNew: false),
      );
      CustomerLookupService.instance.invalidate();
      return updated;
    }

    const maxAttempts = 5;
    final fyStart = FinancialYear.startYear(now);
    final prefix = (company?.quotationPrefix.isNotEmpty ?? false)
        ? company!.quotationPrefix
        : 'QT';

    var idToUse = priced.id.isEmpty ? IdGenerator.generateId() : priced.id;

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        final saved = await _db.transaction((txn) async {
          final serial = await _maxSerialInFinancialYear(txn, fyStart) + attempt;
          final quotationNo =
              '$prefix/${FinancialYear.documentNumber(date: now, serial: serial)}';

          final withNumber = priced.copyWith(
            id: idToUse,
            quotationNo: quotationNo,
            createdAt: priced.createdAt.isEmpty ? nowIso : priced.createdAt,
            updatedAt: nowIso,
            lines: [
              for (final line in priced.lines)
                line.copyWith(
                  id: line.id.isEmpty ? IdGenerator.generateId() : line.id,
                  quotationId: idToUse,
                ),
            ],
          );

          await _dao.writeWithLines(txn, withNumber, isNew: true);
          return withNumber;
        });
        CustomerLookupService.instance.invalidate();
        return saved;
      } on DatabaseException catch (error) {
        final message = error.toString();
        final isUnique = message.contains('UNIQUE constraint failed');
        final isNumberCollision = isUnique && message.contains('quotation_no');
        final isIdCollision = isUnique && message.contains('quotations.id');

        if (isIdCollision && attempt < maxAttempts) {
          idToUse = IdGenerator.generateId();
          continue;
        }
        if (!isNumberCollision || attempt == maxAttempts) rethrow;
      }
    }

    throw StateError('Could not allocate a unique quotation number.');
  }

  Future<void> setStatus(String id, QuotationStatus status) async {
    final existing = await _dao.getById(id);
    if (existing == null) return;
    await _dao.updateRow(existing.copyWith(
      status: status,
      updatedAt: DateTime.now().toIso8601String(),
    ));
  }

  Future<void> delete(String id) async {
    await _dao.delete(id);
    CustomerLookupService.instance.invalidate();
  }
}
