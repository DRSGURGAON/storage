import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

import '../contact/contact_launcher.dart' show WhatsAppApp;
import 'xlsx_writer.dart';

/// "Excel" on a report: save the .xlsx into Downloads, or send it on
/// WhatsApp / by email (the CA usually asks on one of them), or through
/// any app in the share sheet. Native side: MainActivity's file_share
/// channel.
class ExcelShare {
  ExcelShare._();

  static const MethodChannel _channel =
      MethodChannel('com.drs.godownbook/file_share');

  static Future<String> _temp(Uint8List bytes, String fileName) async {
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/$fileName');
    await file.writeAsBytes(bytes, flush: true);
    return file.path;
  }

  /// Saves into Downloads; returns where it went.
  static Future<String> save(Uint8List bytes, String fileName) async {
    final temp = await _temp(bytes, fileName);
    if (Platform.isAndroid) {
      try {
        final saved = await _channel.invokeMethod<String>(
          'saveFileToDownloads',
          {
            'filePath': temp,
            'fileName': fileName,
            'mimeType': XlsxWriter.mimeType,
          },
        );
        if (saved != null && saved.isNotEmpty) return saved;
      } catch (_) {
        // Falls through to the app's own folder below.
      }
    }
    Directory? dir;
    if (Platform.isAndroid) dir = await getExternalStorageDirectory();
    dir ??= await getApplicationDocumentsDirectory();
    final folder = Directory('${dir.path}/StorageBill Reports');
    if (!await folder.exists()) await folder.create(recursive: true);
    final file = File('${folder.path}/$fileName');
    await file.writeAsBytes(bytes);
    return file.path;
  }

  /// Sends the file to [package], or to the share sheet when null.
  /// False when that app is not installed or the share failed.
  static Future<bool> _share(
    Uint8List bytes,
    String fileName, {
    String? package,
    String subject = '',
  }) async {
    if (!Platform.isAndroid) return false;
    try {
      final path = await _temp(bytes, fileName);
      await _channel.invokeMethod<bool>('shareFile', {
        'filePath': path,
        'mimeType': XlsxWriter.mimeType,
        'targetPackage': package,
        'subject': subject,
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Bottom sheet: Save / WhatsApp / WhatsApp Business / Email / Other.
  static Future<void> showActions(
    BuildContext context, {
    required Uint8List Function() build,
    required String fileName,
    required String subject,
  }) async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheet) {
        Widget tile(String value, IconData icon, Color color, String title,
                String subtitle) =>
            ListTile(
              leading: Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, color: color, size: 22),
              ),
              title: Text(title),
              subtitle: Text(subtitle),
              onTap: () => Navigator.pop(sheet, value),
            );
        return SafeArea(
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
                  child: Row(
                    children: [
                      const Icon(Icons.table_view_outlined,
                          color: Color(0xff1D7044)),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          fileName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 15, fontWeight: FontWeight.w700),
                        ),
                      ),
                    ],
                  ),
                ),
                tile('save', Icons.download_outlined, const Color(0xff1E6FD9),
                    'Save to Downloads', 'Open it later from the Files app'),
                tile('wa', Icons.chat_outlined, const Color(0xff128C4A),
                    'Send on WhatsApp', 'Attach the Excel file in a chat'),
                tile('wab', Icons.storefront_outlined, const Color(0xff128C4A),
                    'Send on WhatsApp Business', 'Same, from the Business app'),
                tile('mail', Icons.mail_outline, const Color(0xffD64545),
                    'Send by Email', 'Opens Gmail with the file attached'),
                tile('other', Icons.share_outlined, const Color(0xff4B5A6E),
                    'Other apps', 'Drive, Telegram and more'),
                const SizedBox(height: 8),
              ],
            ),
          ),
        );
      },
    );
    if (choice == null || !context.mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    void toast(String text) => messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
          SnackBar(content: Text(text), duration: const Duration(seconds: 4)));

    try {
      final bytes = build();
      if (choice == 'save') {
        toast('Saved: ${await save(bytes, fileName)}');
        return;
      }
      final package = switch (choice) {
        'wa' => WhatsAppApp.personal.androidPackage,
        'wab' => WhatsAppApp.business.androidPackage,
        'mail' => 'com.google.android.gm',
        _ => null,
      };
      final sent =
          await _share(bytes, fileName, package: package, subject: subject);
      if (!sent) {
        final where = await save(bytes, fileName);
        toast('That app could not be opened - the file is saved: $where');
      }
    } catch (_) {
      toast('Could not create the Excel file. Please try again.');
    }
  }
}
