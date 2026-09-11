import '../../features/subscription/models/subscription_settings_model.dart';
import '../../features/subscription/repositories/subscription_repository.dart';
import '../../features/subscription/repositories/subscription_settings_repository.dart';
import '../tenant/tenant_scope.dart';
import 'subscription_status.dart';

/// The single centralized place every document-generation screen
/// checks before producing a PDF (Section 26: "Create a central
/// service/helper... DO NOT duplicate subscription logic inside every
/// document screen. All modules should use the same centralized access
/// system."). No PDF service or form screen should re-derive
/// isSubscriptionActive/canGenerateDocument logic itself - they call
/// this.
///
/// Reads the CURRENT company's subscription (via TenantScope, exactly
/// like every other repository in this project) - this is deliberately
/// NOT the Super Admin's cross-company view (see SubscriptionRepository.
/// getAllAcrossCompanies() for that); this service answers "can THIS
/// company, right now, generate THIS document" for the ordinary,
/// signed-in, single-tenant user.
class SubscriptionAccessService {
  SubscriptionAccessService._();

  static final SubscriptionAccessService instance =
      SubscriptionAccessService._();

  final SubscriptionRepository _subscriptionRepository =
      SubscriptionRepository.instance;
  final SubscriptionSettingsRepository _settingsRepository =
      SubscriptionSettingsRepository.instance;

  /// True when the current company's subscription grants full,
  /// unrestricted access (ACTIVE or EXPIRING_SOON - a warning state,
  /// not a restriction; see SubscriptionStatus.grantsFullAccess's own
  /// doc comment). If TenantScope isn't ready yet (onboarding), this
  /// returns false rather than throwing - there is no company to check
  /// a subscription against yet, and onboarding itself must never be
  /// blocked by this check.
  Future<bool> isSubscriptionActive() async {
    if (!TenantScope.isReady) return false;

    final subscription = await _subscriptionRepository.getOrCreateForCompany(
      TenantScope.companyId,
    );

    return subscription.status.grantsFullAccess;
  }

  /// Days remaining until the current company's subscription expires -
  /// null if there is no subscription, no expiry date, or the
  /// subscription isn't ACTIVE at all (a LIMITED/EXPIRED/CANCELLED
  /// subscription has nothing meaningful to count down to). Negative
  /// once actually past expiry.
  Future<int?> daysUntilExpiry() async {
    if (!TenantScope.isReady) return null;

    final subscription = await _subscriptionRepository.getOrCreateForCompany(
      TenantScope.companyId,
    );

    if (subscription.status != SubscriptionStatus.active) return null;

    final expiry = DateTime.tryParse(subscription.expiryDate ?? '');
    if (expiry == null) return null;

    // Whole calendar days, not a fractional Duration - "3 days left"
    // should mean the same thing regardless of what time of day the
    // check happens to run.
    final today = DateTime.now();
    final expiryDateOnly = DateTime(expiry.year, expiry.month, expiry.day);
    final todayDateOnly = DateTime(today.year, today.month, today.day);

    return expiryDateOnly.difference(todayDateOnly).inDays;
  }

  /// Section 20's "EXPIRING SOON" warning - true when the current
  /// company's ACTIVE subscription's remaining days matches (or has
  /// passed below) one of Super Admin's configured warning thresholds
  /// (SubscriptionSettingsModel.expiryWarningDays, default
  /// "30,15,7,3,1"). Uses "at or below the LARGEST configured
  /// threshold that hasn't passed" rather than only exact-day matches -
  /// a warning banner should keep showing every day inside the window,
  /// not flash on exactly day 30/15/7/3/1 and disappear the days
  /// between them.
  Future<bool> isExpiringSoon() async {
    final days = await daysUntilExpiry();
    if (days == null || days < 0) return false;

    final settings = await _settingsRepository.get();
    final thresholds = settings.expiryWarningDays;
    if (thresholds.isEmpty) return false;

    final largestThreshold = thresholds.reduce((a, b) => a > b ? a : b);

    return days <= largestThreshold;
  }

  /// The inverse of isSubscriptionActive() - kept as its own method
  /// (rather than callers writing `!await isSubscriptionActive()`)
  /// because "limited mode" is the specification's own named concept
  /// (Section 5's title is literally "LIMITED MODE DOCUMENT
  /// GENERATION") and reads more directly at each call site.
  Future<bool> isLimitedMode() async => !(await isSubscriptionActive());

  /// Can the current company generate a normal (non-demo,
  /// non-watermarked) copy of [documentType] right now? True whenever
  /// the subscription is active - Limited-mode demo copies are a
  /// completely separate question, answered by
  /// getRemainingDemoGenerations() below, not this method.
  Future<bool> canGenerateDocument(String documentType) async {
    return isSubscriptionActive();
  }

  /// How many free demo copies of [documentType] remain for the
  /// current company, before a real subscription is required (Section
  /// 5) - the limit itself is Super Admin-configurable
  /// (SubscriptionSettingsModel.demoGenerationLimit), never hardcoded,
  /// and tracked per document type (Section 5's explicit "Do not use
  /// one global counter"), never a single shared count.
  ///
  /// Meaningless (and not meant to be checked) when the subscription is
  /// already active - callers should check isSubscriptionActive()
  /// first and only fall back to this when it's false, matching the
  /// UX flow Section 27 describes.
  Future<int> getRemainingDemoGenerations(String documentType) async {
    if (!TenantScope.isReady) return 0;

    final settings = await _settingsRepository.get();
    final used = await _subscriptionRepository.getDemoGenerationsUsed(
      TenantScope.companyId,
      documentType,
    );

    final remaining = settings.demoGenerationLimit - used;

    return remaining > 0 ? remaining : 0;
  }

  /// Records that one demo copy of [documentType] was just generated -
  /// call this ONLY after the PDF genuinely finished generating
  /// successfully (never before, and never on a failed/cancelled
  /// generation - that would burn the company's one free copy for
  /// nothing).
  Future<void> recordDemoGeneration(String documentType) async {
    if (!TenantScope.isReady) return;

    await _subscriptionRepository.recordDemoGeneration(
      TenantScope.companyId,
      documentType,
    );
  }

  /// The platform's configured watermark text/opacity (Section 6) -
  /// exposed here so every document PDF service reads the SAME
  /// watermark configuration rather than each hardcoding its own
  /// string, matching Section 26's "do not duplicate" instruction
  /// applied to watermarking as much as to the access checks
  /// themselves.
  Future<SubscriptionSettingsModel> getSettings() async {
    return _settingsRepository.get();
  }
}
