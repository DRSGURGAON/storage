import 'package:flutter/material.dart';

import '../../core/contact/contact_launcher.dart';

/// One action inside [DocumentActionsSheet].
class DocumentAction {
  final IconData icon;
  final String label;

  /// Shown under the label - what this action actually does, when the
  /// label alone could be ambiguous. Null for self-explanatory ones.
  final String? subtitle;

  final Color? color;
  final VoidCallback onTap;

  /// Destructive actions (Delete) are grouped last and shown in red,
  /// so a mis-tap next to a routine action is less likely.
  final bool isDestructive;

  const DocumentAction({
    required this.icon,
    required this.label,
    this.subtitle,
    this.color,
    required this.onTap,
    this.isDestructive = false,
  });
}

/// A single, shared "what do you want to do with this document?" sheet,
/// opened from any document list (Warehouse Receipt, Delivery Order, Bill,
/// Packing List, Money Receipt, Vehicle Condition, Loading Slip).
///
/// Exists so every document behaves identically: the same actions in
/// the same order with the same wording, rather than each list screen
/// growing its own slightly-different panel. Screens pass only the
/// actions that genuinely apply to their own document - nothing is
/// shown that would lead to a dead end.
class DocumentActionsSheet {
  DocumentActionsSheet._();

  /// [title]/[subtitle] identify which record's actions these are, so
  /// the sheet is never ambiguous when several similar rows exist.
  ///
  /// [customerPhone] enables the Call/WhatsApp actions - omitted
  /// entirely (not shown greyed out) when the record genuinely has no
  /// phone number on file, since a disabled button that can never
  /// become enabled is just noise.
  static Future<void> show(
    BuildContext context, {
    required String title,
    String subtitle = '',
    String customerPhone = '',
    String whatsAppMessage = '',
    required List<DocumentAction> actions,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheetContext) {
        final contactActions = <DocumentAction>[
          if (customerPhone.trim().isNotEmpty) ...[
            DocumentAction(
              icon: Icons.call,
              label: 'Call Customer',
              subtitle: customerPhone,
              color: Theme.of(context).colorScheme.primaryContainer,
              onTap: () => ContactLauncher.call(customerPhone),
            ),
            DocumentAction(
              icon: Icons.chat,
              label: 'Send on WhatsApp',
              subtitle: 'Opens the chat with a ready message',
              color: const Color(0xff25D366),
              onTap: () => ContactLauncher.openWhatsAppWithChoice(
                context,
                customerPhone,
                message: whatsAppMessage,
              ),
            ),
          ],
        ];

        final routine =
            actions.where((a) => !a.isDestructive).toList();
        final destructive =
            actions.where((a) => a.isDestructive).toList();

        return SafeArea(
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 2),
                  child: Text(
                    title,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                if (subtitle.trim().isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 0, 20, 4),
                    child: Text(
                      subtitle,
                      style: const TextStyle(fontSize: 13, color: Colors.grey),
                    ),
                  ),
                const SizedBox(height: 8),

                for (final action in routine)
                  _tile(sheetContext, action),

                if (contactActions.isNotEmpty) ...[
                  const Divider(height: 20),
                  for (final action in contactActions)
                    _tile(sheetContext, action),
                ],

                if (destructive.isNotEmpty) ...[
                  const Divider(height: 20),
                  for (final action in destructive)
                    _tile(sheetContext, action),
                ],

                const SizedBox(height: 12),
              ],
            ),
          ),
        );
      },
    );
  }

  static Widget _tile(BuildContext sheetContext, DocumentAction action) {
    final color = action.isDestructive
        ? Colors.red.shade700
        : (action.color ?? Theme.of(sheetContext).colorScheme.primary);

    return ListTile(
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          shape: BoxShape.circle,
        ),
        child: Icon(action.icon, color: color, size: 20),
      ),
      title: Text(
        action.label,
        style: TextStyle(
          fontWeight: FontWeight.w600,
          color: action.isDestructive ? color : null,
        ),
      ),
      subtitle: action.subtitle == null
          ? null
          : Text(
              action.subtitle!,
              style: const TextStyle(fontSize: 12),
            ),
      trailing: const Icon(Icons.chevron_right),
      onTap: () {
        // Close the sheet first, then run the action - otherwise an
        // action that itself opens a screen or dialog would be doing
        // so from behind a sheet that is still on top of it.
        Navigator.pop(sheetContext);
        action.onTap();
      },
    );
  }
}
