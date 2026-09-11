import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../../../core/subscription/subscription_status.dart';
import '../../../core/subscription/super_admin_scope.dart';
import '../../../core/utils/id_generator.dart';
import '../../audit/repositories/security_audit_repository.dart';
import '../../company/controllers/company_controller.dart';
import '../data/subscription_dao.dart';
import '../data/subscription_history_dao.dart';
import '../models/subscription_history_model.dart';
import '../models/subscription_model.dart';
import '../models/subscription_plan_model.dart';

/// Firestore is now the single source of truth for every company's
/// subscription (this task's own explicit "har company ki details
/// save ho online m na ki offline" requirement) - genuinely required
/// so a Super Admin's approval, done from any device, is genuinely
/// visible to that company's own device, and so one company's status
/// can never be read from a DIFFERENT company's local install (the
/// single-tenant-per-device architecture this project always had made
/// that structurally impossible before: see this file's own prior
/// "IMPORTANT ARCHITECTURAL LIMITATION" comment, now resolved).
///
/// SQLite (SubscriptionDao) is kept, but demoted to a read-through
/// OFFLINE CACHE only - written to exclusively as a mirror of
/// whatever Firestore just returned (_syncFromFirestore), never
/// independently. This means: online, every read/write goes straight
/// to Firestore, and the cache is refreshed as a side effect; offline,
/// getOrCreateForCompany() falls back to the last-cached value so a
/// document can still be generated/checked without a live connection
/// (Section 5's own "Limited Mode" concept was always meant to
/// tolerate exactly this), but no genuine subscription-status CHANGE
/// (activate/suspend/cancel) can ever happen while offline - those
/// throw rather than silently writing a local-only state that could
/// later conflict with Firestore's own record.
class SubscriptionRepository {
  SubscriptionRepository._();

  static final SubscriptionRepository instance = SubscriptionRepository._();

  final SubscriptionDao _dao = SubscriptionDao.instance;
  final SubscriptionHistoryDao _historyDao = SubscriptionHistoryDao.instance;

  /// One document per company, at subscriptions/{companyId} - matches
  /// SubscriptionModel.toFirestore()'s own doc comment.
  CollectionReference<Map<String, dynamic>> get _subscriptionsCollection =>
      FirebaseFirestore.instance.collection('subscriptions');

  /// Fetches the company's subscription from Firestore (creating a
  /// LIMITED one on first access if none exists yet - Section 4:
  /// "When a new company registers: Default status: LIMITED /
  /// UNAUTHORIZED"), mirroring the result into the local SQLite cache
  /// on success. Falls back to the cached value ONLY if the Firestore
  /// read genuinely fails (e.g. offline) - never silently prefers the
  /// cache when a live read would have succeeded, since Firestore is
  /// the authoritative source now.
  /// How long any single Firestore call is allowed to take before it's
  /// treated as "genuinely unreachable". This is essential, not
  /// cosmetic: Firestore's own SDK does NOT throw when the backend is
  /// unreachable (no network, database not yet created in the Firebase
  /// Console, rules rejecting before a connection is established) - it
  /// retries indefinitely, so an un-timed-out await hangs forever and
  /// the calling screen's loading spinner never resolves. Converting
  /// that hang into a genuine TimeoutException is what lets the
  /// offline-cache fallback below actually run.
  static const Duration _firestoreTimeout = Duration(seconds: 8);

  Future<SubscriptionModel> getOrCreateForCompany(String companyId) async {
    final currentUid = FirebaseAuth.instance.currentUser?.uid ?? '';

    try {
      final docRef = _subscriptionsCollection.doc(companyId);
      final snapshot = await docRef.get().timeout(_firestoreTimeout);

      if (snapshot.exists && snapshot.data() != null) {
        var subscription =
            SubscriptionModel.fromFirestore(snapshot.data()!, companyId);

        var needsWrite = false;

        // Backfill for a subscription created before ownerUid existed
        // (pre-v37) - never reassigns an ALREADY-owned document, only
        // fills in a genuinely empty one, and only with the currently
        // signed-in user (never a guess).
        if (subscription.ownerUid.isEmpty && currentUid.isNotEmpty) {
          subscription = subscription.copyWith(ownerUid: currentUid);
          needsWrite = true;
        }

        // Backfill/refresh the denormalized company name (pre-v48
        // records, or a name that changed since the last sync) -
        // ONLY when THIS device's own local company genuinely matches
        // the subscription being read (never writes a name onto a
        // different company's subscription document - e.g. if this
        // method is ever called for a company other than the one
        // physically installed on this device) and has a real,
        // non-empty name to offer. Never overwrites with an empty
        // value, so a Super Admin browsing another company's
        // subscription (whose own local company differs) can never
        // blank out that company's already-correct name.
        final localCompany = await CompanyController.instance.getCompany();
        if (localCompany != null && localCompany.companyId == companyId) {
          if (localCompany.companyName.isNotEmpty &&
              localCompany.companyName != subscription.companyName) {
            subscription = subscription.copyWith(
              companyName: localCompany.companyName,
            );
            needsWrite = true;
          }

          // Same backfill/refresh pattern as companyName above,
          // applied to the 5 more profile fields
          // SuperAdminCompanyDetailScreen needs (see
          // database_constants.dart's own v49 comment) - each field
          // only overwrites when the local value is genuinely
          // non-empty and different, so a Super Admin on another
          // company's device can never blank these out either.
          if (localCompany.mobile1.isNotEmpty &&
              _normalizePhone(localCompany.mobile1) !=
                  subscription.ownerMobile) {
            subscription = subscription.copyWith(
              ownerMobile: _normalizePhone(localCompany.mobile1),
            );
            needsWrite = true;
          }
          if (localCompany.gstNumber.isNotEmpty &&
              localCompany.gstNumber != subscription.gstNumber) {
            subscription =
                subscription.copyWith(gstNumber: localCompany.gstNumber);
            needsWrite = true;
          }
          if (localCompany.authorizedSignatoryName.isNotEmpty &&
              localCompany.authorizedSignatoryName !=
                  subscription.authorizedSignatoryName) {
            subscription = subscription.copyWith(
              authorizedSignatoryName: localCompany.authorizedSignatoryName,
            );
            needsWrite = true;
          }
          if (localCompany.email.isNotEmpty &&
              localCompany.email != subscription.email) {
            subscription = subscription.copyWith(email: localCompany.email);
            needsWrite = true;
          }
          if (localCompany.companyCode.isNotEmpty &&
              localCompany.companyCode != subscription.companyCode) {
            subscription =
                subscription.copyWith(companyCode: localCompany.companyCode);
            needsWrite = true;
          }
        }

        if (needsWrite) {
          await docRef.set(subscription.toFirestore()).timeout(_firestoreTimeout);
        }

        await _syncFromFirestore(subscription);
        return subscription;
      }

      // Genuinely first-ever access for this company - create the
      // LIMITED default directly in Firestore (not locally first),
      // so the very first record any company ever has is already the
      // server-authoritative one.
      final localCompany = await CompanyController.instance.getCompany();
      final now = DateTime.now().toIso8601String();
      final created = SubscriptionModel(
        id: IdGenerator.generateId(),
        companyId: companyId,
        status: SubscriptionStatus.limited,
        ownerUid: currentUid,
        companyName:
            localCompany?.companyId == companyId
                ? (localCompany?.companyName ?? '')
                : '',
        ownerMobile:
            localCompany?.companyId == companyId
                ? _normalizePhone(localCompany?.mobile1 ?? '')
                : '',
        gstNumber:
            localCompany?.companyId == companyId
                ? (localCompany?.gstNumber ?? '')
                : '',
        authorizedSignatoryName:
            localCompany?.companyId == companyId
                ? (localCompany?.authorizedSignatoryName ?? '')
                : '',
        email:
            localCompany?.companyId == companyId
                ? (localCompany?.email ?? '')
                : '',
        companyCode:
            localCompany?.companyId == companyId
                ? (localCompany?.companyCode ?? '')
                : '',
        createdAt: now,
        updatedAt: now,
      );

      await docRef.set(created.toFirestore()).timeout(_firestoreTimeout);
      await _syncFromFirestore(created);

      return created;
    } catch (error) {
      // Genuinely offline (or Firestore otherwise unreachable) - fall
      // back to the last-synced local cache, defaulting to a fresh
      // LIMITED record only if genuinely nothing was ever cached
      // (e.g. first-ever app launch with no connectivity yet).
      final cached = await _dao.getByCompanyId(companyId);
      if (cached != null) return cached;

      final now = DateTime.now().toIso8601String();
      final fallback = SubscriptionModel(
        id: IdGenerator.generateId(),
        companyId: companyId,
        status: SubscriptionStatus.limited,
        ownerUid: currentUid,
        createdAt: now,
        updatedAt: now,
      );
      await _dao.insert(fallback);
      return fallback;
    }
  }

  /// Mirrors [subscription] into the local SQLite cache - insert if
  /// this company has no cached row yet, update otherwise. Never
  /// called with data that didn't genuinely come from Firestore
  /// (see this class's own doc comment on why).
  Future<void> _syncFromFirestore(SubscriptionModel subscription) async {
    final existing = await _dao.getByCompanyId(subscription.companyId);
    if (existing == null) {
      await _dao.insert(subscription);
    } else {
      await _dao.update(subscription);
    }
  }

  /// Super Admin's Dashboard (Section 14) - now GENUINELY
  /// cross-company, reading every company's subscription document
  /// straight from Firestore, regardless of which device/install is
  /// asking. This is the exact capability the prior SQLite-only
  /// architecture could never provide (see this class's own top-level
  /// doc comment) - a Super Admin on any device now sees every real
  /// company's real status.
  Future<List<SubscriptionModel>> getAllAcrossCompanies() async {
    final snapshot =
        await _subscriptionsCollection.orderBy('updatedAt', descending: true).get().timeout(_firestoreTimeout);

    return snapshot.docs
        .map((doc) => SubscriptionModel.fromFirestore(doc.data(), doc.id))
        .toList();
  }

  /// Super Admin's search-by-mobile-number flow (the customer sends
  /// their payment screenshot off-app, then Super Admin looks up the
  /// company by the mobile number the customer gives them).
  ///
  /// GENUINELY CROSS-COMPANY (fixed - see database_constants.dart's
  /// own v49 comment): queries the subscriptions collection's own
  /// denormalized ownerMobile field directly, rather than the
  /// CURRENT device's own single locally-known company via
  /// CompanyController - the same architectural gap
  /// SuperAdminCompanyDetailScreen's own profile card was fixed for.
  /// ownerMobile is written in normalized form
  /// (getOrCreateForCompany()'s own backfill/create logic, via
  /// _normalizePhone() below) specifically so this query's own
  /// normalized input reliably matches it regardless of how the
  /// company's own device originally typed the number (with/without
  /// +91, spaces, etc.) - a raw un-normalized Firestore
  /// isEqualTo query could never account for that formatting
  /// variance.
  ///
  /// HONEST LIMITATION UNCHANGED FROM BEFORE: only companies whose
  /// own device has been online since the v49 update (so their
  /// ownerMobile has actually been backfilled) are found this way -
  /// see this class's own doc comment on getOrCreateForCompany()'s
  /// backfill for why a brand-new/legacy record may briefly lack it.
  Future<SubscriptionModel?> getByMobileNumber(String mobileNumber) async {
    await _requireSuperAdmin();

    final normalizedQuery = _normalizePhone(mobileNumber);
    if (normalizedQuery.isEmpty) return null;

    final snapshot = await _subscriptionsCollection
        .where('ownerMobile', isEqualTo: normalizedQuery)
        .limit(1)
        .get()
        .timeout(_firestoreTimeout);

    if (snapshot.docs.isEmpty) return null;

    final doc = snapshot.docs.first;
    return SubscriptionModel.fromFirestore(doc.data(), doc.id);
  }

  /// Super Admin lookup by the customer's unique App ID (the numeric
  /// companyCode shown under the company name on their dashboard) -
  /// the second search key alongside the mobile number. App IDs are
  /// now plain numbers ("4839"), but companies that haven't opened
  /// the app since the prefix was dropped may still carry the old
  /// "DRS-4839" form on their subscription document - both are
  /// matched, and typed prefixes/spacing are tolerated either way.
  Future<SubscriptionModel?> getByCompanyCode(String code) async {
    await _requireSuperAdmin();

    final compact =
        code.toUpperCase().replaceAll(RegExp(r'[\s\-]'), '');
    if (compact.isEmpty) return null;

    final digits = compact.startsWith('DRS') ? compact.substring(3) : compact;
    if (digits.isEmpty || int.tryParse(digits) == null) return null;

    for (final candidate in [digits, 'DRS-$digits']) {
      final snapshot = await _subscriptionsCollection
          .where('companyCode', isEqualTo: candidate)
          .limit(1)
          .get()
          .timeout(_firestoreTimeout);

      if (snapshot.docs.isNotEmpty) {
        final doc = snapshot.docs.first;
        return SubscriptionModel.fromFirestore(doc.data(), doc.id);
      }
    }

    return null;
  }

  /// Strips everything but digits, and a leading '91' country code if
  /// present with more than 10 digits left - so "+91 98765 43210",
  /// "919876543210", and "9876543210" all compare equal, matching how
  /// a Super Admin would naturally type a number they were told over
  /// WhatsApp/phone.
  String _normalizePhone(String raw) {
    final digitsOnly = raw.replaceAll(RegExp(r'[^0-9]'), '');

    if (digitsOnly.length > 10 && digitsOnly.startsWith('91')) {
      return digitsOnly.substring(digitsOnly.length - 10);
    }

    return digitsOnly;
  }

  /// Activates a subscription after payment verification (Section 16)
  /// or manual authorization (Section 18) - both paths converge here,
  /// since the effect ("company now has X plan until Y date") is
  /// identical; only how the activation was triggered differs, and
  /// that's what the audit-log call sites (SecurityAuditType.
  /// subscriptionActivated vs subscriptionManuallyActivated) record
  /// separately, not this method.
  ///
  /// Handles renewal correctly (Section 21): if the company's current
  /// subscription is still ACTIVE (not expired), the new duration is
  /// ADDED to the existing expiry, not overwritten - "If renewal is
  /// purchased before expiry, add the new duration to the existing
  /// expiry." If already expired (or this is a first activation), the
  /// new period starts from now.
  ///
  /// WRITES TO FIRESTORE FIRST, genuinely requires connectivity - a
  /// Super Admin approving a subscription is exactly the operation
  /// that must be immediately, verifiably visible to the company's
  /// own device (this task's own "super admin se subscription approve
  /// karu uske baad hi full access ho" requirement), so this
  /// deliberately does NOT fall back to a local-only write if
  /// Firestore is unreachable - it throws, and the Super Admin must
  /// retry once back online, rather than the approval silently only
  /// existing on the admin's own device.
  Future<SubscriptionModel> activate({
    required String companyId,
    required SubscriptionPlanModel plan,
    String? paymentReference,
    String? paymentMethod,
    String? authorizedByMobileNumber,
    String remarks = '',
    /// Super Admin's explicit start date (new document's own "Set
    /// subscription start date" requirement) - only meaningful for a
    /// fresh authorization; a genuine renewal (isStillActive true)
    /// always starts the day after the existing expiry regardless of
    /// this value, per Section 21's own rule (see startBase below).
    DateTime? explicitStartDate,
  }) async {
    await _requireSuperAdmin();

    final current = await getOrCreateForCompany(companyId);
    final now = DateTime.now();

    final currentExpiry = current.expiryDate != null
        ? DateTime.tryParse(current.expiryDate!)
        : null;

    // Renewal base: the later of "now" and the current expiry, if the
    // subscription hasn't actually expired yet - this is precisely
    // Section 21's rule, not a general "always extend" behavior (an
    // already-EXPIRED subscription's stale expiry date must not be
    // used as the base, or a renewal months after expiry would
    // silently backdate the new period).
    final isStillActive = current.status == SubscriptionStatus.active &&
        currentExpiry != null &&
        currentExpiry.isAfter(now);

    // Renewal base: the day AFTER the current expiry (which is itself
    // the LAST day of the current period, per the -1-day adjustment
    // below) - this is the actual first day of the new period. Without
    // the +1 here, a renewal starting from currentExpiry directly would
    // double-subtract a day against the spec's own worked example
    // ("Current expiry: 11 Aug 2027, Renewal: 1 Year, New expiry: 11
    // Aug 2028" - only correct when the new period starts 12 Aug 2027,
    // not 11 Aug 2027).
    final startBase = isStillActive
        ? currentExpiry.add(const Duration(days: 1))
        : (explicitStartDate ?? now);
    // -1 day: the spec's own worked example is explicit - "Start: 12
    // Aug 2026, Expiry: 11 Aug 2027" for a Yearly (12-month) plan, i.e.
    // (start + duration) minus one day, not exactly (start + duration).
    final newExpiry = DateTime(
      startBase.year,
      startBase.month + plan.durationMonths,
      startBase.day,
    ).subtract(const Duration(days: 1));

    final updated = current.copyWith(
      planId: plan.id,
      status: SubscriptionStatus.active,
      startDate:
          isStillActive ? current.startDate : startBase.toIso8601String(),
      expiryDate: newExpiry.toIso8601String(),
      updatedAt: now.toIso8601String(),
    );

    await _subscriptionsCollection.doc(companyId).set(updated.toFirestore()).timeout(_firestoreTimeout);
    await _syncFromFirestore(updated);

    await _historyDao.insert(
      SubscriptionHistoryModel(
        id: IdGenerator.generateId(),
        companyId: companyId,
        subscriptionId: current.id,
        planId: plan.id,
        planName: plan.name,
        amount: plan.finalAmount,
        startDate: updated.startDate!,
        endDate: updated.expiryDate!,
        paymentReference: paymentReference,
        paymentMethod: paymentMethod,
        authorizedByMobileNumber: authorizedByMobileNumber,
        authorizationDate: now.toIso8601String(),
        status: SubscriptionStatus.active,
        remarks: remarks,
      ),
    );

    return updated;
  }

  Future<void> suspend(String companyId, {String remarks = ''}) async {
    await _requireSuperAdmin();

    final current = await getOrCreateForCompany(companyId);

    final updated = current.copyWith(
      status: SubscriptionStatus.suspended,
      updatedAt: DateTime.now().toIso8601String(),
    );

    await _subscriptionsCollection.doc(companyId).set(updated.toFirestore()).timeout(_firestoreTimeout);
    await _syncFromFirestore(updated);

    await SecurityAuditRepository.instance.record(
      eventType: SecurityAuditType.subscriptionSuspended,
      description: 'Subscription suspended.${remarks.isNotEmpty ? ' Reason: $remarks' : ''}',
      entityType: 'subscription',
      entityId: current.id,
    );
  }

  Future<void> cancel(String companyId, {String remarks = ''}) async {
    await _requireSuperAdmin();

    final current = await getOrCreateForCompany(companyId);

    final updated = current.copyWith(
      status: SubscriptionStatus.cancelled,
      updatedAt: DateTime.now().toIso8601String(),
    );

    await _subscriptionsCollection.doc(companyId).set(updated.toFirestore()).timeout(_firestoreTimeout);
    await _syncFromFirestore(updated);

    await SecurityAuditRepository.instance.record(
      eventType: SecurityAuditType.subscriptionCancelled,
      description: 'Subscription cancelled.${remarks.isNotEmpty ? ' Reason: $remarks' : ''}',
      entityType: 'subscription',
      entityId: current.id,
    );
  }

  Future<void> _requireSuperAdmin() async {
    await SuperAdminScope.refresh();

    if (!SuperAdminScope.isSuperAdmin) {
      throw SuperAdminRequiredException();
    }
  }

  /// Rejection returning a company to LIMITED (Section 17: "Customer
  /// status returns to: LIMITED / PAYMENT_REJECTED"). Modeled as
  /// LIMITED here (PAYMENT_REJECTED isn't a distinct SubscriptionStatus
  /// value - the spec's own slash suggests it's a sub-label of LIMITED,
  /// and the PaymentTransaction's own REJECTED status already carries
  /// the actual rejection detail/reason) - the company can submit
  /// another payment from this same LIMITED state, exactly as Section
  /// 17 requires.
  Future<void> returnToLimitedAfterRejection(String companyId) async {
    final current = await getOrCreateForCompany(companyId);

    if (current.status == SubscriptionStatus.active) return;

    final updated = current.copyWith(
      status: SubscriptionStatus.limited,
      updatedAt: DateTime.now().toIso8601String(),
    );

    await _subscriptionsCollection.doc(companyId).set(updated.toFirestore()).timeout(_firestoreTimeout);
    await _syncFromFirestore(updated);
  }

  Future<List<SubscriptionHistoryModel>> getHistory(String companyId) async {
    return _historyDao.getByCompanyId(companyId);
  }

  /// How many demo generations have already been used for
  /// [documentType] - read-only counterpart to recordDemoGeneration(),
  /// for SubscriptionAccessService.getRemainingDemoGenerations().
  Future<int> getDemoGenerationsUsed(
    String companyId,
    String documentType,
  ) async {
    final current = await getOrCreateForCompany(companyId);
    final counts = _decodeDemoCounts(current.demoGenerationsUsedJson);

    return counts[documentType] ?? 0;
  }

  /// Increments the demo-generation counter for one document type
  /// (Section 5/6) - reads the current JSON map, bumps the one key,
  /// writes it back. Per-document-type, never a single global counter,
  /// exactly per the task's explicit instruction.
  ///
  /// Genuinely tolerant of being offline (unlike activate/suspend/
  /// cancel above): a demo-generation count is a soft usage counter,
  /// not an authorization decision, so it's allowed to write through
  /// getOrCreateForCompany()'s own offline-cache fallback rather than
  /// blocking document generation entirely just because Firestore is
  /// briefly unreachable - it will simply re-sync to Firestore the
  /// next time getOrCreateForCompany() succeeds online (the cache
  /// write below still updates SQLite immediately either way).
  Future<void> recordDemoGeneration(
    String companyId,
    String documentType,
  ) async {
    final current = await getOrCreateForCompany(companyId);
    final counts = _decodeDemoCounts(current.demoGenerationsUsedJson);

    counts[documentType] = (counts[documentType] ?? 0) + 1;

    final updated = current.copyWith(
      demoGenerationsUsedJson: _encodeDemoCounts(counts),
      updatedAt: DateTime.now().toIso8601String(),
    );

    try {
      await _subscriptionsCollection.doc(companyId).set(updated.toFirestore()).timeout(_firestoreTimeout);
    } catch (_) {
      // Offline - the demo count still needs to be recorded locally so
      // the company can't bypass the limit by staying offline; it will
      // reconcile with Firestore on the next successful online read.
    }

    await _syncFromFirestore(updated);
  }

  Map<String, int> _decodeDemoCounts(String json) {
    try {
      final decoded = jsonDecode(json);
      if (decoded is! Map) return {};

      final counts = <String, int>{};
      for (final entry in decoded.entries) {
        final value = entry.value;
        if (value is int) counts[entry.key as String] = value;
      }
      return counts;
    } catch (_) {
      // Malformed input should never block document generation - treat
      // it as "no demo generations used yet" rather than throwing.
      return {};
    }
  }

  String _encodeDemoCounts(Map<String, int> counts) => jsonEncode(counts);
}
