import 'package:flutter/material.dart';

class MasterDialog extends StatelessWidget {
  final String title;
  final Widget child;
  final VoidCallback? onSave;
  final bool saving;
  final String saveText;

  const MasterDialog({
    super.key,
    required this.title,
    required this.child,
    required this.onSave,
    this.saving = false,
    this.saveText = "Save",
  });

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(title),

      content: child,

      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text("Cancel"),
        ),

        ElevatedButton(
          onPressed: saving ? null : onSave,
          child: saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(saveText),
        ),
      ],
    );
  }
}
