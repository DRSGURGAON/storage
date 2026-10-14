import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:printing/printing.dart';

import '../contact/contact_launcher.dart';

/// Sends a PDF straight into the WhatsApp the owner picks - WhatsApp or
/// WhatsApp Business - with their message as the caption, and, when the
/// customer's number is known, into that customer's chat.
///
/// Android only (MainActivity's file_share channel pins the share to
/// the chosen app's package). Elsewhere, or if the native share fails,
/// it falls back to the normal share sheet so the button never does
/// nothing.
class WhatsAppPdfShare {
  WhatsAppPdfShare._();

  static const MethodChannel _channel =
      MethodChannel('com.drs.godownbook/file_share');

  /// Returns false when [app] is not installed.
  static Future<bool> share(
    Uint8List bytes, {
    required String fileName,
    required WhatsAppApp app,
    String message = '',
    String phone = '',
  }) async {
    if (!Platform.isAndroid) {
      await Printing.sharePdf(
        bytes: bytes,
        filename: fileName,
        body: message.trim().isEmpty ? null : message.trim(),
      );
      return true;
    }

    final cache = await getTemporaryDirectory();
    final file = File('${cache.path}/$fileName');
    await file.writeAsBytes(bytes, flush: true);

    final number = ContactLauncher.normalise(phone);
    try {
      final sent = await _channel.invokeMethod<bool>('shareFile', {
        'filePath': file.path,
        'mimeType': 'application/pdf',
        'targetPackage': app.androidPackage,
        'text': message.trim(),
        if (number.isNotEmpty) 'phone': number,
      });
      return sent == true;
    } on PlatformException catch (e) {
      if (e.code == 'APP_NOT_FOUND') return false;
      rethrow;
    }
  }

  /// Asks WhatsApp or WhatsApp Business, then sends.
  static Future<void> shareWithChoice(
    BuildContext context,
    Uint8List bytes, {
    required String fileName,
    String message = '',
    String phone = '',
  }) async {
    final app = await ContactLauncher.pickWhatsApp(
      context,
      title: 'Send PDF with',
      subtitle: 'Choose which WhatsApp app to send this PDF from.',
    );
    if (app == null || !context.mounted) return;

    final sent = await share(
      bytes,
      fileName: fileName,
      app: app,
      message: message,
      phone: phone,
    );
    if (!sent && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${app.label} is not installed.')),
      );
    }
  }
}
