import 'package:flutter/material.dart';

/// Asks "Discard changes?" when the user goes back (back button, swipe,
/// app-bar arrow) from a form whose text has been changed.
///
/// The texts of every field are remembered the first time the user
/// focuses a field - by then the form has loaded its data - and compared
/// on back. A form closing itself after a save (Navigator.pop / go /
/// pushReplacement) is not affected. Only typed text is compared;
/// dropdowns and switches are not.
class UnsavedChangesGuard extends StatefulWidget {
  const UnsavedChangesGuard({super.key, required this.child});

  final Widget child;

  @override
  State<UnsavedChangesGuard> createState() => _UnsavedChangesGuardState();
}

class _UnsavedChangesGuardState extends State<UnsavedChangesGuard> {
  Map<TextEditingController, String>? _snapshot;

  List<TextEditingController> _controllers() {
    final found = <TextEditingController>[];
    void visit(Element element) {
      final widget = element.widget;
      if (widget is EditableText) found.add(widget.controller);
      element.visitChildren(visit);
    }

    context.visitChildElements(visit);
    return found;
  }

  void _onFocusChange(bool hasFocus) {
    if (hasFocus && _snapshot == null) {
      _snapshot = {for (final c in _controllers()) c: c.text};
    }
  }

  bool get _changed {
    final snapshot = _snapshot;
    if (snapshot == null) return false;
    for (final c in _controllers()) {
      final before = snapshot[c];
      if (before == null) {
        if (c.text.trim().isNotEmpty) return true;
      } else if (before != c.text) {
        return true;
      }
    }
    return false;
  }

  Future<void> _onPop(bool didPop, Object? result) async {
    if (didPop) return;
    final navigator = Navigator.of(context);
    if (!_changed) {
      navigator.pop(result);
      return;
    }
    final discard = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Discard changes?'),
        content: const Text(
          'You have changes that are not saved. Leave without saving?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Keep editing'),
          ),
          TextButton(
            style: TextButton.styleFrom(
              foregroundColor: Theme.of(dialogContext).colorScheme.error,
            ),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Discard'),
          ),
        ],
      ),
    );
    if (discard == true && mounted) navigator.pop(result);
  }

  @override
  Widget build(BuildContext context) {
    return PopScope<Object?>(
      canPop: false,
      onPopInvokedWithResult: _onPop,
      child: Focus(
        canRequestFocus: false,
        skipTraversal: true,
        onFocusChange: _onFocusChange,
        child: widget.child,
      ),
    );
  }
}
