import 'dart:io';

import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

/// Saves a generated PDF where the user can find it.
///
/// On Android the file goes into the phone's public **Downloads**
/// folder (through the native channel - MediaStore, no permission
/// prompt on Android 10+), so it shows up in the Files app and the
/// gallery's Downloads. The old "Save PDF" wrote into the app's own
/// hidden folder, which no file manager can open.
///
/// If the native save is refused (Android 9 and older without the
/// storage permission, or any OEM quirk) it falls back to the app's own
/// folder and says so - the download never silently does nothing.
class PdfDownload {
  PdfDownload._();

  static const MethodChannel _channel =
      MethodChannel('com.drs.godownbook/file_share');

  /// Returns a short, human-readable place the file ended up, e.g.
  /// "Downloads/Bill-2026-0007.pdf".
  static Future<String> save(Uint8List bytes, String fileName) async {
    final cache = await getTemporaryDirectory();
    final temp = File('${cache.path}/$fileName');
    await temp.writeAsBytes(bytes, flush: true);

    if (Platform.isAndroid) {
      try {
        final saved = await _channel.invokeMethod<String>(
          'saveFileToDownloads',
          {
            'filePath': temp.path,
            'fileName': fileName,
            'mimeType': 'application/pdf',
          },
        );
        if (saved != null && saved.isNotEmpty) return saved;
      } catch (_) {
        // fall through to the app folder below
      }
    }

    Directory? dir;
    if (Platform.isAndroid) dir = await getExternalStorageDirectory();
    dir ??= await getApplicationDocumentsDirectory();

    final folder = Directory('${dir.path}/StorageBill Pro Documents');
    if (!await folder.exists()) await folder.create(recursive: true);

    final file = File('${folder.path}/$fileName');
    await file.writeAsBytes(bytes);
    return file.path;
  }
}
