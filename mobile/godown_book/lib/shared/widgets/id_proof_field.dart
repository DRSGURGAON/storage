import 'package:flutter/material.dart';

import '../../core/constants/id_proof_types.dart';

/// "Which ID did they show, and what is its number" - a dropdown of the
/// documents people actually carry, plus the number beside it. Only when
/// "Other" is chosen does anyone have to type the name of a document.
///
/// Controlled by its parent: the parent holds the selected [type] and
/// the two controllers, so it can seed them from a saved record and read
/// them back on save.
class IdProofField extends StatelessWidget {
  /// A value from [IdProofTypes.values], or '' when nothing is chosen.
  final String type;
  final ValueChanged<String> onTypeChanged;

  final TextEditingController numberController;

  /// Holds the document's name while [type] is [IdProofTypes.other].
  final TextEditingController customTypeController;

  final String typeLabel;
  final String numberLabel;

  /// The handover paper outlines every field; the forms do not.
  final bool outlined;

  const IdProofField({
    super.key,
    required this.type,
    required this.onTypeChanged,
    required this.numberController,
    required this.customTypeController,
    this.typeLabel = 'ID proof',
    this.numberLabel = 'ID number',
    this.outlined = false,
  });

  InputDecoration _decoration(String label, {String? hint}) => InputDecoration(
        labelText: label,
        hintText: hint,
        border: outlined ? const OutlineInputBorder() : null,
      );

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: DropdownButtonFormField<String>(
                initialValue: type.isEmpty ? null : type,
                isExpanded: true,
                decoration: _decoration(typeLabel),
                hint: const Text('Choose'),
                items: [
                  for (final value in IdProofTypes.values)
                    DropdownMenuItem(
                      value: value,
                      child: Text(value, overflow: TextOverflow.ellipsis),
                    ),
                ],
                onChanged: (value) => onTypeChanged(value ?? ''),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextField(
                controller: numberController,
                textCapitalization: TextCapitalization.characters,
                decoration: _decoration(numberLabel),
              ),
            ),
          ],
        ),
        if (type == IdProofTypes.other) ...[
          const SizedBox(height: 12),
          TextField(
            controller: customTypeController,
            textCapitalization: TextCapitalization.words,
            decoration: _decoration(
              'Which document?',
              hint: 'Army ID, CGHS card, company ID...',
            ),
          ),
        ],
      ],
    );
  }
}
