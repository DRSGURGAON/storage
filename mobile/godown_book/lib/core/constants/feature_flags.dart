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
  /// CURRENTLY TRUE - the shipping setting. An unsubscribed user's
  /// documents carry the watermark at the Super-Admin-configured
  /// opacity; a subscribed user's print clean.
  ///
  /// Setting it to `false` suppresses the watermark everywhere without
  /// removing any watermark code: every PDF service still accepts and
  /// honours its own showWatermark/watermarkText/watermarkOpacity
  /// parameters exactly as before, and each PDF screen still computes
  /// whether a document *would* be watermarked - the flag gates that
  /// computed value at the last step. Use it only for a test build,
  /// and set it back before any release.
  ///
  /// NOTE ON THE FREE-DEMO ALLOWANCE: this flag is independent of the
  /// demo-generation *limit* (SubscriptionSettingsModel
  /// .demoGenerationLimit, seeded at 2 per document type), which is
  /// gated by demoGenerationLimitEnforced below. Only the visual
  /// watermark is controlled here.
  static const bool watermarkEnabled = true;

  /// Master switch for the free-document allowance
  /// (SubscriptionSettingsModel.demoGenerationLimit, seeded at 2 per
  /// document type).
  ///
  /// CURRENTLY TRUE - the shipping setting. Each document type allows
  /// its configured number of free copies, the per-type counters are
  /// recorded, and DemoLimitReached then prompts for a subscription.
  ///
  /// Setting it to `false` gives unlimited free documents with no
  /// confirmation gate and no counting, which makes the subscription
  /// model do nothing - a test-build setting only. Nothing about the
  /// allowance system is removed while it is off: the limit value, the
  /// per-document-type counters, SubscriptionAccessService's tracking,
  /// DemoGenerationGate and DemoLimitReached all still exist untouched.
  ///
  /// NOTE: while it is false, no demo generations are recorded at all.
  /// That is deliberate - if counts kept accumulating during unlimited
  /// testing, turning it back on would instantly lock out every account
  /// that had already generated a document.
  static const bool demoGenerationLimitEnforced = true;

  /// Whether the app checks GitHub for a newer build and offers to
  /// self-install it (AppUpdateService, AppUpdateBanner on the
  /// dashboard).
  ///
  /// CURRENTLY FALSE - the shipping setting, because this app is
  /// distributed through Google Play. Play's Developer Program Policy
  /// requires that an app installed from Play be updated only through
  /// Play; downloading and self-installing an APK from outside Play is
  /// exactly the kind of update mechanism the policy prohibits, and it
  /// is a real basis for rejection or suspension - not a stylistic
  /// preference.
  ///
  /// Set it to `true` only for a build that will never reach Play: a
  /// sideloaded build handed directly to testers who do not have a
  /// Play listing to update from yet. Nothing about the mechanism is
  /// removed while it is off - AppUpdateService and AppUpdateBanner
  /// still exist untouched; this flag simply keeps the banner from
  /// ever appearing and the GitHub check from ever firing.
  static const bool selfUpdateCheckEnabled = false;
}
