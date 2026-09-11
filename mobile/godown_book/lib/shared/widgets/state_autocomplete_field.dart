import 'package:flutter/material.dart';

import '../../core/constants/indian_states.dart';

/// A State text field that suggests genuine Indian states/UTs as soon
/// as the user types 2-3 characters - e.g. typing "guj" suggests
/// "Gujarat". Matches on ANY part of the name, not just the start
/// (so "pradesh" genuinely surfaces Andhra Pradesh/Arunachal Pradesh/
/// Himachal Pradesh/Madhya Pradesh/Uttar Pradesh together), since a
/// user is just as likely to start typing from a state's second word.
///
/// Purely a convenience - the field stays a normal free-text
/// TextField underneath, so a state genuinely not on the list (a typo
/// correction, or a name entered before the list existed) can still
/// be typed and saved exactly as before. Nothing is auto-filled
/// without the user explicitly picking a suggestion.
class StateAutocompleteField extends StatelessWidget {
  final TextEditingController controller;
  final String label;

  /// Optional decoration override - when omitted, defaults to a plain
  /// InputDecoration(labelText: label), matching every other TextField
  /// in this app's own forms. Some screens (e.g. Company Onboarding)
  /// use an explicit OutlineInputBorder for visual consistency with
  /// their own surrounding fields - this lets them keep that.
  final InputDecoration? decoration;

  const StateAutocompleteField({
    super.key,
    required this.controller,
    this.label = 'State',
    this.decoration,
  });

  @override
  Widget build(BuildContext context) {
    return Autocomplete<String>(
      initialValue: TextEditingValue(text: controller.text),
      optionsBuilder: (value) {
        final query = value.text.trim().toLowerCase();

        // Suggestions appear once the user has typed a couple of
        // characters - an empty/1-character query would surface
        // nearly every state at once, which isn't a genuinely useful
        // suggestion list.
        if (query.length < 2) return const Iterable<String>.empty();

        return kIndianStatesAndUnionTerritories.where(
          (state) => state.toLowerCase().contains(query),
        );
      },
      onSelected: (selected) => controller.text = selected,
      fieldViewBuilder: (context, textController, focusNode, onSubmitted) {
        // Keeps the caller's own controller in step with what's typed,
        // exactly like CustomerNameField's own established pattern -
        // so the form's save path reads the right value whether or
        // not a suggestion was ever picked.
        textController.addListener(() {
          if (controller.text != textController.text) {
            controller.text = textController.text;
          }
        });

        return TextField(
          controller: textController,
          focusNode: focusNode,
          onSubmitted: (_) => onSubmitted(),
          textCapitalization: TextCapitalization.words,
          decoration: decoration ?? InputDecoration(labelText: label),
        );
      },
      optionsViewBuilder: (context, onSelectedOption, options) {
        return Align(
          alignment: Alignment.topLeft,
          child: Material(
            elevation: 4,
            borderRadius: BorderRadius.circular(12),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 220),
              child: ListView.builder(
                shrinkWrap: true,
                padding: EdgeInsets.zero,
                itemCount: options.length,
                itemBuilder: (context, index) {
                  final option = options.elementAt(index);

                  return ListTile(
                    dense: true,
                    title: Text(option),
                    onTap: () => onSelectedOption(option),
                  );
                },
              ),
            ),
          ),
        );
      },
    );
  }
}
