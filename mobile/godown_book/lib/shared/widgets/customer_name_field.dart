import 'package:flutter/material.dart';

import '../../core/customer/customer_lookup_service.dart';

/// A customer-name field that suggests people already recorded in this
/// company's Customer master or on earlier Warehouse Receipts and Bills -
/// so the same depositor typed last month comes back when their next
/// receipt or bill is raised, instead of being re-typed from scratch.
///
/// Picking a suggestion calls [onSelected] with everything known about
/// that customer; the form decides which of its own fields to fill.
/// Nothing is auto-filled without the user explicitly choosing a
/// suggestion - typing a name that merely resembles an old one never
/// silently overwrites what they are entering.
class CustomerNameField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final ValueChanged<CustomerSuggestion> onSelected;

  const CustomerNameField({
    super.key,
    required this.controller,
    required this.label,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    return Autocomplete<CustomerSuggestion>(
      // Seeded from the controller so an existing value (editing an
      // already-saved document) shows up rather than an empty box.
      initialValue: TextEditingValue(text: controller.text),
      displayStringForOption: (option) => option.name,
      optionsBuilder: (value) =>
          CustomerLookupService.instance.search(value.text),
      onSelected: (option) {
        controller.text = option.name;
        onSelected(option);
      },
      fieldViewBuilder: (context, textController, focusNode, onSubmitted) {
        // Keep the caller's own controller in step with what is typed,
        // so the form's save path reads the right value whether or not
        // a suggestion was ever picked.
        textController.addListener(() {
          if (controller.text != textController.text) {
            controller.text = textController.text;
          }
        });

        return TextField(
          controller: textController,
          focusNode: focusNode,
          onSubmitted: (_) => onSubmitted(),
          decoration: InputDecoration(labelText: label),
        );
      },
      optionsViewBuilder: (context, onSelectedOption, options) {
        return Align(
          alignment: Alignment.topLeft,
          child: Material(
            elevation: 4,
            borderRadius: BorderRadius.circular(12),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 260),
              child: ListView.builder(
                shrinkWrap: true,
                padding: EdgeInsets.zero,
                itemCount: options.length,
                itemBuilder: (context, index) {
                  final option = options.elementAt(index);

                  return ListTile(
                    dense: true,
                    leading: const Icon(Icons.person_outline, size: 20),
                    title: Text(option.name),
                    subtitle: option.subtitle.isEmpty
                        ? null
                        : Text(
                            option.subtitle,
                            style: const TextStyle(fontSize: 12),
                          ),
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
