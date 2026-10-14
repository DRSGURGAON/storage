import 'package:flutter/material.dart';

import '../../../core/contact/whatsapp_templates.dart';

/// Settings > WhatsApp Messages: the owner writes, in any language, the
/// messages the app pre-fills - with a document, a payment reminder, a
/// quotation follow-up and "storage period over". Tapping a placeholder
/// inserts it at the cursor; the preview shows sample details filled in.
class WhatsAppMessagesScreen extends StatefulWidget {
  const WhatsAppMessagesScreen({super.key});

  @override
  State<WhatsAppMessagesScreen> createState() => _WhatsAppMessagesScreenState();
}

class _WhatsAppMessagesScreenState extends State<WhatsAppMessagesScreen> {
  final _controllers = {
    for (final kind in WhatsAppMessageKind.values) kind: TextEditingController(),
  };
  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    await WhatsAppTemplates.instance.load();
    if (!mounted) return;
    setState(() {
      for (final kind in WhatsAppMessageKind.values) {
        _controllers[kind]!.text = WhatsAppTemplates.instance.template(kind);
      }
      _loading = false;
    });
  }

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await WhatsAppTemplates.instance.save({
        for (final kind in WhatsAppMessageKind.values)
          kind: _controllers[kind]!.text,
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('WhatsApp messages saved')),
      );
      Navigator.of(context).maybePop();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Could not save: $e')));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _insert(TextEditingController controller, String placeholder) {
    final selection = controller.selection;
    final text = controller.text;
    final start = selection.isValid ? selection.start : text.length;
    final end = selection.isValid ? selection.end : text.length;
    controller.value = TextEditingValue(
      text: text.replaceRange(start, end, placeholder),
      selection: TextSelection.collapsed(offset: start + placeholder.length),
    );
    setState(() {});
  }

  Widget _editor(WhatsAppMessageKind kind) {
    final controller = _controllers[kind]!;
    final placeholders = WhatsAppTemplates.placeholders[kind]!;
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(WhatsAppTemplates.label(kind),
                      style: const TextStyle(
                          fontSize: 15, fontWeight: FontWeight.w700)),
                ),
                TextButton(
                  onPressed: () => setState(() =>
                      controller.text = WhatsAppTemplates.defaults[kind]!),
                  child: const Text('Reset'),
                ),
              ],
            ),
            const SizedBox(height: 6),
            TextField(
              controller: controller,
              maxLines: null,
              minLines: 6,
              keyboardType: TextInputType.multiline,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                hintText: 'Write the message in your own words',
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final entry in placeholders.entries)
                  Tooltip(
                    message: entry.value,
                    child: ActionChip(
                      label: Text(entry.key),
                      onPressed: () => _insert(controller, entry.key),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 10),
            const Text('Preview',
                style: TextStyle(fontSize: 12, color: Colors.black54)),
            const SizedBox(height: 4),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xffE7F8EE),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                WhatsAppTemplates.preview(kind, controller.text),
                style: const TextStyle(fontSize: 13),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('WhatsApp Messages')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 100),
              children: [
                const Padding(
                  padding: EdgeInsets.fromLTRB(4, 0, 4, 12),
                  child: Text(
                    'Write these in your own words and language - Hindi, '
                    'Hinglish or English. Tap a placeholder to insert it; '
                    'a line whose details are empty is left out '
                    'automatically.',
                    style: TextStyle(fontSize: 12.5, color: Colors.black54),
                  ),
                ),
                for (final kind in WhatsAppMessageKind.values) _editor(kind),
              ],
            ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: FilledButton(
            onPressed: _loading || _saving ? null : _save,
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)),
            child: Text(_saving ? 'Saving...' : 'Save Messages'),
          ),
        ),
      ),
    );
  }
}
