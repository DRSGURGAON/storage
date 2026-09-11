import 'dart:io';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// Which WhatsApp app a chat should open in.
enum WhatsAppApp {
  personal('WhatsApp', 'com.whatsapp'),
  business('WhatsApp Business', 'com.whatsapp.w4b');

  final String label;

  /// Android package id. Targeting the package explicitly is the only
  /// reliable way to send a chat to WhatsApp Business specifically -
  /// a plain wa.me/whatsapp:// link goes to whichever app the system
  /// picked as default, which is usually personal WhatsApp.
  final String androidPackage;

  const WhatsAppApp(this.label, this.androidPackage);
}

/// Opens phone and WhatsApp conversations.
///
/// Exists because the previous inline implementation failed for three
/// separate reasons, all fixed here:
///
///  1. NO COUNTRY CODE. wa.me requires the full international number
///     in digits only. A stored "9876543210" produced wa.me/9876543210,
///     which WhatsApp cannot resolve to an account - the single most
///     common cause of a dead click-to-chat link.
///  2. ANDROID 11+ PACKAGE VISIBILITY. canLaunchUrl() returns false
///     for an app that is not declared in the manifest's `<queries>`
///     block, even when that app is installed. The button then did
///     nothing at all, silently. (The manifest now declares them.)
///  3. NO APP CHOICE. A user with both WhatsApp and WhatsApp Business
///     had no way to say which one to open the chat in.
class ContactLauncher {
  ContactLauncher._();

  /// Default country code used when a stored number has no country
  /// code of its own. India, matching this app's own domestic
  /// Packers & Movers use, and the same default the documents assume
  /// ("Country: India").
  static const String defaultCountryCode = '91';

  /// Normalises a stored number into the digits-only international
  /// form wa.me requires.
  ///
  /// Handles the two shapes that genuinely appear in this app's data:
  /// "+91 70428 89134" (already has a country code) and "7042889134"
  /// (bare 10-digit local number). A leading trunk zero is dropped -
  /// international format never includes it.
  static String normalise(String raw) {
    var digits = raw.replaceAll(RegExp(r'[^0-9]'), '');

    if (digits.isEmpty) return '';

    // Drop a domestic trunk prefix before deciding about the country
    // code, so "07042889134" is treated as the 10-digit number it is.
    if (digits.length == 11 && digits.startsWith('0')) {
      digits = digits.substring(1);
    }

    // Exactly 10 digits means a bare local number - prepend the
    // country code. Anything longer already carries one.
    if (digits.length == 10) {
      return '$defaultCountryCode$digits';
    }

    return digits;
  }

  /// Opens the phone dialer. Uses `tel:` rather than placing the call
  /// directly, so the user still confirms - an app should never dial
  /// on its own.
  static Future<bool> call(String number) async {
    final digits = number.replaceAll(RegExp(r'[^0-9+]'), '');
    if (digits.isEmpty) return false;

    final uri = Uri.parse('tel:$digits');

    try {
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      return false;
    }
  }

  /// Opens a WhatsApp chat with [number] in [app].
  ///
  /// On Android an `intent://` URI pinned to the app's own package is
  /// tried first - that is what genuinely forces WhatsApp Business
  /// rather than personal WhatsApp. If that fails (app not installed,
  /// or iOS, where package targeting does not exist) it falls back to
  /// the universal wa.me link, which opens whichever WhatsApp is
  /// available or the browser.
  static Future<bool> openWhatsApp(
    String number, {
    WhatsAppApp app = WhatsAppApp.personal,
    String message = '',
  }) async {
    final phone = normalise(number);
    if (phone.isEmpty) return false;

    final text = message.trim().isEmpty
        ? ''
        : '?text=${Uri.encodeComponent(message.trim())}';

    if (Platform.isAndroid) {
      final intentUri = Uri.parse(
        'intent://send/$phone#Intent;scheme=smsto;'
        'package=${app.androidPackage};'
        'action=android.intent.action.SENDTO;end',
      );

      try {
        final opened = await launchUrl(
          intentUri,
          mode: LaunchMode.externalApplication,
        );
        if (opened) return true;
      } catch (_) {
        // That app is not installed - fall through to wa.me below
        // rather than leaving the user with a dead button.
      }
    }

    final webUri = Uri.parse('https://wa.me/$phone$text');

    try {
      return await launchUrl(webUri, mode: LaunchMode.externalApplication);
    } catch (_) {
      return false;
    }
  }

  /// Asks which WhatsApp to use, then opens the chat.
  ///
  /// Always asks rather than trying to detect what is installed:
  /// Android's package-visibility rules make "is WhatsApp Business
  /// installed" unreliable to answer from inside the app, and a
  /// silently-wrong guess is worse than one extra tap.
  static Future<void> openWhatsAppWithChoice(
    BuildContext context,
    String number, {
    String message = '',
  }) async {
    final choice = await showModalBottomSheet<WhatsAppApp>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(20, 0, 20, 4),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    'Open chat in',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
              const Padding(
                padding: EdgeInsets.fromLTRB(20, 0, 20, 8),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    'Choose which WhatsApp app to use.',
                    style: TextStyle(fontSize: 13, color: Colors.grey),
                  ),
                ),
              ),
              for (final app in WhatsAppApp.values)
                ListTile(
                  leading: Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: const Color(0xff25D366).withValues(alpha: 0.12),
                      shape: BoxShape.circle,
                    ),
                    padding: const EdgeInsets.all(8),
                    child: Image.asset('assets/images/whatsapp_icon.png'),
                  ),
                  title: Text(app.label),
                  subtitle: Text(
                    app == WhatsAppApp.personal
                        ? 'Your regular WhatsApp account'
                        : 'Your business WhatsApp account',
                    style: const TextStyle(fontSize: 12),
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.pop(sheetContext, app),
                ),
              const SizedBox(height: 8),
            ],
          ),
        );
      },
    );

    if (choice == null) return;
    if (!context.mounted) return;

    final opened = await openWhatsApp(number, app: choice, message: message);

    if (!opened && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open ${choice.label}.')),
      );
    }
  }
}
