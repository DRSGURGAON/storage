import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../features/company/controllers/company_controller.dart';
import '../../features/company/models/company_model.dart';
import '../tenant/tenant_scope.dart';
import '../utils/number_format.dart';

/// Which of the owner's messages.
enum WhatsAppMessageKind { document, payment, followUp, storageEnd }

/// The WhatsApp messages the app pre-fills, in the owner's own words and
/// language (Settings > WhatsApp Messages) - as in Bill N Bilty.
///
/// Four messages: one sent with any document, a payment reminder, a
/// quotation follow-up, and a "storage period is over" reminder.
/// Placeholders like {name} are filled per document. A line whose
/// placeholders are all empty is left out, so "Pay by UPI: {upi}"
/// disappears when no UPI ID is set.
///
/// Saved per company on this phone and kept in memory, so list screens
/// build messages without waiting.
class WhatsAppTemplates {
  WhatsAppTemplates._();

  static final WhatsAppTemplates instance = WhatsAppTemplates._();

  static const placeholders = <WhatsAppMessageKind, Map<String, String>>{
    WhatsAppMessageKind.document: {
      '{name}': 'Customer name',
      '{document}': 'Document (Bill, Storage Receipt...)',
      '{number}': 'Document number',
      '{amount}': 'Amount',
      '{company}': 'Your company name',
      '{phone}': 'Your phone number',
    },
    WhatsAppMessageKind.payment: {
      '{name}': 'Customer name',
      '{number}': 'Bill number',
      '{balance}': 'Amount pending',
      '{total}': 'Bill total',
      '{due_date}': 'Due date',
      '{upi}': 'Your UPI ID',
      '{company}': 'Your company name',
      '{phone}': 'Your phone number',
    },
    WhatsAppMessageKind.followUp: {
      '{name}': 'Customer name',
      '{number}': 'Quotation number',
      '{amount}': 'Amount',
      '{company}': 'Your company name',
      '{phone}': 'Your phone number',
    },
    WhatsAppMessageKind.storageEnd: {
      '{name}': 'Customer name',
      '{booking}': 'Storage number',
      '{end_date}': 'Agreed end date',
      '{company}': 'Your company name',
      '{phone}': 'Your phone number',
    },
  };

  static const defaults = <WhatsAppMessageKind, String>{
    WhatsAppMessageKind.document: 'Dear {name},\n'
        '\n'
        'Sharing your {document} {number}.\n'
        'Amount: Rs. {amount}\n'
        '\n'
        'For any questions, call us at {phone}.\n'
        '\n'
        'Thank you,\n'
        '{company}',
    WhatsAppMessageKind.payment: 'Dear {name},\n'
        '\n'
        'This is a gentle reminder that Rs. {balance} is pending with us.\n'
        'Bill No: {number}\n'
        'Bill total: Rs. {total}\n'
        'Due date: {due_date}\n'
        '\n'
        'You can pay by UPI: {upi}\n'
        '\n'
        'Please ignore if already paid.\n'
        '\n'
        'Thank you,\n'
        '{company}\n'
        '{phone}',
    WhatsAppMessageKind.followUp: 'Dear {name},\n'
        '\n'
        'Hope you are doing well. This is regarding our quotation {number} '
        'for storing your goods.\n'
        'Amount: Rs. {amount}\n'
        '\n'
        'Please let us know if you have any questions, or share the date '
        'you would like to bring the goods and we will keep the space '
        'ready for you.\n'
        '\n'
        'Thank you,\n'
        '{company}\n'
        '{phone}',
    WhatsAppMessageKind.storageEnd: 'Dear {name},\n'
        '\n'
        'The agreed storage period for your goods (storage {booking}) '
        'ended on {end_date}.\n'
        '\n'
        'Please let us know whether you would like to extend the storage '
        'or collect your goods.\n'
        '\n'
        'Thank you,\n'
        '{company}\n'
        '{phone}',
  };

  static String label(WhatsAppMessageKind kind) => switch (kind) {
        WhatsAppMessageKind.document => 'With a document',
        WhatsAppMessageKind.payment => 'Payment reminder',
        WhatsAppMessageKind.followUp => 'Quotation follow-up',
        WhatsAppMessageKind.storageEnd => 'Storage period over',
      };

  final Map<WhatsAppMessageKind, String> _saved = {};
  CompanyModel? _company;

  String template(WhatsAppMessageKind kind) => _saved[kind] ?? defaults[kind]!;

  String _key(WhatsAppMessageKind kind) =>
      'wa_template.${kind.name}.${TenantScope.companyIdOrNull ?? ''}';

  /// Reads this company's saved messages and details. Cheap; called on
  /// every dashboard load so a company switch is picked up.
  Future<void> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      _saved.clear();
      for (final kind in WhatsAppMessageKind.values) {
        final text = prefs.getString(_key(kind));
        if (text != null && text.trim().isNotEmpty) _saved[kind] = text;
      }
      _company = await CompanyController.instance.getCompany();
    } catch (error) {
      debugPrint('WhatsApp templates not loaded: $error');
    }
  }

  /// Saves the owner's messages; an empty text means "use the default".
  Future<void> save(Map<WhatsAppMessageKind, String> messages) async {
    final prefs = await SharedPreferences.getInstance();
    for (final entry in messages.entries) {
      if (entry.value.trim().isEmpty ||
          entry.value.trim() == defaults[entry.key]!.trim()) {
        await prefs.remove(_key(entry.key));
      } else {
        await prefs.setString(_key(entry.key), entry.value);
      }
    }
    await load();
  }

  /// The message sent with a document.
  String document({
    required String name,
    required String document,
    String number = '',
    double? amount,
  }) =>
      fill(template(WhatsAppMessageKind.document), {
        '{name}': name.trim(),
        '{document}': document,
        '{number}': number.trim(),
        '{amount}': amount == null || amount <= 0 ? '' : formatAmount(amount),
        ..._companyValues(),
      });

  /// The payment reminder for one bill (or a customer's total).
  String paymentReminder({
    required String name,
    String number = '',
    required double balance,
    double? total,
    String dueDate = '',
  }) {
    final company = _company;
    final upi = company == null
        ? ''
        : (company.upiId1.trim().isNotEmpty
            ? company.upiId1.trim()
            : company.upiId2.trim());
    return fill(template(WhatsAppMessageKind.payment), {
      '{name}': name.trim(),
      '{number}': number.trim(),
      '{balance}': formatAmount(balance),
      '{total}': total == null || total <= 0 ? '' : formatAmount(total),
      '{due_date}': _date(dueDate),
      '{upi}': upi,
      ..._companyValues(),
    });
  }

  /// The quotation follow-up.
  String followUp({required String name, String number = '', double? amount}) =>
      fill(template(WhatsAppMessageKind.followUp), {
        '{name}': name.trim(),
        '{number}': number.trim(),
        '{amount}': amount == null || amount <= 0 ? '' : formatAmount(amount),
        ..._companyValues(),
      });

  /// Storage past its agreed end date.
  String storageEnd({
    required String name,
    String booking = '',
    String endDate = '',
  }) =>
      fill(template(WhatsAppMessageKind.storageEnd), {
        '{name}': name.trim(),
        '{booking}': booking.trim(),
        '{end_date}': _date(endDate),
        ..._companyValues(),
      });

  /// A sample of [template], for the Settings preview.
  static String preview(WhatsAppMessageKind kind, String template) => fill(template, {
        '{name}': 'Rajesh Kumar',
        '{document}': 'Storage Bill',
        '{number}': kind == WhatsAppMessageKind.followUp ? 'QT/26-27/014' : 'SB/26-27/031',
        '{amount}': '12,500',
        '{balance}': '7,500',
        '{total}': '12,500',
        '{due_date}': '20-10-2026',
        '{upi}': 'yourname@upi',
        '{booking}': 'ST/26-27/008',
        '{end_date}': '30-09-2026',
        '{company}': 'Your Company',
        '{phone}': '98XXXXXX10',
      });

  Map<String, String> _companyValues() => {
        '{company}': _company?.companyName.trim() ?? '',
        '{phone}': _company?.mobile1.trim() ?? '',
      };

  static String _date(String iso) {
    final d = DateTime.tryParse(iso);
    if (d == null) return '';
    return '${d.day.toString().padLeft(2, '0')}-'
        '${d.month.toString().padLeft(2, '0')}-${d.year}';
  }

  /// 125000 -> 1,25,000 (whole rupees).
  static String formatAmount(double value) {
    final money = formatMoney(value.roundToDouble());
    return money.substring(0, money.length - 3);
  }

  /// Replaces every placeholder. A line that had placeholders, all of
  /// them empty, is dropped; leftover double spaces are tidied.
  static String fill(String template, Map<String, String> values) {
    final lines = <String>[];

    for (final line in template.split('\n')) {
      var used = 0;
      var empty = 0;
      var result = line;
      values.forEach((key, value) {
        if (!result.contains(key)) return;
        used++;
        if (value.isEmpty) empty++;
        result = result.replaceAll(key, value);
      });

      if (used > 0 && used == empty) continue;

      lines.add(
        result
            .replaceAll(RegExp(r' {2,}'), ' ')
            .replaceAllMapped(RegExp(r' +([.,)])'), (m) => m.group(1)!)
            .trimRight(),
      );
    }

    return lines.join('\n').replaceAll(RegExp(r'\n{3,}'), '\n\n').trim();
  }
}
