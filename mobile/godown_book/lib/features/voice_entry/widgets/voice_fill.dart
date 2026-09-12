import 'package:flutter/material.dart';

import '../models/voice_reading.dart';

/// The bits every form needs once it can be filled by voice: which
/// boxes the voice touched, the tint that says so, and dropping that
/// tint the moment the operator corrects the box themselves.
///
/// Nothing here saves anything. The tint is the whole point - the
/// operator has to be able to see, at a glance, what they said and what
/// they typed, before they tap Save.
mixin VoiceFill<T extends StatefulWidget> on State<T> {
  final Set<VoiceFieldKind> voiceFilled = {};

  /// The customer field seeds its autocomplete from the initial value,
  /// so it needs a fresh key before it will show a name voice put there.
  int nameSeed = 0;

  bool cameFromVoice(VoiceFieldKind kind) => voiceFilled.contains(kind);

  void markVoice(Iterable<VoiceField> fields) {
    voiceFilled.addAll(fields.map((f) => f.kind));
  }

  void typedOver(VoiceFieldKind kind) {
    if (!voiceFilled.contains(kind)) return;
    setState(() => voiceFilled.remove(kind));
  }

  /// The label plus the tint that says "your voice put this here".
  InputDecoration voiceDecoration(
    String label,
    VoiceFieldKind kind, {
    String? hintText,
    String? prefixText,
  }) {
    final touched = voiceFilled.contains(kind);
    return InputDecoration(
      labelText: label,
      hintText: hintText,
      prefixText: prefixText,
      filled: touched,
      fillColor: touched
          ? Theme.of(context)
              .colorScheme
              .primaryContainer
              .withValues(alpha: 0.45)
          : null,
    );
  }

  void announceVoice(int count) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('$count cheez bhar di. Dekh lijiye, phir Save.')),
    );
  }
}
