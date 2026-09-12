import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app/router/app_router.dart';
import 'app/splash/branded_splash_screen.dart';
import 'app/theme/app_theme.dart';
import 'app/theme/theme_provider.dart';
import 'core/auth/auth_scope.dart';
import 'core/auth/auth_session.dart';
import 'core/cloud_sync/document_cloud_sync_service.dart';
import 'core/document_theme/document_theme.dart';
import 'core/permissions/permission_service.dart';
import 'core/subscription/super_admin_scope.dart';
import 'core/tenant/tenant_scope.dart';
import 'features/company/controllers/company_controller.dart';
import 'features/company/providers/company_provider.dart';
import 'features/company/services/company_firestore_sync_service.dart';
import 'features/signature/repositories/signature_repository.dart';
import 'features/subscription/services/platform_settings_service.dart';
import 'features/company/models/company_model.dart';
import 'firebase_options.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  try {
    // Firebase.apps.isEmpty guards against [core/duplicate-app]: if
    // Retry (below) re-runs main() after Firebase.initializeApp()
    // itself already succeeded once (and a LATER line in main() is
    // what actually threw), re-calling initializeApp() would crash
    // with "A Firebase App named [DEFAULT] already exists" instead of
    // genuinely retrying - this check makes the retry idempotent.
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp(
        options: DefaultFirebaseOptions.currentPlatform,
      );
    }
  } catch (error, stackTrace) {
    // Firebase is genuinely required for the entire login flow
    // (FirebaseAuth.instance) - there is no meaningful way to proceed
    // past a failed initialization. Rather than an unhandled exception
    // crashing before any UI exists, show a controlled, honest error
    // screen with a way to retry (e.g. after the device regains
    // network connectivity).
    debugPrint('Firebase initialization failed: $error\n$stackTrace');
    runApp(_FirebaseInitErrorApp(error: error));
    return;
  }

  // Both must be known before the first route resolves: the router
  // redirect reads AuthScope first, then TenantScope.
  await _syncFirebaseAuthState();
  await AuthScope.loadFromDisk();
  await _loadPermissionSession();
  await _loadTenant();

  runApp(const ProviderScope(child: GodownBookApp()));

  // Deliberately NOT awaited before runApp(): this is a Firestore
  // network call, and awaiting it held the very first frame hostage to
  // network latency - on a slow connection the user stared at a blank
  // screen for seconds before anything appeared. Nothing on the first
  // route needs it: the router redirect only consults SuperAdminScope
  // for super-admin routes, which are never the launch destination,
  // and SuperAdminEntryScreen refreshes it itself on open (see its own
  // _load). So it warms in the background while the app is already
  // usable.
  unawaited(SuperAdminScope.refresh());

  // Where signature links point. Published once by the Super Admin and
  // the same for every company, so it is fetched in the background and
  // cached - offline, the last known address is used, and when nothing
  // is known the signature buttons say so rather than sending a link
  // that opens on nothing.
  unawaited(_loadSigningAddress());

  // Periodic document cloud backup - one pass shortly after launch,
  // then every few minutes while the app is open. Entirely
  // best-effort and hash-gated (zero Firestore traffic when nothing
  // changed), so starting it unconditionally here is safe: it no-ops
  // by itself when nobody is signed in or no company exists yet.
  DocumentCloudSyncService.instance.start();
}

/// Shown only when Firebase.initializeApp() itself genuinely fails -
/// deliberately a minimal, dependency-free MaterialApp (no
/// ProviderScope/router/theme - none of those are safe to assume
/// working when the app's own backend connection failed before even
/// reaching them). "Retry" re-runs main() itself, which re-attempts
/// Firebase.initializeApp() from scratch - the same recovery path a
/// user force-closing and reopening the app would get, just without
/// requiring that.
class _FirebaseInitErrorApp extends StatelessWidget {
  final Object error;

  const _FirebaseInitErrorApp({required this.error});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.cloud_off, size: 56, color: Colors.grey),
                  const SizedBox(height: 16),
                  const Text(
                    'Could not connect',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Please check your internet connection and try again.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.grey),
                  ),
                  const SizedBox(height: 24),
                  ElevatedButton(
                    onPressed: () {
                      main();
                    },
                    child: const Text('Retry'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

Future<void> _loadSigningAddress() async {
  try {
    final prefs = await SharedPreferences.getInstance();
    final cached = prefs.getString(_signBaseUrlKey);
    if (cached != null && cached.isNotEmpty) {
      SignatureRepository.signBaseUrl = cached;
    }

    final platform = await PlatformSettingsService.instance.fetch();
    final published = platform?.signBaseUrl.trim() ?? '';
    if (published.isNotEmpty) {
      SignatureRepository.signBaseUrl = published;
      await prefs.setString(_signBaseUrlKey, published);
    }
  } catch (error) {
    debugPrint('Signing address not loaded at startup: $error');
  }
}

const String _signBaseUrlKey = 'signature_base_url';

/// Reconciles the locally-persisted "signed in" flag (AuthScope/
/// AuthSessionNotifier's own SharedPreferences cache) against
/// FirebaseAuth's own genuine session state, which is the actual
/// source of truth (see AuthSessionState's own doc comment). Firebase
/// itself already persists its session across restarts (its SDK
/// handles this internally), so most of the time this only needs to
/// clear the LOCAL cache when Firebase's own session has genuinely
/// gone away (token revoked, user deleted, or signed out from another
/// path).
///
/// It also corrects the other direction: AuthSessionNotifier.
/// markAuthenticated() sets AuthScope's in-memory flag synchronously
/// but persists to SharedPreferences afterward (see that method) - if
/// the process is killed in that gap, a genuinely-signed-in Firebase
/// user would otherwise find the local flag still false on next
/// launch and get sent back through the OTP flow for no reason, even
/// though FirebaseAuth.instance.currentUser is still valid.
/// AuthSessionNotifier's own _load() does not re-derive this from
/// Firebase - it only re-reads the same on-disk flag - so that
/// correction has to happen here, before AuthScope.loadFromDisk() runs.
///
/// This forward correction must never fire after a deliberate logout.
/// AuthSessionNotifier.signOut() always clears the local flag, but
/// FirebaseAuth.instance.signOut() itself can fail (e.g. genuinely
/// offline) and leave currentUser non-null - without checking
/// explicitSignOutKey here, that would look identical to the
/// kill-mid-persist race this correction exists for, and would
/// silently sign the user back in on a device they just signed out
/// of. signOut() sets that key precisely so this check can tell the
/// two apart.
Future<void> _syncFirebaseAuthState() async {
  try {
    final prefs = await SharedPreferences.getInstance();
    final user = FirebaseAuth.instance.currentUser;

    if (user == null) {
      await prefs.setBool(AuthSessionNotifier.authenticatedKey, false);
      return;
    }

    final explicitlySignedOut =
        prefs.getBool(AuthSessionNotifier.explicitSignOutKey) ?? false;

    if (!explicitlySignedOut &&
        !(prefs.getBool(AuthSessionNotifier.authenticatedKey) ?? false)) {
      await prefs.setBool(AuthSessionNotifier.authenticatedKey, true);
      final phone = user.phoneNumber;
      if (phone != null && phone.startsWith('+91')) {
        await prefs.setString(AuthSessionNotifier.mobileKey, phone.substring(3));
      }
    }
  } catch (error) {
    debugPrint('Firebase auth state sync failed at startup: $error');
  }
}

/// Loads the persisted mobile number (the same SharedPreferences key
/// AuthSessionNotifier itself reads/writes) so PermissionService can
/// resolve the signed-in user's role/permissions from the very first
/// screen after a restart - not only after a fresh login, where
/// AuthSessionNotifier.markAuthenticated() sets this directly.
Future<void> _loadPermissionSession() async {
  try {
    final prefs = await SharedPreferences.getInstance();
    PermissionService.currentMobileNumberOverride =
        prefs.getString(AuthSessionNotifier.mobileKey);
  } catch (error) {
    debugPrint('Permission session not loaded at startup: $error');
  }
}

Future<void> _loadTenant() async {
  try {
    final company = await CompanyController.instance.getCompany();

    if (company != null && company.companyId.isNotEmpty) {
      TenantScope.set(company.companyId);
      return;
    }

    // No company exists locally yet - before creating a fresh empty
    // shell, check whether the currently signed-in Firebase user
    // already has a company saved in the cloud (e.g. this is a
    // reinstall, or a login on a different device). This is
    // genuinely what makes "same company, same data, any device"
    // possible - see CompanyFirestoreSyncService's own doc comment.
    // Never overwrites an existing LOCAL company (the check above
    // already returned early if one exists) - this only ever fills
    // in a genuinely empty local state.
    final cloudCompany = await CompanyFirestoreSyncService.instance.pullFromCloud();

    if (cloudCompany != null && cloudCompany.companyName.isNotEmpty) {
      // Restoring the user's own real company from the cloud - uses
      // the exact same save path Company Settings' own save button
      // uses, so this is genuinely no different from the user having
      // just re-entered their details themselves.
      await CompanyController.instance.saveCompany(cloudCompany);

      // Same reinstall/new-device situation, one level deeper: the
      // company profile came back from the cloud, so its documents
      // (receipts/bills/releases - whatever the old device backed up)
      // exist in the cloud too. Pull them in the
      // background - deliberately NOT awaited, for the same
      // first-frame reason SuperAdminScope.refresh() isn't: the app
      // is fully usable while documents stream back in, and each
      // list screen reads fresh from SQLite every time it opens.
      unawaited(DocumentCloudSyncService.instance.restoreFromCloud());
      return;
    }

    // No company exists locally yet - rather than leaving TenantScope
    // unset (which would force every screen through the old mandatory
    // "Set Up Your Company" onboarding gate before anything else could
    // work), create a genuinely empty shell company now: purely local
    // (CompanyRepository.saveCompany() is SQLite-only, confirmed - no
    // Firestore call happens here, so this can never produce the
    // [cloud_firestore/not-found] error the mandatory onboarding flow
    // used to hit). Only companyName is a required constructor
    // parameter on CompanyModel - passed as '' here, which is a
    // genuinely valid (if empty) value, not a placeholder/fake name;
    // every other field keeps its own default (also empty/zero).
    // CompanyController.saveCompany() mints a real companyId and
    // calls TenantScope.set() itself - the exact same path Company
    // Settings' own save button already uses, so there is genuinely
    // no separate/duplicate creation logic here.
    await CompanyController.instance.saveCompany(
      const CompanyModel(companyName: ''),
    );
  } catch (error) {
    // Local database genuinely unavailable for some other reason -
    // TenantScope stays unset; the router's own !TenantScope.isReady
    // guard is gone (see app_router.dart), so the app will still open
    // to Dashboard, but any screen that queries a tenant table will
    // throw TenantScope's own StateError, which is the same honest
    // failure this project already used before this task, not a new
    // silent-bypass risk.
    debugPrint('Tenant not loaded at startup: $error');
  }
}

class GodownBookApp extends ConsumerWidget {
  const GodownBookApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModeProvider);

    // The company's own selected DocumentTheme - same 7-theme
    // setting that already styles every generated PDF, now also
    // driving the in-app UI's own color scheme. Falls back to
    // Classic while the company profile is still loading or hasn't
    // been set up yet (asyncValue.value stays null in both cases),
    // rather than blocking the app on this.
    final documentTheme =
        ref.watch(companyProvider).value?.documentTheme ??
            DocumentTheme.classic;

    return MaterialApp.router(
      debugShowCheckedModeBanner: false,
      title: 'StorageBill Pro',
      theme: AppTheme.light(documentTheme),
      darkTheme: AppTheme.dark(documentTheme),
      themeMode: themeMode,
      routerConfig: AppRouter.router,
      builder: (context, child) =>
          BrandedSplashScreen(child: child ?? const SizedBox.shrink()),
    );
  }
}
