import 'dart:io';

import 'package:image_picker/image_picker.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// Picks and persists KYC identity-document photos - mirrors
/// PaymentScreenshotPicker's exact pattern (ImagePicker -> copy into
/// the application documents directory), with a much tighter size
/// ceiling because these images travel to Firestore base64-encoded
/// inside a single document (1 MB hard limit for the whole doc, and
/// there are two images) - see KycSubmissionModel's own doc comment.
class KycDocumentPicker {
  KycDocumentPicker._();

  static final ImagePicker _picker = ImagePicker();

  /// 300 KB per image: base64 inflates by ~4/3, so two images stay
  /// around 800 KB combined - safely inside Firestore's 1 MB document
  /// limit with room for the metadata fields.
  static const int maxSizeBytes = 300 * 1024;

  /// Returns (filePath, fileName, fileSizeBytes), or null if the user
  /// cancelled. The 1280px/70% downscale keeps a typical phone photo
  /// of a card comfortably under the ceiling while staying perfectly
  /// readable; a photo that still exceeds it is rejected with a clear
  /// message rather than silently truncated.
  static Future<({String path, String name, int sizeBytes})?> pick({
    required String prefix,
  }) async {
    final XFile? file = await _picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 1280,
      maxHeight: 1280,
      imageQuality: 70,
    );

    if (file == null) return null;

    final sourceFile = File(file.path);
    final sizeBytes = await sourceFile.length();

    if (sizeBytes > maxSizeBytes) {
      throw StateError(
        'Image is too large (${(sizeBytes / 1024).toStringAsFixed(0)} KB). '
        'Please choose a photo under 300 KB - a normal photo of the '
        'card, not a scanned high-resolution file.',
      );
    }

    final documentsDir = await getApplicationDocumentsDirectory();
    final mediaDir = Directory(p.join(documentsDir.path, 'kyc_documents'));

    if (!await mediaDir.exists()) {
      await mediaDir.create(recursive: true);
    }

    final extension = p.extension(file.path);
    final fileName =
        '$prefix-${DateTime.now().millisecondsSinceEpoch}$extension';
    final destination = File(p.join(mediaDir.path, fileName));

    await sourceFile.copy(destination.path);

    return (path: destination.path, name: fileName, sizeBytes: sizeBytes);
  }
}
