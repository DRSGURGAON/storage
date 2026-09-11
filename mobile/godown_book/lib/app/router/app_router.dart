import 'package:go_router/go_router.dart';

import '../../core/auth/auth_scope.dart';
import '../../core/subscription/super_admin_scope.dart';

// Auth
import '../../features/auth/login_screen.dart';
import '../../features/auth/otp_verification_screen.dart';

// Dashboard / Settings
import '../../features/dashboard/dashboard_screen.dart';
import '../../features/settings/screens/cloud_backup_screen.dart';
import '../../features/settings/screens/delete_account_screen.dart';
import '../../features/settings/screens/settings_screen.dart';
import '../../features/reports/screens/document_customisation_screen.dart';

// Company
import '../../features/company/screens/company_card_screen.dart';
import '../../features/company/screens/company_onboarding_screen.dart';
import '../../features/company/screens/company_settings_screen.dart';
import '../../features/company/screens/letterhead_pdf_screen.dart';
import '../../features/kyc/screens/kyc_screen.dart';

// Masters
import '../../features/customers/screens/customer_form_screen.dart';
import '../../features/customers/screens/customer_list_screen.dart';
import '../../features/master/screens/charge_head_screen.dart';
import '../../features/master/screens/storage_location_screen.dart';

// Users & Roles
import '../../features/users/screens/users_roles_screen.dart';

// Subscription
import '../../features/subscription/models/subscription_model.dart';
import '../../features/subscription/screens/payment_verification_queue_screen.dart';
import '../../features/subscription/screens/subscription_history_screen.dart';
import '../../features/subscription/screens/subscription_screen.dart';
import '../../features/subscription/screens/super_admin_authorize_screen.dart';
import '../../features/subscription/screens/super_admin_company_detail_screen.dart';
import '../../features/subscription/screens/super_admin_dashboard_screen.dart';
import '../../features/subscription/screens/super_admin_entry_screen.dart';
import '../../features/subscription/screens/super_admin_settings_screen.dart';

class AppRouter {
  AppRouter._();

  /// Screens reachable before the user is signed in.
  static const Set<String> _authFreeRoutes = {
    '/login',
    '/verify-otp',
  };

  /// Super Admin-only screens - /super-admin-setup is deliberately NOT
  /// in this set: it's the one-time bootstrap flow that must remain
  /// reachable by a normal signed-in user with no Super Admin yet (see
  /// SuperAdminEntryScreen's own doc comment), and it has its own
  /// internal canBootstrap()/isSuperAdmin checks that correctly handle
  /// every other case (already-admin, another-admin-exists).
  static const Set<String> _superAdminRoutes = {
    '/super-admin',
    '/super-admin/payment-queue',
    '/super-admin/authorize',
    '/super-admin/settings',
    '/super-admin/company-detail',
  };

  static final GoRouter router = GoRouter(
    initialLocation: '/login',

    // Two guards, checked in order: first "is anyone signed in on
    // this device" (unauthenticated always lands on Login regardless
    // of what URL was requested, so there is no way to deep-link or
    // back-navigate around it), then "is this a Super Admin-only
    // route the signed-in user is not authorized for". Company setup
    // is optional - main.dart's own _loadTenant() ensures a local
    // company record (and therefore TenantScope.isReady) always exists
    // after the first launch, so a user can go straight to Dashboard
    // and fill in company details later from Settings.
    redirect: (context, state) {
      final path = state.matchedLocation;

      if (!AuthScope.isAuthenticated) {
        return _authFreeRoutes.contains(path) ? null : '/login';
      }

      // Signed in: never show the login/OTP screens again - back
      // navigation must not be able to return to them mid-session.
      if (_authFreeRoutes.contains(path)) return '/dashboard';

      if (_superAdminRoutes.contains(path) && !SuperAdminScope.isSuperAdmin) {
        return '/dashboard';
      }

      return null;
    },

    routes: [
      // ==========================
      // Auth
      // ==========================
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),

      GoRoute(
        path: '/verify-otp',
        builder: (context, state) {
          final args = state.extra as Map<String, dynamic>;

          return OtpVerificationScreen(
            mobileNumber: args['mobileNumber'] as String,
            verificationHandle: args['verificationHandle'] as String,
          );
        },
      ),

      // ==========================
      // Dashboard / Settings
      // ==========================
      GoRoute(
        path: '/dashboard',
        builder: (context, state) => const DashboardScreen(),
      ),

      GoRoute(
        path: '/settings',
        builder: (context, state) => const SettingsScreen(),
      ),

      GoRoute(
        path: '/reports/customise-documents',
        builder: (context, state) => const DocumentCustomisationScreen(),
      ),

      GoRoute(
        path: '/delete-account',
        builder: (context, state) => const DeleteAccountScreen(),
      ),

      GoRoute(
        path: '/cloud-backup',
        builder: (context, state) => const CloudBackupScreen(),
      ),

      // ==========================
      // Company
      // ==========================
      GoRoute(
        path: '/company-onboarding',
        builder: (context, state) => const CompanyOnboardingScreen(),
      ),

      GoRoute(
        path: '/company-settings',
        builder: (context, state) => const CompanySettingsScreen(),
      ),

      GoRoute(
        path: '/letterhead-pdf',
        builder: (context, state) => const LetterHeadPdfScreen(),
      ),

      GoRoute(
        path: '/company-card',
        builder: (context, state) => const CompanyCardScreen(),
      ),

      GoRoute(
        path: '/kyc',
        builder: (context, state) => const KycScreen(),
      ),

      // ==========================
      // Masters
      // ==========================
      GoRoute(
        path: '/customers',
        builder: (context, state) => const CustomerListScreen(),
      ),

      GoRoute(
        path: '/customer-create',
        builder: (context, state) => const CustomerFormScreen(),
      ),

      GoRoute(
        path: '/customer-edit',
        builder: (context, state) =>
            CustomerFormScreen(editCustomerId: state.extra as String),
      ),

      GoRoute(
        path: '/charge-heads',
        builder: (context, state) => const ChargeHeadScreen(),
      ),

      GoRoute(
        path: '/storage-locations',
        builder: (context, state) => const StorageLocationScreen(),
      ),

      // ==========================
      // Users & Roles
      // ==========================
      GoRoute(
        path: '/users-roles',
        builder: (context, state) => const UsersRolesScreen(),
      ),

      // ==========================
      // Subscription
      // ==========================
      GoRoute(
        path: '/subscription',
        builder: (context, state) => const SubscriptionScreen(),
      ),

      GoRoute(
        path: '/subscription-history',
        builder: (context, state) => const SubscriptionHistoryScreen(),
      ),

      GoRoute(
        path: '/super-admin',
        builder: (context, state) => const SuperAdminDashboardScreen(),
      ),

      GoRoute(
        path: '/super-admin/payment-queue',
        builder: (context, state) => const PaymentVerificationQueueScreen(),
      ),

      GoRoute(
        path: '/super-admin/authorize',
        builder: (context, state) => const SuperAdminAuthorizeScreen(),
      ),

      GoRoute(
        path: '/super-admin/settings',
        builder: (context, state) => const SuperAdminSettingsScreen(),
      ),

      GoRoute(
        path: '/super-admin/company-detail',
        builder: (context, state) => SuperAdminCompanyDetailScreen(
          subscription: state.extra as SubscriptionModel,
        ),
      ),

      GoRoute(
        path: '/super-admin-setup',
        builder: (context, state) => const SuperAdminEntryScreen(),
      ),
    ],
  );
}
