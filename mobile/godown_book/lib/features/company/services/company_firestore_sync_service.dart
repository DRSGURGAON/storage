import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../../../core/document_theme/document_theme.dart';
import '../models/company_model.dart';

/// Mirrors the company profile into Firestore, keyed by the currently
/// signed-in Firebase Auth UID (companies/{uid}) - NOT the local
/// companyId UUID. This is the missing link this project's audit
/// identified: local SQLite alone means the same person logging in on
/// a second device, or reinstalling the app, previously got a brand
/// new empty company with no connection to their real data. Keying by
/// Firebase UID (stable across reinstalls/devices, unlike a locally-
/// generated UUID) is what makes "the same company retrieves the same
/// cloud data after login from another device" genuinely possible.
///
/// DELIBERATELY ADDITIVE, NOT A REPLACEMENT: local SQLite
/// (CompanyRepository/CompanyDao) remains the source of truth for
/// every existing read in this app (CompanyController.getCompany()
/// is completely untouched) - this service is called ADDITIONALLY,
/// after a successful local save, as a best-effort cloud mirror.
/// A failed sync (offline, etc.) never blocks or reverts the local
/// save - the company profile a user just edited must always be
/// usable immediately on their own device regardless of connectivity;
/// syncFromCloud() (called at login) is what catches up a device that
/// missed pushes while offline.
///
/// HONEST SCOPE LIMITATION: logoPath/signaturePath/stampPath are
/// local device file-system paths (e.g.
/// "/data/user/0/.../files/logo.png") - genuinely meaningless on a
/// different device, so they are NOT synced by this service. Syncing
/// the actual image files would require Firebase Storage (uploading
/// the file itself, then storing a download URL instead of a local
/// path) - a separate, larger integration this task's scope did not
/// include. Every other company field (name, address, GST, bank
/// details, prefixes, terms, etc.) IS synced.
class CompanyFirestoreSyncService {
  CompanyFirestoreSyncService._();

  static final CompanyFirestoreSyncService instance =
      CompanyFirestoreSyncService._();

  CollectionReference<Map<String, dynamic>> get _companiesCollection =>
      FirebaseFirestore.instance.collection('companies');

  /// How long any single Firestore call is allowed to take before it's
  /// treated as "genuinely unreachable". Essential, not cosmetic:
  /// Firestore's own SDK does NOT throw when the backend is
  /// unreachable (no network, database not yet created in the Firebase
  /// Console, rules rejecting before a connection is established) - it
  /// retries indefinitely. Without this, CompanyController.saveCompany()
  /// awaits pushToCloud() forever and the Company Settings "Saving..."
  /// button never resolves.
  static const Duration _firestoreTimeout = Duration(seconds: 8);

  /// Pushes [company] to companies/{currentUid} - a no-op (returns
  /// false) if nobody is genuinely signed in yet (e.g. very first
  /// onboarding screen, before OTP verification in some flows) or if
  /// the write genuinely fails (offline, etc.) - callers must treat
  /// a false return as "the local save still succeeded, only the
  /// cloud mirror didn't happen yet", never as a reason to fail the
  /// whole save operation.
  Future<bool> pushToCloud(CompanyModel company) async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null || uid.isEmpty) return false;

    try {
      await _companiesCollection.doc(uid).set(_toFirestoreMap(company)).timeout(_firestoreTimeout);
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Pulls the current user's company profile from Firestore, if one
  /// exists - null if nobody is signed in, no document exists yet
  /// (genuinely new company, or one only ever saved on a device that
  /// never got to sync), or the read genuinely fails (offline).
  /// Callers combine this with the local SQLite copy (see
  /// _loadTenant()'s own reconciliation logic) rather than blindly
  /// overwriting - a locally-edited-but-not-yet-synced company must
  /// never be silently discarded by an older cloud copy.
  Future<CompanyModel?> pullFromCloud() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null || uid.isEmpty) return null;

    try {
      final snapshot = await _companiesCollection.doc(uid).get().timeout(_firestoreTimeout);
      if (!snapshot.exists || snapshot.data() == null) return null;

      return _fromFirestoreMap(snapshot.data()!);
    } catch (_) {
      return null;
    }
  }

  /// Firestore's own document shape - camelCase, matching this
  /// project's existing convention for Firestore documents
  /// (SubscriptionModel.toFirestore()). Deliberately excludes
  /// logoPath/signaturePath/stampPath - see this class's own doc
  /// comment on why.
  Map<String, dynamic> _toFirestoreMap(CompanyModel company) {
    return {
      'companyId': company.companyId,
      'companyCode': company.companyCode,
      'companyName': company.companyName,
      'tagLine': company.tagLine,
      'affiliatedBy': company.affiliatedBy,
      'authorizedSignatoryName': company.authorizedSignatoryName,
      'quotationTheme': company.documentTheme.code,
      'mobile1': company.mobile1,
      'mobile2': company.mobile2,
      'mobile3': company.mobile3,
      'mobile4': company.mobile4,
      'whatsappNumber': company.whatsappNumber,
      'landline': company.landline,
      'tollFree': company.tollFree,
      'email': company.email,
      'website': company.website,
      'gstNumber': company.gstNumber,
      'panNumber': company.panNumber,
      'msmeNumber': company.msmeNumber,
      'isoCertificate': company.isoCertificate,
      'address': company.address,
      'city': company.city,
      'state': company.state,
      'pincode': company.pincode,
      'jurisdiction': company.jurisdiction,
      'beneficiaryName': company.beneficiaryName,
      'bankName': company.bankName,
      'branchName': company.branchName,
      'accountNumber': company.accountNumber,
      'ifscCode': company.ifscCode,
      'upiId1': company.upiId1,
      'upiId2': company.upiId2,
      'phonePeNumber': company.phonePeNumber,
      'googlePayNumber': company.googlePayNumber,
      'paytmNumber': company.paytmNumber,
      'bookingPrefix': company.bookingPrefix,
      'invoicePrefix': company.invoicePrefix,
      'receiptPrefix': company.receiptPrefix,
      'releasePrefix': company.releasePrefix,
      'defaultTerms': company.defaultTerms,
      'footerText': company.footerText,
      'footerText2': company.footerText2,
      'createdAt': company.createdAt,
      'updatedAt': DateTime.now().toIso8601String(),
    };
  }

  /// The reverse of _toFirestoreMap() - reconstructs a CompanyModel
  /// from a Firestore document. logoPath/signaturePath/stampPath are
  /// genuinely absent from the cloud document (see this class's own
  /// doc comment), so they default to empty - a device pulling a
  /// cloud-only company profile for the first time will need to
  /// re-upload its own logo/signature/stamp locally; this is an
  /// honest limitation, not a bug, given no Firebase Storage
  /// integration exists yet.
  CompanyModel _fromFirestoreMap(Map<String, dynamic> data) {
    return CompanyModel(
      companyId: data['companyId'] as String? ?? '',
      companyCode: data['companyCode'] as String? ?? 'DRS001',
      companyName: data['companyName'] as String? ?? '',
      tagLine: data['tagLine'] as String? ?? '',
      affiliatedBy: data['affiliatedBy'] as String? ?? '',
      authorizedSignatoryName: data['authorizedSignatoryName'] as String? ?? '',
      documentTheme: DocumentTheme.fromCode(data['quotationTheme'] as String?),
      mobile1: data['mobile1'] as String? ?? '',
      mobile2: data['mobile2'] as String? ?? '',
      mobile3: data['mobile3'] as String? ?? '',
      mobile4: data['mobile4'] as String? ?? '',
      whatsappNumber: data['whatsappNumber'] as String? ?? '',
      landline: data['landline'] as String? ?? '',
      tollFree: data['tollFree'] as String? ?? '',
      email: data['email'] as String? ?? '',
      website: data['website'] as String? ?? '',
      gstNumber: data['gstNumber'] as String? ?? '',
      panNumber: data['panNumber'] as String? ?? '',
      msmeNumber: data['msmeNumber'] as String? ?? '',
      isoCertificate: data['isoCertificate'] as String? ?? '',
      address: data['address'] as String? ?? '',
      city: data['city'] as String? ?? '',
      state: data['state'] as String? ?? '',
      pincode: data['pincode'] as String? ?? '',
      jurisdiction: data['jurisdiction'] as String? ?? '',
      beneficiaryName: data['beneficiaryName'] as String? ?? '',
      bankName: data['bankName'] as String? ?? '',
      branchName: data['branchName'] as String? ?? '',
      accountNumber: data['accountNumber'] as String? ?? '',
      ifscCode: data['ifscCode'] as String? ?? '',
      upiId1: data['upiId1'] as String? ?? '',
      upiId2: data['upiId2'] as String? ?? '',
      phonePeNumber: data['phonePeNumber'] as String? ?? '',
      googlePayNumber: data['googlePayNumber'] as String? ?? '',
      paytmNumber: data['paytmNumber'] as String? ?? '',
      bookingPrefix: data['bookingPrefix'] as String? ?? '',
      invoicePrefix: data['invoicePrefix'] as String? ?? '',
      receiptPrefix: data['receiptPrefix'] as String? ?? '',
      releasePrefix: data['releasePrefix'] as String? ?? '',
      defaultTerms: data['defaultTerms'] as String? ?? '',
      footerText: data['footerText'] as String? ?? '',
      footerText2: data['footerText2'] as String? ?? '',
      createdAt: data['createdAt'] as String? ?? DateTime.now().toIso8601String(),
      updatedAt: data['updatedAt'] as String? ?? DateTime.now().toIso8601String(),
    );
  }
}
