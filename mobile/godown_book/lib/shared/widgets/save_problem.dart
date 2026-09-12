import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// What every form shows when a save throws.
///
/// A snackbar is gone in four seconds and cannot be copied, which is
/// how "it does not save" reaches support with nothing to go on. This
/// stays until dismissed, shows the actual error, and copies it in one
/// tap, so the next report carries the one line that explains it.
Future<void> showSaveProblem(BuildContext context, Object error) {
  final text = error.toString();

  return showDialog<void>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      icon: const Icon(Icons.error_outline, size: 36),
      title: const Text('Could not save'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Nothing was saved. If this keeps happening, copy the message '
            'below and send it to support.',
          ),
          const SizedBox(height: 12),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Theme.of(dialogContext).colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(10),
            ),
            child: SelectableText(
              text,
              style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
            ),
          ),
        ],
      ),
      actions: [
        TextButton.icon(
          onPressed: () async {
            await Clipboard.setData(ClipboardData(text: text));
            if (!dialogContext.mounted) return;
            ScaffoldMessenger.of(dialogContext).showSnackBar(
              const SnackBar(content: Text('Copied')),
            );
          },
          icon: const Icon(Icons.copy, size: 18),
          label: const Text('Copy'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(dialogContext).pop(),
          style: FilledButton.styleFrom(minimumSize: const Size(80, 40)),
          child: const Text('OK'),
        ),
      ],
    ),
  );
}
