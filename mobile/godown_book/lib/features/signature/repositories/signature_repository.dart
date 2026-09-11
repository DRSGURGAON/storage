import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../../../core/tenant/tenant_scope.dart';
import '../../company/controllers/company_controller.dart';
import '../data/signature_request_dao.dart';
import '../models/signature_request_model.dart';

/// Asking a customer to sign a document from their own phone.
///
/// How it works: the app writes what the customer should see to one
/// Firestore document under a long random token, and the operator sends
/// them the link. The customer opens it in a browser, reads the
/// document, signs on the screen and submits. The app then brings the
/// signature back, saves the image on the device, and deletes the cloud
/// copy - so the link stops showing anybody's details the moment it has
/// done its job.
///
/// What this is not: a certificate-based digital signature. It records
/// that a person at that link drew a signature, with the time and the
/// text they agreed to. Print it as what it is - an electronically
/// signed acknowledgement - and nothing more.
class SignatureRepository {
  SignatureRepository._();

  static final SignatureRepository instance = SignatureRepository._();

  final SignatureRequestDao _dao = SignatureRequestDao.instance;

  /// Test seams: production never sets these.
  static FirebaseFirestore? firestoreOverride;
  static String? currentUidOverride;

  /// Where the signing page is hosted. Set once for the whole app, in
  /// Settings, because it is the app owner's own hosting - not a
  /// per-company value.
  static String signBaseUrl = defaultSignBaseUrl;

  static const String defaultSignBaseUrl = '';

  /// How long a link stays usable.
  static const Duration linkLife = Duration(days: 14);

  static const Duration _timeout = Duration(seconds: 12);

  FirebaseFirestore get _firestore =>
      firestoreOverride ?? FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _requests =>
      _firestore.collection('signatureRequests');

  String get _currentUid {
    final override = currentUidOverride;
    if (override != null) return override;
    try {
      return FirebaseAuth.instance.currentUser?.uid ?? '';
    } catch (_) {
      return '';
    }
  }

  /// A token long enough that a link cannot be guessed from another
  /// one: 32 characters from a cryptographically secure source.
  static String newToken() {
    const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    final random = Random.secure();
    return List.generate(32, (_) => alphabet[random.nextInt(alphabet.length)])
        .join();
  }

  String linkFor(String token) {
    final base = signBaseUrl.trim();
    if (base.isEmpty) return '';
    final trimmed = base.endsWith('/') ? base.substring(0, base.length - 1) : base;
    return '$trimmed/?t=$token';
  }

  Future<List<SignatureRequestModel>> getForDocument(
    String documentType,
    String documentId,
  ) =>
      _dao.getForDocument(documentType, documentId);

  /// The signature a customer has already given for this document, or
  /// null. Used by the PDF services to print it.
  Future<SignedSignature?> signedFor(
    String documentType,
    String documentId,
  ) async {
    final requests = await _dao.getForDocument(documentType, documentId);
    for (final request in requests) {
      if (!request.isSigned || request.signaturePath.isEmpty) continue;
      try {
        final file = File(request.signaturePath);
        if (!await file.exists()) continue;
        return SignedSignature(
          image: await file.readAsBytes(),
          signedAt: request.signedAt,
          signerName: request.signerName.isEmpty
              ? request.customerName
              : request.signerName,
        );
      } catch (_) {
        // An unreadable file must never stop a document printing.
      }
    }
    return null;
  }

  /// Creates a request and publishes what the customer will see.
  ///
  /// [details] are the few lines the customer is shown above the
  /// signature pad, [terms] the text they are agreeing to. Throws when
  /// the signing page has not been configured, or the write fails -
  /// never returns a link that would open on nothing.
  Future<SignatureRequestModel> request({
    required String documentType,
    required String documentId,
    required String documentNo,
    required String customerName,
    required String customerPhone,
    required String title,
    required List<SignatureDetail> details,
    required String terms,
    String consentText = 'I confirm the details above are correct and I agree '
        'to the terms shown.',
  }) async {
    if (signBaseUrl.trim().isEmpty) {
      throw const SigningNotConfigured();
    }

    final company = await CompanyController.instance.getCompany();
    final now = DateTime.now();
    final expiresAt = now.add(linkLife);
    final token = newToken();

    await _requests.doc(token).set({
      'companyId': TenantScope.companyId,
      'ownerUid': _currentUid,
      'companyName': company?.companyName ?? '',
      'companyPhone': company?.mobile1 ?? '',
      'documentType': documentType,
      'documentId': documentId,
      'documentNo': documentNo,
      'customerName': customerName,
      'customerPhone': customerPhone,
      'title': title,
      'details': [for (final detail in details) detail.toMap()],
      'terms': terms,
      'consentText': consentText,
      'status': SignatureStatus.pending.code,
      'createdAt': Timestamp.fromDate(now),
      'expiresAt': Timestamp.fromDate(expiresAt),
    }).timeout(_timeout);

    final request = SignatureRequestModel(
      id: token,
      documentType: documentType,
      documentId: documentId,
      documentNo: documentNo,
      customerName: customerName,
      customerPhone: customerPhone,
      link: linkFor(token),
      createdAt: now.toIso8601String(),
      expiresAt: expiresAt.toIso8601String(),
    );

    await _dao.insert(request);
    return request;
  }

  /// Looks for the customer's answer. When they have signed, the image
  /// is saved on the device, the row is updated and the cloud copy is
  /// deleted. Returns the request as it now stands.
  Future<SignatureRequestModel> refresh(SignatureRequestModel request) async {
    if (request.isSigned) return request;

    Map<String, dynamic>? data;
    try {
      final snapshot = await _requests.doc(request.id).get().timeout(_timeout);
      data = snapshot.data();
    } catch (_) {
      // Offline or unreachable - the row stays as it is, and the
      // operator can check again.
      return request;
    }

    if (data == null) {
      // The cloud copy is gone. Either this app already brought the
      // signature back, or the request was cancelled elsewhere.
      if (request.hasExpired) {
        final expired = request.copyWith(status: SignatureStatus.expired);
        await _dao.update(expired);
        return expired;
      }
      return request;
    }

    final status = SignatureStatus.fromCode(data['status'] as String?);
    if (status != SignatureStatus.signed) {
      if (request.hasExpired) {
        final expired = request.copyWith(status: SignatureStatus.expired);
        await _dao.update(expired);
        return expired;
      }
      return request;
    }

    final signatureBase64 = (data['signature'] as String?) ?? '';
    if (signatureBase64.isEmpty) return request;

    final path = await _saveSignature(request.id, signatureBase64);

    final signedAt = data['signedAt'];
    final signed = request.copyWith(
      status: SignatureStatus.signed,
      signerName: (data['signerName'] as String?) ?? request.customerName,
      signedAt: signedAt is Timestamp
          ? signedAt.toDate().toIso8601String()
          : DateTime.now().toIso8601String(),
      signaturePath: path,
    );

    await _dao.update(signed);

    // The link has done its job; stop it showing the customer's details.
    try {
      await _requests.doc(request.id).delete().timeout(_timeout);
    } catch (_) {
      // Left behind at worst; it expires on its own.
    }

    return signed;
  }

  Future<String> _saveSignature(String token, String base64Png) async {
    final bytes = base64Decode(base64Png.split(',').last);

    final documentsDir = await getApplicationDocumentsDirectory();
    final dir = Directory(p.join(documentsDir.path, 'signatures'));
    if (!await dir.exists()) await dir.create(recursive: true);

    final file = File(p.join(dir.path, '$token.png'));
    await file.writeAsBytes(bytes);
    return file.path;
  }

  /// Stops a link working, and removes the cloud copy with it.
  Future<void> cancel(SignatureRequestModel request) async {
    try {
      await _requests.doc(request.id).delete().timeout(_timeout);
    } catch (_) {
      // The local row below still records that it was cancelled.
    }
    await _dao.update(request.copyWith(status: SignatureStatus.cancelled));
  }

  /// Removes the request and the signature image with it.
  Future<void> delete(SignatureRequestModel request) async {
    try {
      await _requests.doc(request.id).delete().timeout(_timeout);
    } catch (_) {}

    if (request.signaturePath.isNotEmpty) {
      try {
        final file = File(request.signaturePath);
        if (await file.exists()) await file.delete();
      } catch (_) {}
    }

    await _dao.delete(request.id);
  }
}

/// A signature that has come back, ready to print.
class SignedSignature {
  final Uint8List image;
  final String signedAt;
  final String signerName;

  const SignedSignature({
    required this.image,
    required this.signedAt,
    required this.signerName,
  });
}

/// Thrown when no signing page has been configured, so a link would
/// open on nothing.
class SigningNotConfigured implements Exception {
  const SigningNotConfigured();

  @override
  String toString() =>
      'The signing page is not set up yet. Add its web address in '
      'Settings to send signature links.';
}
