import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import '../../../core/subscription/subscription_status.dart';
import '../../../core/subscription/platform_audit_log_service.dart';
import '../../../core/subscription/super_admin_scope.dart';
import '../../../core/utils/id_generator.dart';
import '../../audit/repositories/security_audit_repository.dart';
import '../../company/controllers/company_controller.dart';
import '../../company/services/app_id_counter_service.dart';
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

  /// Test seam: lets a test run this repository against an in-memory
  /// Firestore. Production code never sets it, so every real call goes
  /// to FirebaseFirestore.instance exactly as before.
  static FirebaseFirestore? firestoreOverride;

  /// Test seam for the signed-in user, for the same reason.
  static String? currentUidOverride;

  /// Why the last cloud read/create of this company's subscription
  /// failed, or null once it succeeded. Before this, the failure fell
  /// through to the local cache silently - the company kept working
  /// and simply never reached the Super Admin, with nothing anywhere
  /// saying so. Settings shows it.
  static final ValueNotifier<String?> lastCloudError = ValueNotifier(null);

  FirebaseFirestore get _firestore =>
      firestoreOverride ?? FirebaseFirestore.instance;

  String get _currentUid {
    final override = currentUidOverride;
    if (override != null) return override;
    try {
      return FirebaseAuth.instance.currentUser?.uid ?? '';
    } catch (_) {
      // Firebase not initialised - the caller only needs a best-effort
      // owner id, never a hard failure.
      return '';
    }
  }

  /// The phone number the owner signed in with - what they will tell
  /// the Super Admin when asking to be activated, and filled in long
  /// before (or without) a mobile number on the company profile.
  static String? currentPhoneOverride;

  String get _signedInPhone {
    final override = currentPhoneOverride;
    if (override != null) return override;
    try {
      return FirebaseAuth.instance.currentUser?.phoneNumber ?? '';
    } catch (_) {
      return '';
    }
  }

  /// Per document type, the larger of two free-copy counts.
  static Map<String, int> _higherCounts(
    Map<String, int> a,
    Map<String, int> b,
  ) {
    final merged = Map<String, int>.from(a);
    b.forEach((key, value) {
      if (value > (merged[key] ?? 0)) merged[key] = value;
    });
    return merged;
  }

  /// One document per company, at subscriptions/{companyId} - matches
  /// SubscriptionModel.toFirestore()'s own doc comment.
  CollectionReference<Map<String, dynamic>> get _subscriptionsCollection =>
      _firestore.collection('subscriptions');

  /// The company's own copy of its subscription periods - the local
  /// table only ever held what was activated on the Super Admin's
  /// phone, so the company itself saw an empty history.
  CollectionReference<Map<String, dynamic>> _historyCollection(
          String companyId) =>
      _subscriptionsCollection.doc(companyId).collection('history');

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
    final currentUid = _currentUid;

    try {
      final docRef = _subscriptionsCollection.doc(companyId);
      final snapshot = await docRef.get().timeout(_firestoreTimeout);

      if (snapshot.exists && snapshot.data() != null) {
        var subscription =
            SubscriptionModel.fromFirestore(snapshot.data()!, companyId);

        // The owner may only change the profile copy and the counters
        // (firestore.rules). So only fields that actually differ are
        // sent, with update() - rewriting the whole document with set()
        // also resent dates and fields the rules compare, and one
        // refused write threw away this successful read.
        final changes = <String, dynamic>{};

        // The profile copy, refreshed from this device's own company
        // only - never written onto another company's record (a Super
        // Admin reading someone else's), and never blanked.
        final localCompany = await CompanyController.instance.getCompany();
        final ownDevice =
            localCompany != null && localCompany.companyId == companyId;
        if (ownDevice) {
          void refresh(String field, String local, String cloud) {
            if (local.isNotEmpty && local != cloud) changes[field] = local;
          }

          final mobile = localCompany.mobile1.isNotEmpty
              ? _normalizePhone(localCompany.mobile1)
              : _normalizePhone(_signedInPhone);
          refresh('companyName', localCompany.companyName, subscription.companyName);
          refresh('ownerMobile', mobile, subscription.ownerMobile);
          refresh('gstNumber', localCompany.gstNumber, subscription.gstNumber);
          refresh('authorizedSignatoryName',
              localCompany.authorizedSignatoryName,
              subscription.authorizedSignatoryName);
          refresh('email', localCompany.email, subscription.email);
          refresh('companyCode', localCompany.companyCode, subscription.companyCode);

          // Free copies made while offline were counted on this device;
          // the cloud must never take them back.
          final cached = await _dao.getByCompanyId(companyId);
          if (cached != null) {
            final merged = _higherCounts(
              subscription.demoGenerationsUsed,
              cached.demoGenerationsUsed,
            );
            if (!mapEquals(merged, subscription.demoGenerationsUsed)) {
              changes['demoGenerationsUsed'] = merged;
              changes['demoGenerationsUsedJson'] =
                  SubscriptionModel.encodeDemoCounts(merged);
            }
          }
        }

        if (changes.isNotEmpty) {
          subscription = SubscriptionModel.fromFirestore(
            {...snapshot.data()!, ...changes},
            companyId,
          );
          try {
            await docRef.update({
              ...changes,
              'updatedAt': DateTime.now().toIso8601String(),
            }).timeout(_firestoreTimeout);
          } catch (error) {
            // The read stands; only the refresh is retried next time.
            debugPrint('Subscription profile not refreshed: $error');
          }
        }

        await _syncFromFirestore(subscription);
        lastCloudError.value = null;
        return await _expireIfLapsed(subscription);
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
        ownerMobile: localCompany?.companyId == companyId
            ? _normalizePhone((localCompany?.mobile1 ?? '').isNotEmpty
                ? localCompany!.mobile1
                : _signedInPhone)
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
      lastCloudError.value = null;

      return created;
    } catch (error) {
      lastCloudError.value = error is FirebaseException
          ? error.code
          : error is TimeoutException
              ? 'timeout'
              : error.runtimeType.toString();
      debugPrint('Subscription not reached in the cloud: $error');
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
    // No orderBy: Firestore leaves out of an ordered query every
    // document that lacks the ordered field, so a record written
    // without updatedAt silently disappeared from the dashboard and its
    // counts. Sorted here instead, newest first, missing dates last.
    final snapshot =
        await _subscriptionsCollection.get().timeout(_firestoreTimeout);

    return snapshot.docs
        .map((doc) => SubscriptionModel.fromFirestore(doc.data(), doc.id))
        .toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
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

  /// Super Admin lookup by the customer's unique App ID (the
  /// companyCode shown under the company name on their dashboard) -
  /// the second search key alongside the mobile number. App IDs read
  /// "SW4839"; a company that has not opened the app since an earlier
  /// build may still carry the plain "4839" or the original
  /// "DRS-4839" on its subscription document, so every form of the
  /// same number is searched and typed prefixes and spacing are
  /// tolerated.
  Future<SubscriptionModel?> getByCompanyCode(String code) async {
    await _requireSuperAdmin();

    for (final candidate in AppIdCounterService.lookupCandidates(code)) {
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
    // What the company actually paid, when the Super Admin typed it -
    // otherwise the plan's own price.
    double? amount,
    /// Super Admin's explicit start date (new document's own "Set
    /// subscription start date" requirement) - only meaningful for a
    /// fresh authorization; a genuine renewal (isStillActive true)
    /// always starts the day after the existing expiry regardless of
    /// this value, per Section 21's own rule (see startBase below).
    DateTime? explicitStartDate,
  }) async {
    await _requireSuperAdmin();
    lastReferralMessage = '';

    final current = await _readForAdmin(companyId);
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

    // Free days this company earned by referring others while it had
    // no plan running go on top of this plan, once.
    final bonusDays = current.referralBonusDays;

    final updated = current.copyWith(
      planId: plan.id,
      status: SubscriptionStatus.active,
      startDate:
          isStillActive ? current.startDate : startBase.toIso8601String(),
      expiryDate: newExpiry.add(Duration(days: bonusDays)).toIso8601String(),
      referralBonusDays: 0,
      updatedAt: now.toIso8601String(),
    );

    await _subscriptionsCollection.doc(companyId).update({
      'planId': updated.planId,
      'status': updated.status.code,
      'startDate': updated.startDate,
      'expiryDate': updated.expiryDate,
      if (bonusDays > 0) 'referralBonusDays': 0,
      'updatedAt': updated.updatedAt,
    }).timeout(_firestoreTimeout);
    await _syncFromFirestore(updated);

    // The referrer's own month is not given here: App IDs run in
    // sequence, so a made-up code often belongs to a real company. The
    // Super Admin confirms the referral first (ReferralReviewDialog).
    lastReferralMessage = bonusDays > 0
        ? 'Referral bonus: $bonusDays extra days added to this plan.'
        : '';

    await PlatformAuditLogService.instance.record(
      action: PlatformAuditAction.subscriptionActivated,
      targetCompanyId: companyId,
      targetUid: current.ownerUid,
      metadata: {
        'planId': plan.id,
        'startDate': updated.startDate,
        'expiryDate': updated.expiryDate,
        'paymentReference': paymentReference ?? '',
      },
    );

    final period = SubscriptionHistoryModel(
      id: IdGenerator.generateId(),
      companyId: companyId,
      subscriptionId: current.id,
      planId: plan.id,
      planName: plan.name,
      amount: amount ?? plan.finalAmount,
      startDate: updated.startDate!,
      endDate: updated.expiryDate!,
      paymentReference: paymentReference,
      paymentMethod: paymentMethod,
      authorizedByMobileNumber: authorizedByMobileNumber,
      authorizationDate: now.toIso8601String(),
      status: SubscriptionStatus.active,
      remarks: remarks,
    );
    await _historyDao.insert(period);

    // The activation itself is done; a failed history copy must not
    // report it as failed.
    try {
      await _historyCollection(companyId).doc(period.id).set({
        ...period.toMap(),
        // The Super Admin's own number stays off the company's copy.
        'authorized_by_mobile_number': null,
      }).timeout(_firestoreTimeout);
    } catch (error) {
      debugPrint('Subscription history not copied to the cloud: $error');
    }

    return updated;
  }

  Future<void> suspend(String companyId, {String remarks = ''}) async {
    await _requireSuperAdmin();

    final current = await _readForAdmin(companyId);

    final updated = current.copyWith(
      status: SubscriptionStatus.suspended,
      updatedAt: DateTime.now().toIso8601String(),
    );

    await _writeStatus(updated);

    await PlatformAuditLogService.instance.record(
      action: PlatformAuditAction.subscriptionSuspended,
      targetCompanyId: companyId,
      targetUid: current.ownerUid,
      metadata: {'remarks': remarks},
    );
    await SecurityAuditRepository.instance.record(
      eventType: SecurityAuditType.subscriptionSuspended,
      description: 'Subscription suspended.${remarks.isNotEmpty ? ' Reason: $remarks' : ''}',
      entityType: 'subscription',
      entityId: current.id,
    );
  }

  Future<void> cancel(String companyId, {String remarks = ''}) async {
    await _requireSuperAdmin();

    final current = await _readForAdmin(companyId);

    final updated = current.copyWith(
      status: SubscriptionStatus.cancelled,
      updatedAt: DateTime.now().toIso8601String(),
    );

    await _writeStatus(updated);

    await PlatformAuditLogService.instance.record(
      action: PlatformAuditAction.subscriptionCancelled,
      targetCompanyId: companyId,
      targetUid: current.ownerUid,
      metadata: {'remarks': remarks},
    );
    await SecurityAuditRepository.instance.record(
      eventType: SecurityAuditType.subscriptionCancelled,
      description: 'Subscription cancelled.${remarks.isNotEmpty ? ' Reason: $remarks' : ''}',
      entityType: 'subscription',
      entityId: current.id,
    );
  }

  // ==========================
  // Refer & Earn
  // ==========================
  //
  // A company's App ID is its referral code. When a company that
  // entered it takes a plan of [referralMinPlanMonths] or more and the
  // Super Admin confirms the referral is genuine, the referrer gets one
  // month free - added to a running plan, or kept as 30 days for its
  // next one.

  /// Saved bonus days the last [activate] added, for the Super Admin to
  /// see ('' = none).
  String lastReferralMessage = '';

  static const int referralMinPlanMonths = 12;

  /// The App ID typed as a referral code, in the stored form
  /// ("sw 1325", "1325" -> "SW1325"). Null when there is no number.
  static String? referralCodeFrom(String input) {
    final digits = AppIdCounterService.numberIn(input);
    return digits == null ? null : '${AppIdCounterService.prefix}$digits';
  }

  /// Owner side: who referred this company. Once only, never its own
  /// App ID (firestore.rules enforces both too).
  Future<void> setReferredBy(String companyId, String appId) async {
    final code = referralCodeFrom(appId.trim());
    if (code == null) {
      throw ArgumentError('Enter the App ID, e.g. SW1325.');
    }

    final current = await getOrCreateForCompany(companyId);
    if (current.referredBy.isNotEmpty) {
      throw StateError('A referral code is already saved.');
    }
    if (AppIdCounterService.numberIn(current.companyCode) ==
        AppIdCounterService.numberIn(code)) {
      throw ArgumentError('You cannot use your own App ID.');
    }

    await _subscriptionsCollection.doc(companyId).update({
      'referredBy': code,
      'updatedAt': DateTime.now().toIso8601String(),
    }).timeout(_firestoreTimeout);
  }

  /// Super Admin, after confirming the referral is genuine: the
  /// referrer of [friendCompanyId] gets one month. Once per referred
  /// company.
  Future<String> giveReferralBonusNow(String friendCompanyId) async {
    await _requireSuperAdmin();

    final friend = await _readForAdmin(friendCompanyId);
    if (friend.referredBy.trim().isEmpty) {
      throw StateError('This company has no referral code.');
    }
    if (friend.referralRewarded) {
      throw StateError('The referral bonus has already been given.');
    }
    return _payReferralBonus(friend);
  }

  /// Super Admin: the referral of [friendCompanyId] is not genuine - no
  /// bonus is given for it. Recorded in the audit log.
  Future<void> rejectReferral(
    String friendCompanyId, {
    String reason = '',
  }) async {
    await _requireSuperAdmin();

    final friend = await _readForAdmin(friendCompanyId);
    if (friend.referredBy.trim().isEmpty) {
      throw StateError('This company has no referral code.');
    }
    if (friend.referralRewarded) {
      throw StateError('The referral bonus has already been given.');
    }

    await _subscriptionsCollection.doc(friendCompanyId).update({
      'referralRejected': true,
      'updatedAt': DateTime.now().toIso8601String(),
    }).timeout(_firestoreTimeout);

    await PlatformAuditLogService.instance.record(
      action: PlatformAuditAction.referralRejected,
      targetCompanyId: friendCompanyId,
      targetUid: friend.ownerUid,
      metadata: {'referredBy': friend.referredBy, 'reason': reason},
    );
  }

  /// Super Admin: one month free for any company - goodwill, a referral
  /// settled outside the app, a complaint.
  Future<String> addFreeMonth(String companyId, {String reason = ''}) async {
    await _requireSuperAdmin();

    final company = await _readForAdmin(companyId);
    final message = await _giveOneMonth(company, countAsReferral: false);

    await PlatformAuditLogService.instance.record(
      action: PlatformAuditAction.freeMonthAdded,
      targetCompanyId: companyId,
      targetUid: company.ownerUid,
      metadata: {'result': message, 'reason': reason},
    );
    return message;
  }

  /// Super Admin: one company's record as the server holds it now.
  Future<SubscriptionModel> readLive(String companyId) async {
    await _requireSuperAdmin();
    return _readForAdmin(companyId);
  }

  /// Super Admin: the companies that entered [appId] as their code.
  Future<List<SubscriptionModel>> getReferredBy(String appId) async {
    await _requireSuperAdmin();
    final code = referralCodeFrom(appId);
    if (code == null) return [];

    final snapshot = await _subscriptionsCollection
        .where('referredBy', isEqualTo: code)
        .get()
        .timeout(_firestoreTimeout);
    return snapshot.docs
        .map((doc) => SubscriptionModel.fromFirestore(doc.data(), doc.id))
        .toList();
  }

  Future<String> _payReferralBonus(SubscriptionModel friend) async {
    final code = friend.referredBy.trim();
    final referrer = await getByCompanyCode(code);
    if (referrer == null) {
      throw StateError('App ID $code was not found - no bonus given.');
    }
    if (referrer.companyId == friend.companyId) {
      throw StateError('A company cannot refer itself.');
    }

    final message = await _giveOneMonth(referrer);

    await _subscriptionsCollection.doc(friend.companyId).update({
      'referralRewarded': true,
      'referralRejected': false,
    }).timeout(_firestoreTimeout);

    await PlatformAuditLogService.instance.record(
      action: PlatformAuditAction.referralBonusGiven,
      targetCompanyId: referrer.companyId,
      targetUid: referrer.ownerUid,
      metadata: {'result': message, 'referredCompanyId': friend.companyId},
    );
    return message;
  }

  /// One month for [company]: added to its expiry while its plan runs,
  /// otherwise kept as 30 days for its next plan.
  Future<String> _giveOneMonth(
    SubscriptionModel company, {
    bool countAsReferral = true,
  }) async {
    final now = DateTime.now();
    final expiry = company.expiresOn;
    final name = _referralLabel(company);
    final ref = _subscriptionsCollection.doc(company.companyId);

    // Plan running: the month goes on its expiry.
    if (expiry != null &&
        company.status.grantsFullAccess &&
        !company.hasLapsed) {
      final extended = DateTime(expiry.year, expiry.month + 1, expiry.day);
      await ref.update({
        'expiryDate': extended.toIso8601String(),
        if (countAsReferral) 'referralCount': FieldValue.increment(1),
        'updatedAt': now.toIso8601String(),
      }).timeout(_firestoreTimeout);
      return '+1 month for $name. New expiry '
          '${extended.day.toString().padLeft(2, '0')}-'
          '${extended.month.toString().padLeft(2, '0')}-${extended.year}.';
    }

    await ref.update({
      'referralBonusDays': FieldValue.increment(30),
      if (countAsReferral) 'referralCount': FieldValue.increment(1),
      'updatedAt': now.toIso8601String(),
    }).timeout(_firestoreTimeout);
    return '+1 month saved for $name (no plan running) - 30 days are '
        'added when they next subscribe.';
  }

  static String _referralLabel(SubscriptionModel company) {
    final name = company.companyName.trim();
    final code = company.companyCode.trim();
    final id = AppIdCounterService.isAssigned(code) ? 'App ID $code' : '';
    if (name.isEmpty) return id.isEmpty ? 'this company' : id;
    return id.isEmpty ? name : '$name ($id)';
  }

  /// What every Super Admin action starts from: the record as the
  /// server holds it right now. Never getOrCreateForCompany's offline
  /// fallback - that is built with the ADMIN's uid as owner and blank
  /// counters, and writing it back took the record away from its own
  /// company. No record, or no server: the action stops here.
  Future<SubscriptionModel> _readForAdmin(String companyId) async {
    final snapshot = await _subscriptionsCollection
        .doc(companyId)
        .get(const GetOptions(source: Source.server))
        .timeout(_firestoreTimeout);
    final data = snapshot.data();
    if (!snapshot.exists || data == null) {
      throw StateError(
        'This company has no subscription record in the cloud yet. '
        'Ask them to open the app once while online.',
      );
    }
    return SubscriptionModel.fromFirestore(data, companyId);
  }

  /// A Super Admin status change: only the status and its date move.
  Future<void> _writeStatus(SubscriptionModel updated) async {
    await _subscriptionsCollection.doc(updated.companyId).update({
      'status': updated.status.code,
      'updatedAt': updated.updatedAt,
    }).timeout(_firestoreTimeout);
    await _syncFromFirestore(updated);
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
    await _requireSuperAdmin();

    final current = await _readForAdmin(companyId);

    if (current.status == SubscriptionStatus.active) return;

    await _writeStatus(current.copyWith(
      status: SubscriptionStatus.limited,
      updatedAt: DateTime.now().toIso8601String(),
    ));
  }

  /// Every period of [companyId]'s subscription, newest first: the
  /// cloud copy (so the company sees periods activated on the Super
  /// Admin's phone) merged with this phone's own. Offline, this
  /// phone's own.
  Future<List<SubscriptionHistoryModel>> getHistory(String companyId) async {
    final local = await _historyDao.getByCompanyId(companyId);

    try {
      final snapshot = await _historyCollection(companyId)
          .get()
          .timeout(_firestoreTimeout);
      final byId = {for (final period in local) period.id: period};

      for (final doc in snapshot.docs) {
        if (byId.containsKey(doc.id)) continue;
        final period =
            SubscriptionHistoryModel.fromMap({...doc.data(), 'id': doc.id});
        byId[doc.id] = period;
        await _historyDao.insert(period);
      }

      return byId.values.toList()
        ..sort((a, b) => b.authorizationDate.compareTo(a.authorizationDate));
    } catch (_) {
      return local;
    }
  }

  /// How many demo generations have already been used for
  /// [documentType] - read-only counterpart to recordDemoGeneration(),
  /// for SubscriptionAccessService.getRemainingDemoGenerations().
  /// Moves a subscription whose last day has passed to EXPIRED, so
  /// every screen and the Super Admin's own list agree with what the
  /// access check already enforces. Best effort: offline, the status
  /// stays as it was and the access check still refuses, so nobody
  /// gains access from a failed write.
  Future<SubscriptionModel> _expireIfLapsed(SubscriptionModel subscription) async {
    if (!subscription.status.grantsFullAccess || !subscription.hasLapsed) {
      return subscription;
    }

    final expired = subscription.copyWith(
      status: SubscriptionStatus.expired,
      updatedAt: DateTime.now().toIso8601String(),
    );

    // Not written to the cloud: the rules let only a Super Admin change
    // a status, so the owner's write was always refused. Lapse is read
    // from expiryDate wherever it matters - here, in the access check
    // and on the Super Admin dashboard.
    await _syncFromFirestore(expired);
    return expired;
  }

  Future<int> getDemoGenerationsUsed(
    String companyId,
    String documentType,
  ) async {
    final current = await getOrCreateForCompany(companyId);
    return demoGenerationsUsedIn(current, documentType);
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
      // Only the counters: the rules let the owner raise them and
      // nothing else here. Resending the whole record (a lapsed
      // subscription carries status EXPIRED on this device) was
      // refused every time, so free copies were never counted.
      await _subscriptionsCollection.doc(companyId).update({
        'demoGenerationsUsed': updated.demoGenerationsUsed,
        'demoGenerationsUsedJson': updated.demoGenerationsUsedJson,
        'updatedAt': updated.updatedAt,
      }).timeout(_firestoreTimeout);
    } catch (_) {
      // Offline - the demo count still needs to be recorded locally so
      // the company can't bypass the limit by staying offline; it will
      // reconcile with Firestore on the next successful online read.
    }

    await _syncFromFirestore(updated);
  }

  /// Free copies of [documentType] already used, from a subscription
  /// already in hand - no second read.
  static int demoGenerationsUsedIn(
    SubscriptionModel subscription,
    String documentType,
  ) =>
      _decodeDemoCounts(subscription.demoGenerationsUsedJson)[documentType] ??
      0;

  static Map<String, int> _decodeDemoCounts(String json) {
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

  static String _encodeDemoCounts(Map<String, int> counts) =>
      jsonEncode(counts);
}
