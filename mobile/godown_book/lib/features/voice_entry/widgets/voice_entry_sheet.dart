import 'package:flutter/material.dart';
import 'package:speech_to_text/speech_to_text.dart';

import '../models/voice_reading.dart';

/// What one screen wants read out of a spoken sentence: the example to
/// show, the parser to run, and how to drop the rows the operator
/// unticks. The sheet itself knows nothing about storage or bills.
class VoiceRecipe<T extends VoiceReading> {
  /// What a good sentence sounds like on this screen.
  final String example;

  /// Runs on the phone; no network, no key.
  final T Function(String transcript) parse;

  const VoiceRecipe({required this.example, required this.parse});
}

/// Speak the entry, see exactly what the app understood, then let it
/// fill the form.
///
/// Nothing is saved from here and nothing is sent anywhere: the phone's
/// own recogniser turns speech into words and the screen's own parser
/// turns those words into fields. The operator ticks off what is right
/// before a single box on the form changes.
class VoiceEntrySheet<T extends VoiceReading> extends StatefulWidget {
  final VoiceRecipe<T> recipe;

  const VoiceEntrySheet({super.key, required this.recipe});

  /// Returns what the operator accepted, or null if they backed out.
  static Future<T?> show<T extends VoiceReading>(
    BuildContext context, {
    required VoiceRecipe<T> recipe,
  }) {
    return showModalBottomSheet<T>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => VoiceEntrySheet<T>(recipe: recipe),
    );
  }

  @override
  State<VoiceEntrySheet<T>> createState() => _VoiceEntrySheetState<T>();
}

enum _Stage { idle, listening, review, typing }

class _VoiceEntrySheetState<T extends VoiceReading>
    extends State<VoiceEntrySheet<T>> {
  final _speech = SpeechToText();
  final _typed = TextEditingController();

  _Stage _stage = _Stage.idle;
  bool _ready = false;
  bool _starting = false;
  String _problem = '';
  String _heard = '';
  double _level = 0;
  String _locale = 'hi_IN';

  T? _reading;
  final _accepted = <VoiceFieldKind>{};

  @override
  void initState() {
    super.initState();
    _prepare();
  }

  @override
  void dispose() {
    _speech.cancel();
    _typed.dispose();
    super.dispose();
  }

  Future<void> _prepare() async {
    try {
      final ready = await _speech.initialize(
        onError: (error) {
          if (!mounted) return;
          setState(() {
            _problem = _friendlyError(error.errorMsg);
            if (_stage == _Stage.listening) _stage = _Stage.idle;
          });
        },
        onStatus: (status) {
          if (!mounted) return;
          if (status == 'done' || status == 'notListening') _finishListening();
        },
      );
      if (!mounted) return;
      setState(() {
        _ready = ready;
        if (!ready) {
          _problem = 'Is phone par bolna available nahi hai. Type kar dijiye.';
          _stage = _Stage.typing;
        }
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _ready = false;
        _problem = 'Mic nahi khul paaya. Type kar dijiye.';
        _stage = _Stage.typing;
      });
    }
  }

  static String _friendlyError(String code) {
    if (code.contains('permission')) {
      return 'Mic ki permission chahiye. Settings mein de dijiye.';
    }
    if (code.contains('network')) {
      return 'Is phone ka Hindi recogniser internet maang raha hai.';
    }
    if (code.contains('no_match') || code.contains('speech_timeout')) {
      return 'Kuch sunai nahi diya. Dobara boliye.';
    }
    return 'Sun nahi paaya. Dobara koshish kijiye.';
  }

  Future<void> _startListening() async {
    if (!_ready || _starting) return;
    setState(() {
      _starting = true;
      _problem = '';
      _heard = '';
      _stage = _Stage.listening;
    });
    try {
      await _speech.listen(
        onResult: (result) {
          if (!mounted) return;
          setState(() => _heard = result.recognizedWords);
        },
        onSoundLevelChange: (level) {
          if (!mounted) return;
          setState(() => _level = level);
        },
        listenOptions: SpeechListenOptions(
          localeId: _locale,
          partialResults: true,
          listenMode: ListenMode.dictation,
          cancelOnError: true,
          listenFor: const Duration(seconds: 60),
          pauseFor: const Duration(seconds: 4),
        ),
      );
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _problem = 'Mic nahi khul paaya. Type kar dijiye.';
        _stage = _Stage.typing;
      });
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  void _finishListening() {
    if (_stage != _Stage.listening) return;
    if (_heard.trim().isEmpty) {
      setState(() {
        _stage = _Stage.idle;
        if (_problem.isEmpty) _problem = 'Kuch sunai nahi diya. Dobara boliye.';
      });
      return;
    }
    _readIt(_heard);
  }

  Future<void> _stopListening() async {
    await _speech.stop();
    if (!mounted) return;
    _finishListening();
  }

  void _readIt(String sentence) {
    final reading = widget.recipe.parse(sentence);
    setState(() {
      _reading = reading;
      _accepted
        ..clear()
        ..addAll(reading.fields.map((f) => f.kind));
      _stage = _Stage.review;
    });
  }

  void _again() {
    setState(() {
      _reading = null;
      _heard = '';
      _problem = '';
      _stage = _ready ? _Stage.idle : _Stage.typing;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 12,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 42,
                height: 4,
                decoration: BoxDecoration(
                  color: theme.dividerColor,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Icon(Icons.graphic_eq, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text('Bol kar bhariye',
                      style: theme.textTheme.titleMedium
                          ?.copyWith(fontWeight: FontWeight.bold)),
                ),
                IconButton(
                  tooltip: 'Close',
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            const SizedBox(height: 6),
            ...switch (_stage) {
              _Stage.idle => _idleView(theme),
              _Stage.listening => _listeningView(theme),
              _Stage.review => _reviewView(theme),
              _Stage.typing => _typingView(theme),
            },
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  // ----------------------------------------------------------------- idle

  List<Widget> _idleView(ThemeData theme) => [
        Wrap(
          spacing: 8,
          children: [
            ChoiceChip(
              label: const Text('Hindi'),
              selected: _locale == 'hi_IN',
              onSelected: (_) => setState(() => _locale = 'hi_IN'),
            ),
            ChoiceChip(
              label: const Text('English'),
              selected: _locale == 'en_IN',
              onSelected: (_) => setState(() => _locale = 'en_IN'),
            ),
          ],
        ),
        const SizedBox(height: 18),
        Center(child: _micButton(theme, listening: false)),
        const SizedBox(height: 14),
        Text('Tap kijiye aur ek saath sab bataiye',
            textAlign: TextAlign.center, style: theme.textTheme.bodyMedium),
        const SizedBox(height: 12),
        _exampleCard(theme),
        if (_problem.isNotEmpty) ...[
          const SizedBox(height: 12),
          _problemBar(theme),
        ],
        const SizedBox(height: 12),
        TextButton.icon(
          onPressed: () => setState(() => _stage = _Stage.typing),
          icon: const Icon(Icons.keyboard_outlined),
          label: const Text('Bolne ki jagah type karein'),
        ),
      ];

  // ------------------------------------------------------------ listening

  List<Widget> _listeningView(ThemeData theme) => [
        const SizedBox(height: 10),
        Center(child: _micButton(theme, listening: true)),
        const SizedBox(height: 14),
        Text('Sun raha hoon...',
            textAlign: TextAlign.center,
            style: theme.textTheme.labelLarge
                ?.copyWith(color: theme.colorScheme.primary)),
        const SizedBox(height: 12),
        Container(
          constraints: const BoxConstraints(minHeight: 90),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: theme.colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(
            _heard.isEmpty ? 'Boliye...' : _heard,
            style: theme.textTheme.titleMedium,
          ),
        ),
        const SizedBox(height: 16),
        FilledButton.icon(
          onPressed: _stopListening,
          icon: const Icon(Icons.check),
          label: const Text('Ho gaya'),
        ),
      ];

  // --------------------------------------------------------------- review

  List<Widget> _reviewView(ThemeData theme) {
    final reading = _reading!;
    return [
      Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: theme.colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text('"${reading.transcript}"',
            style: theme.textTheme.bodyMedium
                ?.copyWith(fontStyle: FontStyle.italic)),
      ),
      const SizedBox(height: 16),
      if (reading.fields.isEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Text(
            'Isme se kuch samajh nahi aaya. Thoda dheere, ek ek cheez '
            'bataiye.',
            style: theme.textTheme.bodyMedium,
          ),
        )
      else ...[
        Text('YEH SAMJHA',
            style: theme.textTheme.labelMedium?.copyWith(
              color: theme.colorScheme.primary,
              fontWeight: FontWeight.bold,
              letterSpacing: 0.5,
            )),
        const SizedBox(height: 4),
        for (final field in reading.fields)
          CheckboxListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: _accepted.contains(field.kind),
            title: Text(field.label),
            subtitle: Text(field.display,
                style: theme.textTheme.bodyLarge
                    ?.copyWith(fontWeight: FontWeight.w600)),
            onChanged: (on) => setState(() {
              if (on == true) {
                _accepted.add(field.kind);
              } else {
                _accepted.remove(field.kind);
              }
            }),
          ),
        const SizedBox(height: 6),
        Text('Galat hai to tick hata dijiye - form mein sirf tick wale '
            'jaayenge, aur wahan bhi badal sakte hain.',
            style: theme.textTheme.bodySmall),
      ],
      const SizedBox(height: 18),
      Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: _again,
              icon: const Icon(Icons.refresh),
              label: const Text('Dobara'),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: FilledButton.icon(
              onPressed: _accepted.isEmpty
                  ? null
                  : () => Navigator.of(context)
                      .pop(reading.keeping(_accepted) as T),
              icon: const Icon(Icons.edit_note),
              label: const Text('Form bharo'),
            ),
          ),
        ],
      ),
    ];
  }

  // --------------------------------------------------------------- typing

  List<Widget> _typingView(ThemeData theme) => [
        if (_problem.isNotEmpty) ...[
          _problemBar(theme),
          const SizedBox(height: 12),
        ],
        TextField(
          controller: _typed,
          autofocus: true,
          maxLines: 4,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(
            labelText: 'Poori baat ek line mein likhiye',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        _exampleCard(theme),
        const SizedBox(height: 16),
        Row(
          children: [
            if (_ready)
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => setState(() => _stage = _Stage.idle),
                  icon: const Icon(Icons.mic_none),
                  label: const Text('Bol kar'),
                ),
              ),
            if (_ready) const SizedBox(width: 12),
            Expanded(
              child: FilledButton.icon(
                onPressed: () {
                  final text = _typed.text.trim();
                  if (text.isEmpty) return;
                  _readIt(text);
                },
                icon: const Icon(Icons.auto_fix_high),
                label: const Text('Samjho'),
              ),
            ),
          ],
        ),
      ];

  // ---------------------------------------------------------------- parts

  Widget _micButton(ThemeData theme, {required bool listening}) {
    // The ring grows with how loud the room is, so the operator can see
    // the phone is actually hearing them.
    final loudness = listening ? (_level.abs().clamp(0, 10) / 10) : 0.0;
    return GestureDetector(
      onTap: listening ? _stopListening : _startListening,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 120),
        width: 116 + loudness * 22,
        height: 116 + loudness * 22,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: listening
              ? theme.colorScheme.primary
              : theme.colorScheme.primaryContainer,
        ),
        child: Icon(
          listening ? Icons.stop : Icons.mic,
          size: 52,
          color: listening
              ? theme.colorScheme.onPrimary
              : theme.colorScheme.onPrimaryContainer,
        ),
      ),
    );
  }

  Widget _exampleCard(ThemeData theme) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          border: Border.all(color: theme.dividerColor),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('AISE BOLIYE',
                style: theme.textTheme.labelSmall?.copyWith(
                    letterSpacing: 0.5, fontWeight: FontWeight.bold)),
            const SizedBox(height: 6),
            Text(widget.recipe.example, style: theme.textTheme.bodyMedium),
          ],
        ),
      );

  Widget _problemBar(ThemeData theme) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: theme.colorScheme.errorContainer,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          children: [
            Icon(Icons.info_outline,
                size: 18, color: theme.colorScheme.onErrorContainer),
            const SizedBox(width: 8),
            Expanded(
              child: Text(_problem,
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onErrorContainer)),
            ),
          ],
        ),
      );
}
