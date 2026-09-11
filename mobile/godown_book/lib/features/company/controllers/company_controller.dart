import 'package:uuid/uuid.dart';

import '../../../core/tenant/tenant_migrator.dart';
import '../../../core/tenant/tenant_scope.dart';
import '../../audit/repositories/security_audit_repository.dart';
import '../models/company_model.dart';
import '../repositories/company_repository.dart';
import '../services/company_firestore_sync_service.dart';

class CompanyController {
  CompanyController._();

  static final CompanyController instance = CompanyController._();

  final CompanyRepository _repository = CompanyRepository.instance;

  // ==========================
  // GET COMPANY
  // ==========================

  Future<CompanyModel?> getCompany() {
    return _repository.getCompany();
  }

  // ==========================
  // SAVE COMPANY
  // ==========================

  /// Saves the company, minting its tenant id on first save.
  ///
  /// The id is generated once and never changes: it is the key every
  /// business row is stamped with, so regenerating it would orphan the
  /// entire database.
  Future<CompanyModel> saveCompany(CompanyModel company) async {
    final existing = await _repository.getCompany();

    final companyId = (existing?.companyId.isNotEmpty ?? false)
        ? existing!.companyId
        : company.companyId.isNotEmpty
        ? company.companyId
        : const Uuid().v4();

    // The settings screen never shows or edits company_code, so its model
    // always carries the class default ('DRS001'). Without this, every
    // settings save would silently reset company_code back to the
    // default and erase whatever it had actually been set to.
    final companyCode = (existing?.companyCode.isNotEmpty ?? false)
        ? existing!.companyCode
        : company.companyCode;

    final toSave = company.copyWith(
      companyId: companyId,
      companyCode: companyCode,
    );

    await _repository.saveCompany(toSave);

    TenantScope.set(companyId);

    // Best-effort cloud mirror (this task's own explicit "har company
    // ki details save ho online m" requirement) - genuinely never
    // blocks or fails this method: pushToCloud() itself swallows its
    // own errors (offline, etc.) and returns false rather than
    // throwing, so the local save above remains authoritative and
    // immediate regardless of connectivity.
    await CompanyFirestoreSyncService.instance.pushToCloud(toSave);

    // Seed rows written before the company existed have no owner yet.
    await TenantMigrator.claimUnassignedRows(companyId);

    if (existing != null) {
      await SecurityAuditRepository.instance.record(
        eventType: SecurityAuditType.companySettingsChanged,
        description: 'Company settings updated.',
        entityType: 'company',
        entityId: companyId,
      );
    }

    return toSave;
  }

  // ==========================
  // CLEAR COMPANY
  // ==========================

  Future<void> clearCompany() async {
    await _repository.clearCompany();

    TenantScope.clear();
  }
}
