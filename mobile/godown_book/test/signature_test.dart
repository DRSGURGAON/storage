import 'dart:convert';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/subscription/document_type.dart';
import 'package:godown_book/core/tenant/tenant_scope.dart';
import 'package:godown_book/features/signature/models/signature_request_model.dart';
import 'package:godown_book/features/signature/repositories/signature_repository.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

/// A 1x1 transparent PNG - stands in for what the signing page sends.
const _pngBase64 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAY27m/MAAAAASUVORK5CYII=';

class _TempPathProvider extends PathProviderPlatform with MockPlatformInterfaceMixin {
  _TempPathProvider(this.root);

  final String root;

  @override
  Future<String?> getApplicationDocumentsPath() async => root;
}

void main() {
  late Database db;
  late Directory tempDir;
  late FakeFirebaseFirestore firestore;
  final repo = SignatureRepository.instance;

  setUp(() async {
    db = await openTestDatabase();
    tempDir = await Directory.systemTemp.createTemp('godown-signature');
    PathProviderPlatform.instance = _TempPathProvider(tempDir.path);

    firestore = FakeFirebaseFirestore();
    SignatureRepository.firestoreOverride = firestore;
    SignatureRepository.currentUidOverride = 'uid-test';
    SignatureRepository.signBaseUrl = 'https://godown-book.web.app';
  });

  tearDown(() async {
    SignatureRepository.firestoreOverride = null;
    SignatureRepository.currentUidOverride = null;
    SignatureRepository.signBaseUrl = SignatureRepository.defaultSignBaseUrl;
    await db.close();
    await tempDir.delete(recursive: true);
  });

  Future<SignatureRequestModel> ask() => repo.request(
        documentType: DocumentType.storageReceipt,
        documentId: 'storage-1',
        documentNo: 'SR/2026/0001',
        customerName: 'Rajesh Kumar',
        customerPhone: '9876500001',
        title: 'Storage Receipt',
        details: const [
          SignatureDetail('Receipt No.', 'SR/2026/0001'),
          SignatureDetail('Goods', 'Sofa set, 39 cartons'),
        ],
        terms: 'Rent is payable monthly in advance.\nGoods are released against this receipt.',
      );

  test('tokens are long, random and never repeat', () {
    final tokens = {for (var i = 0; i < 200; i++) SignatureRepository.newToken()};
    expect(tokens.length, 200);
    expect(tokens.every((t) => t.length == 32), isTrue);
    expect(tokens.every((t) => RegExp(r'^[A-Za-z0-9]+$').hasMatch(t)), isTrue);
  });

  test('a request publishes what the customer sees, and a link to it', () async {
    final request = await ask();

    expect(request.link, 'https://godown-book.web.app/?t=${request.id}');
    expect(request.status, SignatureStatus.pending);
    expect(request.expiresAt, isNotEmpty);

    final published =
        (await firestore.collection('signatureRequests').doc(request.id).get()).data()!;
    expect(published['customerName'], 'Rajesh Kumar');
    expect(published['documentNo'], 'SR/2026/0001');
    expect(published['status'], 'PENDING');
    expect(published['ownerUid'], 'uid-test');
    expect((published['details'] as List).length, 2);
    expect(published['terms'], contains('monthly in advance'));
    // The signature itself is not there until the customer signs.
    expect(published.containsKey('signature'), isFalse);

    // The operator's own copy is on the device, so the state shows offline.
    final local = await repo.getForDocument(DocumentType.storageReceipt, 'storage-1');
    expect(local.single.id, request.id);
  });

  test('without a signing page configured, no link is made', () async {
    SignatureRepository.signBaseUrl = '';
    await expectLater(ask(), throwsA(isA<SigningNotConfigured>()));
    expect(await repo.getForDocument(DocumentType.storageReceipt, 'storage-1'), isEmpty);
  });

  test('a signature comes back, is saved, and the cloud copy is deleted', () async {
    final request = await ask();

    // The customer signs on the web page.
    await firestore.collection('signatureRequests').doc(request.id).update({
      'status': 'SIGNED',
      'signature': _pngBase64,
      'signerName': 'Rajesh Kumar',
      'signedAt': Timestamp.fromDate(DateTime(2026, 9, 2, 11, 30)),
    });

    final signed = await repo.refresh(request);

    expect(signed.status, SignatureStatus.signed);
    expect(signed.signerName, 'Rajesh Kumar');
    expect(DateTime.parse(signed.signedAt), DateTime(2026, 9, 2, 11, 30));
    expect(await File(signed.signaturePath).exists(), isTrue);
    expect(
      await File(signed.signaturePath).readAsBytes(),
      base64Decode(_pngBase64.split(',').last),
    );

    // The link stops showing the customer's details once it has done
    // its job.
    final cloud = await firestore.collection('signatureRequests').doc(request.id).get();
    expect(cloud.exists, isFalse);

    // And the document can now print it.
    final forPrinting =
        await repo.signedFor(DocumentType.storageReceipt, 'storage-1');
    expect(forPrinting, isNotNull);
    expect(forPrinting!.signerName, 'Rajesh Kumar');
    expect(forPrinting.image.isNotEmpty, isTrue);
  });

  test('nothing is claimed while the customer has not signed', () async {
    final request = await ask();
    final same = await repo.refresh(request);

    expect(same.status, SignatureStatus.pending);
    expect(same.signaturePath, isEmpty);
    expect(await repo.signedFor(DocumentType.storageReceipt, 'storage-1'), isNull);
  });

  test('cancelling kills the link', () async {
    final request = await ask();
    await repo.cancel(request);

    final cloud = await firestore.collection('signatureRequests').doc(request.id).get();
    expect(cloud.exists, isFalse);

    final local = await repo.getForDocument(DocumentType.storageReceipt, 'storage-1');
    expect(local.single.status, SignatureStatus.cancelled);
    expect(await repo.signedFor(DocumentType.storageReceipt, 'storage-1'), isNull);
  });

  test('removing a signature deletes the image with it', () async {
    final request = await ask();
    await firestore.collection('signatureRequests').doc(request.id).update({
      'status': 'SIGNED',
      'signature': _pngBase64,
      'signerName': 'Rajesh Kumar',
      'signedAt': Timestamp.fromDate(DateTime(2026, 9, 2)),
    });
    final signed = await repo.refresh(request);
    final path = signed.signaturePath;

    await repo.delete(signed);

    expect(await File(path).exists(), isFalse);
    expect(await repo.getForDocument(DocumentType.storageReceipt, 'storage-1'), isEmpty);
  });

  test('requests never cross companies', () async {
    await ask();

    TenantScope.set('another-company');
    expect(await repo.getForDocument(DocumentType.storageReceipt, 'storage-1'), isEmpty);
    expect(await repo.signedFor(DocumentType.storageReceipt, 'storage-1'), isNull);
  });
}
