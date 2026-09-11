import 'package:flutter/material.dart';

/// The single shared "really delete this?" dialog used by every
/// document list's Delete action (and matching PdfActionsMenu's own
/// confirm on the PDF screens) - same wording and shape everywhere.
///
/// Returns true only when the user explicitly confirmed.
Future<bool> confirmDelete(
  BuildContext context, {
  required String what,
  String? warning,
}) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text('Delete $what?'),
      content: Text(
        warning ??
            'This $what will be permanently deleted. This cannot be undone.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: const Text('Cancel'),
        ),
        TextButton(
          style: TextButton.styleFrom(
            foregroundColor: Theme.of(dialogContext).colorScheme.error,
          ),
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: const Text('Delete'),
        ),
      ],
    ),
  );

  return confirmed == true;
}
