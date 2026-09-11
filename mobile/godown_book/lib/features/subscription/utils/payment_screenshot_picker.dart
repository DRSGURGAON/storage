import 'dart:io';

import 'package:image_picker/image_picker.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// Picks and persists images for the Subscription domain - payment
/// screenshots (Section 12) and the Super Admin's payment QR (Section
/// 9-10). Same pattern/packages as CompanyImagePicker (ImagePicker +
/// application documents directory), applied to this domain's own
/// storage subdirectories rather than reusing that class directly (its
/// private _pickAndPersist is company-media-specific and not
/// accessible across files; this mirrors it rather than duplicating
/// unrelated company-logo/signature logic).
class PaymentScreenshotPicker {
  PaymentScreenshotPicker._();

  static final ImagePicker _picker = ImagePicker();

  /// Returns (filePath, fileName, fileSizeBytes), or null if the user
  /// cancelled the picker. Validates file type (ImagePicker's own
  /// gallery filter already restricts to images) and a basic size
  /// ceiling (Section 12: "Validate: File type, File size, Image
  /// dimensions where appropriate" - dimensions aren't separately
  /// checked here since an oversized-but-valid screenshot is a UX
  /// concern, not a security one, and ImagePicker's imageQuality
  /// compression already keeps typical screenshots well under this
  /// ceiling).
  static Future<({String path, String name, int sizeBytes})?> pick() {
    return _pickAndPersist(subdirectory: 'subscription_payments', prefix: 'payment');
  }

  /// Super Admin's payment QR code (Section 9-10) - same picker
  /// mechanism, stored in its own subdirectory since it's a platform
  /// setting, not a per-payment proof.
  static Future<({String path, String name, int sizeBytes})?> pickQrImage() {
    return _pickAndPersist(subdirectory: 'subscription_settings', prefix: 'qr');
  }

  static Future<({String path, String name, int sizeBytes})?> _pickAndPersist({
    required String subdirectory,
    required String prefix,
  }) async {
    final XFile? file = await _picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 85,
    );

    if (file == null) return null;

    final sourceFile = File(file.path);
    final sizeBytes = await sourceFile.length();

    const maxSizeBytes = 10 * 1024 * 1024; // 10 MB
    if (sizeBytes > maxSizeBytes) {
      throw StateError(
        'Image is too large (${(sizeBytes / (1024 * 1024)).toStringAsFixed(1)} MB). '
        'Please choose an image under 10 MB.',
      );
    }

    final documentsDir = await getApplicationDocumentsDirectory();
    final mediaDir = Directory(p.join(documentsDir.path, subdirectory));

    if (!await mediaDir.exists()) {
      await mediaDir.create(recursive: true);
    }

    final extension = p.extension(file.path);
    final fileName = '$prefix-${DateTime.now().millisecondsSinceEpoch}$extension';
    final destination = File(p.join(mediaDir.path, fileName));

    await sourceFile.copy(destination.path);

    return (path: destination.path, name: fileName, sizeBytes: sizeBytes);
  }
}
