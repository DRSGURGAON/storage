/// App-wide feature flags.
///
/// Deliberately a single, tiny file with compile-time constants rather
/// than anything configurable at runtime - these are development/
/// rollout switches, not user or Super Admin settings (those live in
/// SubscriptionSettingsModel and are edited in-app).
class FeatureFlags {
  FeatureFlags._();

  // ===================================================================
  // PRODUCTION CONFIGURATION - free-trial business model.
  //
  //   - demoGenerationLimitEnforced = true  -> free allowance enforced
  //     (SubscriptionSettingsModel.demoGenerationLimit, seeded at 2
  //     per document type, and editable by the Super Admin - the
  //     number lives there and nowhere else, never in a screen)
  //   - watermarkEnabled = true             -> those free copies are
  //     watermarked demo copies
  //
  // Net effect: an unsubscribed company gets 2 WATERMARKED documents
  // per document type, then DemoLimitReached prompts them to
  // subscribe. Subscribed companies (status ACTIVE/EXPIRING_SOON) get
  // unlimited, clean documents.
  //
  // Testers are handled WITHOUT any flag: the Super Admin simply
  // activates that company's subscription from the Super Admin
  // dashboard, which gives them the same unlimited clean access a
  // paying customer gets. No tester backdoor ships in the build.
  // ===================================================================

  /// Master switch for the demo/trial watermark on generated PDFs.
  ///
  /// CURRENTLY FALSE - TESTING MODE. Every document generates clean,
  /// with no watermark, regardless of subscription status.
  ///
  /// !! MUST BE SET BACK TO `true` BEFORE THE PLAY STORE RELEASE !! This does NOT remove or weaken any
  /// watermark code: every PDF service still accepts and honours its
  /// own showWatermark/watermarkText/watermarkOpacity parameters
  /// exactly as before, and each PDF screen still computes whether a
  /// document *would* be watermarked - this flag simply gates that
  /// computed value at the last step.
  ///
  /// TO RE-ENABLE WATERMARKING LATER: change this one line to `true`.
  /// Nothing else needs to change anywhere in the app - the existing
  /// behaviour returns exactly as it was (unsubscribed users get
  /// watermarked demo copies at the Super-Admin-configured opacity,
  /// subscribed users get clean ones).
  ///
  /// NOTE ON THE FREE-DEMO ALLOWANCE: this flag is independent of the
  /// demo-generation *limit* (SubscriptionSettingsModel
  /// .demoGenerationLimit, seeded at 2 per document type). That limit
  /// stays fully active - each document type still gets 1 free
  /// generation before a subscription is required, and
  /// SubscriptionAccessService still tracks and enforces it. Only the
  /// visual watermark itself is suppressed here.
  static const bool watermarkEnabled = true;

  /// Master switch for the free-document allowance
  /// (SubscriptionSettingsModel.demoGenerationLimit, seeded at 2 per
  /// document type).
  ///
  /// CURRENTLY FALSE - TESTING MODE. Unlimited free document
  /// generation, no confirmation gate, no "limit reached" screen,
  /// and no demo counts recorded.
  ///
  /// !! MUST BE SET BACK TO `true` BEFORE THE PLAY STORE RELEASE !!
  /// Shipping this as `false` means every user gets unlimited free
  /// documents forever and the subscription model does nothing. Nothing about the allowance system is
  /// removed: the limit value, the per-document-type counters,
  /// SubscriptionAccessService's own tracking, DemoGenerationGate and
  /// DemoLimitReached all still exist untouched - this flag simply
  /// skips the gate and the counting while it's off.
  ///
  /// TO RE-ENABLE THE FREE LIMIT: change this one line
  /// to `true`. Behaviour returns exactly as before - each document
  /// type allows its configured number of free copies, then
  /// DemoLimitReached prompts for a subscription.
  ///
  /// NOTE: while this is false, no demo generations are recorded at
  /// all. That is deliberate - if counts kept accumulating during
  /// unlimited testing, flipping this back to `true` would instantly
  /// lock out every account that had already generated a document,
  /// which is not the intended behaviour.
  static const bool demoGenerationLimitEnforced = true;
}
