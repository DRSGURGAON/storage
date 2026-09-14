import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../features/company/controllers/company_controller.dart';
import '../../features/company/models/company_model.dart';
import '../../features/company/services/company_firestore_sync_service.dart';
import '../auth/auth_scope.dart';
import '../auth/auth_session.dart';
import '../cloud_sync/document_cloud_sync_service.dart';
import '../database/app_database.dart';
import 'tenant_scope.dart';

/// How a company came to be the active tenant.
enum TenantBootstrapOutcome {
  /// The signed-in account already had a company in the cloud: it was
  /// installed locally (same company id) and its documents restored.
  restoredFromCloud,

  /// The account had nothing in the cloud: a first, empty company was
  /// created for it - never pushed until it has a name.
  createdNew,

  /// The company already on this device belongs to this account and
  /// was simply activated (the normal restart).
  keptLocal,

  /// The cloud could not be reached, so nothing was decided - the
  /// caller asks the user to retry rather than guessing.
  failed,
}

class TenantBootstrapResult {
  final TenantBootstrapOutcome outcome;
  final String companyId;
  final int restoredRows;
  final String? error;

  const TenantBootstrapResult({
    required this.outcome,
    this.companyId = '',
    this.restoredRows = 0,
    this.error,
  });

  bool get succeeded => outcome != TenantBootstrapOutcome.failed;
}

/// Decides which company this device works on, and for whom.
///
/// The rule is simple: the active company belongs to the signed-in
/// Firebase account. On a fresh install nothing is created before
/// somebody signs in; after OTP sign-in the account's cloud company is
/// looked up - restored when it exists (reinstall, new phone), created
/// when it genuinely does not. On every later launch the company on
/// the device is kept as long as it belongs to the same account, so
/// the app works fully offline. When a different account signs in on
/// the same phone, its own company is looked up the same way; the
/// previous account's rows stay in SQLite under their own company id,
/// invisible to every scoped query, and come straight back when that
/// account signs in again.
///
/// The owner of the local company is remembered in SharedPreferences
/// ([ownerUidKey]). An install from before this existed has no owner
/// recorded; the first signed-in account adopts it, which is exactly
/// what those installs did implicitly.
class TenantBootstrap {
  TenantBootstrap._();

  static const String ownerUidKey = 'tenant_owner_uid';

  /// Tests: pretend this account is signed in (null = nobody).
  @visibleForTesting
  static String? Function()? currentUidOverride;

  static String? get _currentUid {
    final override = currentUidOverride;
    if (override != null) return override();
    try {
      final uid = FirebaseAuth.instance.currentUser?.uid;
      return (uid == null || uid.isEmpty) ? null : uid;
    } catch (_) {
      // No Firebase app (a bare test build).
      return null;
    }
  }

  /// Startup: activate the company on this device when it belongs to
  /// whoever is signed in. Creates nothing while nobody is signed in.
  ///
  /// If the device holds a company of a different account, or none at
  /// all, while an account is signed in, the account's own company is
  /// bootstrapped from the cloud. Should that fail (offline), the local
  /// session is cleared so the user signs in again - which guarantees
  /// the cloud is reachable when the decision is made - instead of the
  /// app inventing a company that would later shadow the real one.
  static Future<void> loadAtStartup() async {
    try {
      final uid = _currentUid;
      final local = await CompanyController.instance.getCompany();
      final owner = await _ownerUid();

      if (local != null && local.companyId.isNotEmpty) {
        if (owner == null || owner.isEmpty) {
          // An install from before ownership was recorded. If it is
          // still the empty shell the old startup created before login
          // and the account has a real company in the cloud, that
          // company is the one to use; otherwise adopt what is here.
          if (uid != null &&
              local.companyName.trim().isEmpty &&
              !await _hasAnyRows(local.companyId)) {
            final result = await bootstrapForUid(uid);
            if (result.succeeded) return;
          }
          if (uid != null) await _setOwnerUid(uid);
          TenantScope.set(local.companyId);
          return;
        }

        if (uid == null || owner == uid) {
          TenantScope.set(local.companyId);
          return;
        }

        // Somebody else's company is on the device.
        final result = await bootstrapForUid(uid);
        if (!result.succeeded) await _requireFreshSignIn();
        return;
      }

      if (uid != null && AuthScope.isAuthenticated) {
        final result = await bootstrapForUid(uid);
        if (!result.succeeded) await _requireFreshSignIn();
      }
      // Nobody signed in: the OTP screen bootstraps after sign-in.
    } catch (error) {
      // Local database genuinely unavailable: TenantScope stays unset
      // and any screen that needs a tenant fails honestly.
      debugPrint('Tenant not loaded at startup: $error');
    }
  }

  /// After a genuine OTP sign-in: make [uid]'s own company the active
  /// tenant - the one already on this device if it is theirs, else the
  /// one in the cloud, else a new one.
  static Future<TenantBootstrapResult> bootstrapAfterLogin(String uid) async {
    final local = await CompanyController.instance.getCompany();
    final owner = await _ownerUid();
    if (local != null &&
        local.companyId.isNotEmpty &&
        (owner == uid || (owner == null || owner.isEmpty))) {
      // Same account as before, or an install from before ownership
      // was recorded that is not the pre-login shell (see loadAtStartup).
      final isEmptyShell = (owner == null || owner.isEmpty) &&
          local.companyName.trim().isEmpty &&
          !await _hasAnyRows(local.companyId);
      if (!isEmptyShell) {
        await _setOwnerUid(uid);
        TenantScope.set(local.companyId);
        return TenantBootstrapResult(
          outcome: TenantBootstrapOutcome.keptLocal,
          companyId: local.companyId,
        );
      }
    }
    return bootstrapForUid(uid);
  }

  /// Looks [uid]'s company up in the cloud and installs it, or creates
  /// a first company for the account when the cloud genuinely has
  /// none. Never guesses on a failed lookup.
  static Future<TenantBootstrapResult> bootstrapForUid(String uid) async {
    final lookup = await CompanyFirestoreSyncService.instance.lookup(uid: uid);

    switch (lookup.status) {
      case CloudCompanyStatus.failed:
        return TenantBootstrapResult(
          outcome: TenantBootstrapOutcome.failed,
          error: lookup.error ?? 'Could not reach the cloud.',
        );

      case CloudCompanyStatus.notFound:
        final created = await CompanyController.instance.replaceCompany(
          const CompanyModel(companyName: ''),
        );
        await _setOwnerUid(uid);
        return TenantBootstrapResult(
          outcome: TenantBootstrapOutcome.createdNew,
          companyId: created.companyId,
        );

      case CloudCompanyStatus.found:
        final cloud = lookup.company!;
        // The cloud copy keeps its own company id: that is the id every
        // backed-up row is stamped with, and the id the subscription
        // and its free-copy counters are keyed by.
        final installed = await CompanyController.instance.replaceCompany(cloud);
        await _setOwnerUid(uid);

        final restore = await DocumentCloudSyncService.instance
            .restoreFromCloud(uid: uid, companyId: installed.companyId);
        if (!restore.succeeded) {
          debugPrint('Document restore incomplete: ${restore.error}');
        }
        return TenantBootstrapResult(
          outcome: TenantBootstrapOutcome.restoredFromCloud,
          companyId: installed.companyId,
          restoredRows: restore.restored,
          error: restore.error,
        );
    }
  }

  /// Before a deliberate sign-out: push whatever has not been backed
  /// up yet, so the account's latest work is in the cloud for its next
  /// sign-in (on this phone or another). Best-effort and bounded - a
  /// sign-out is never blocked by a dead network.
  static Future<CloudSyncResult> beforeSignOut() async {
    try {
      return await DocumentCloudSyncService.instance
          .syncNow()
          .timeout(const Duration(seconds: 30));
    } catch (error) {
      return CloudSyncResult(error: error.toString());
    }
  }

  /// The tenant is the account's: when the account goes, so does the
  /// active tenant. The rows stay on disk under their company id.
  static void clearActiveTenant() {
    TenantScope.clear();
  }

  static Future<String?> _ownerUid() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getString(ownerUidKey);
    } catch (_) {
      return null;
    }
  }

  static Future<void> _setOwnerUid(String uid) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(ownerUidKey, uid);
    } catch (error) {
      debugPrint('Could not record the company owner: $error');
    }
  }

  /// Whether any business row has been written under [companyId] -
  /// tells an untouched pre-login shell apart from a company somebody
  /// has actually used.
  static Future<bool> _hasAnyRows(String companyId) async {
    final db = await AppDatabase.instance.database;
    for (final table in DocumentCloudSyncService.syncedTables) {
      final rows = await db.query(
        table,
        columns: ['id'],
        where: 'company_id = ?',
        whereArgs: [companyId],
        limit: 1,
      );
      if (rows.isNotEmpty) return true;
    }
    return false;
  }

  /// The company could not be established for the signed-in account:
  /// drop the local session so the next thing the user sees is sign-in,
  /// after which the cloud is reachable and the lookup is retried.
  static Future<void> _requireFreshSignIn() async {
    debugPrint('Company could not be established; asking for a fresh sign-in.');
    AuthScope.clear();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(AuthSessionNotifier.authenticatedKey);
    } catch (_) {}
  }
}
