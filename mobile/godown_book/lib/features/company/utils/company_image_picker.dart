import 'dart:io';
import 'dart:typed_data';

import 'package:image_picker/image_picker.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// Picks/stores the company logo (uploaded) and persists the in-app-drawn
/// signature - both saved to the same location for the same reason.
///
/// image_picker returns a path inside the OS's temporary cache directory,
/// which the OS is free to clear at any time (low storage, app update,
/// routine cleanup) - a path saved there is not guaranteed to survive an
/// app restart. Every picked image is therefore copied into the app's own
/// persistent documents directory before its path is returned, so the
/// path saved in company_settings keeps pointing at a real file. A drawn
/// signature is written to that same directory directly, since it's
/// already in-memory bytes rather than a picked file.
class CompanyImagePicker {
  CompanyImagePicker._();

  static final ImagePicker _picker = ImagePicker();

  static Future<String?> _pickAndPersist(String prefix) async {
    final XFile? file = await _picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 90,
    );

    if (file == null) return null;

    final documentsDir = await getApplicationDocumentsDirectory();
    final companyMediaDir = Directory(p.join(documentsDir.path, 'company'));

    if (!await companyMediaDir.exists()) {
      await companyMediaDir.create(recursive: true);
    }

    final extension = p.extension(file.path);
    final destination = File(
      p.join(
        companyMediaDir.path,
        '$prefix-${DateTime.now().millisecondsSinceEpoch}$extension',
      ),
    );

    await File(file.path).copy(destination.path);

    return destination.path;
  }

  // ==========================
  // Pick Logo
  // ==========================

  static Future<String?> pickLogo() => _pickAndPersist('logo');

  // ==========================
  // Pick Stamp
  // ==========================

  static Future<String?> pickStamp() => _pickAndPersist('stamp');

  // ==========================
  // Save Drawn Signature
  // ==========================

  /// Persists PNG bytes from the in-app signature pad, using the exact
  /// same app documents directory as uploaded images - the storage
  /// mechanism is shared; only the source of the bytes differs (drawn
  /// vs picked from the gallery).
  static Future<String> saveDrawnSignature(Uint8List pngBytes) async {
    final documentsDir = await getApplicationDocumentsDirectory();
    final companyMediaDir = Directory(p.join(documentsDir.path, 'company'));

    if (!await companyMediaDir.exists()) {
      await companyMediaDir.create(recursive: true);
    }

    final destination = File(
      p.join(
        companyMediaDir.path,
        'signature-${DateTime.now().millisecondsSinceEpoch}.png',
      ),
    );

    await destination.writeAsBytes(pngBytes);

    return destination.path;
  }

  // ==========================
  // Delete Image
  // ==========================

  static Future<void> deleteImage(String? path) async {
    if (path == null || path.isEmpty) return;

    final file = File(path);

    if (await file.exists()) {
      await file.delete();
    }
  }
}
