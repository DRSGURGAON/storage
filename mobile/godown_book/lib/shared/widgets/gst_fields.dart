import 'package:flutter/material.dart';

/// How the tax on a bill or quotation is split.
///
/// [auto] follows the customer's state: same state as the company is
/// CGST + SGST, a different one is IGST. The other two are for the
/// customer whose state is missing or wrong on the record.
enum GstSplit {
  auto('Auto (by state)'),
  intra('CGST + SGST'),
  inter('IGST');

  const GstSplit(this.label);

  final String label;

  /// null = decide by the customer's state.
  bool? get interState => switch (this) {
        GstSplit.auto => null,
        GstSplit.intra => false,
        GstSplit.inter => true,
      };

  /// What a saved document was printed with, for its edit form.
  static GstSplit fromAmounts({required double cgst, required double igst}) {
    if (igst > 0) return GstSplit.inter;
    if (cgst > 0) return GstSplit.intra;
    return GstSplit.auto;
  }
}

/// The GST % picker: the slabs a warehouse charges (0, 5, 18, 40), plus
/// whatever an older document was saved with, so editing it never
/// changes its rate behind the owner's back.
///
/// Backed by the form's existing text controller, so voice fill and
/// saving keep working unchanged.
class GstRateField extends StatelessWidget {
  const GstRateField({
    super.key,
    required this.controller,
    required this.decoration,
    this.onChanged,
  });

  final TextEditingController controller;
  final InputDecoration decoration;
  final VoidCallback? onChanged;

  static const slabs = <double>[0, 5, 18, 40];

  static String _label(double rate) =>
      rate == rate.roundToDouble() ? rate.toStringAsFixed(0) : '$rate';

  @override
  Widget build(BuildContext context) {
    final current =
        double.tryParse(controller.text.trim().replaceAll(',', '')) ?? 0;
    final rates = [
      ...slabs,
      if (!slabs.contains(current)) current,
    ]..sort();

    return DropdownButtonFormField<double>(
      // A new key when the text changes from outside (voice fill, a
      // loaded draft), so the picker shows it.
      key: ValueKey('gst-rate-$current'),
      initialValue: current,
      isExpanded: true,
      decoration: decoration,
      items: [
        for (final rate in rates)
          DropdownMenuItem(
            value: rate,
            child: Text(rate == 0 ? 'No GST' : '${_label(rate)}%'),
          ),
      ],
      onChanged: (rate) {
        if (rate == null) return;
        controller.text = rate == 0 ? '' : _label(rate);
        onChanged?.call();
      },
    );
  }
}

/// The CGST + SGST / IGST choice, shown once a GST rate is picked.
class GstSplitField extends StatelessWidget {
  const GstSplitField({
    super.key,
    required this.value,
    required this.onChanged,
  });

  final GstSplit value;
  final ValueChanged<GstSplit> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<GstSplit>(
      key: ValueKey('gst-split-${value.name}'),
      initialValue: value,
      isExpanded: true,
      decoration: const InputDecoration(labelText: 'GST type'),
      items: [
        for (final split in GstSplit.values)
          DropdownMenuItem(value: split, child: Text(split.label)),
      ],
      onChanged: (split) {
        if (split != null) onChanged(split);
      },
    );
  }
}
