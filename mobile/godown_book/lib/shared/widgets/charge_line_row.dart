import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// One charge on a bill or a quotation, typed straight into the row.
///
/// The old way was a card you tapped, a dialog that opened, and four
/// boxes to fill before the amount went in. Now the amount box is on
/// the row itself, the number keyboard is already up, and Next on the
/// keyboard drops into the next row's box - a ten-line quotation is
/// ten numbers and ten taps of Next. The name is still tappable for
/// the details that are rarely needed (quantity, rate, description).
class ChargeLineRow extends StatelessWidget {
  final String name;
  final String? subtitle;
  final TextEditingController amount;

  /// When the amount box should be shown disabled with this text
  /// instead - "Included", "Excluded", "N/A" on a quotation.
  final String? modeLabel;

  /// Chosen from a small menu on the row; null hides the menu.
  final List<(String, String)>? modeOptions;
  final ValueChanged<String>? onModeSelected;

  final ValueChanged<String> onChanged;
  final VoidCallback onDetails;
  final VoidCallback onRemove;
  final bool autofocus;

  const ChargeLineRow({
    super.key,
    required this.name,
    required this.amount,
    required this.onChanged,
    required this.onDetails,
    required this.onRemove,
    this.subtitle,
    this.modeLabel,
    this.modeOptions,
    this.onModeSelected,
    this.autofocus = false,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 4, 0, 4),
        child: Row(
          children: [
            Expanded(
              child: InkWell(
                onTap: onDetails,
                borderRadius: BorderRadius.circular(8),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name,
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                      if (subtitle != null && subtitle!.isNotEmpty)
                        Text(subtitle!,
                            style: const TextStyle(
                                fontSize: 12, color: Colors.black54),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            SizedBox(
              width: 112,
              child: modeLabel != null
                  ? InkWell(
                      onTap: onDetails,
                      child: InputDecorator(
                        decoration: const InputDecoration(
                          isDense: true,
                          contentPadding:
                              EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                        ),
                        child: Text(modeLabel!,
                            style: const TextStyle(color: Colors.black54)),
                      ),
                    )
                  : TextField(
                      controller: amount,
                      autofocus: autofocus,
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      textInputAction: TextInputAction.next,
                      textAlign: TextAlign.right,
                      inputFormatters: [
                        FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
                      ],
                      decoration: const InputDecoration(
                        isDense: true,
                        prefixText: '₹ ',
                        hintText: '0',
                        contentPadding:
                            EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                      ),
                      onChanged: onChanged,
                      onSubmitted: (_) => FocusScope.of(context).nextFocus(),
                    ),
            ),
            if (modeOptions != null)
              PopupMenuButton<String>(
                tooltip: 'How it is quoted',
                icon: const Icon(Icons.more_vert, size: 20),
                onSelected: onModeSelected,
                itemBuilder: (context) => [
                  for (final (value, label) in modeOptions!)
                    PopupMenuItem(value: value, child: Text(label)),
                ],
              ),
            IconButton(
              icon: const Icon(Icons.close, size: 20),
              tooltip: 'Remove',
              onPressed: onRemove,
            ),
          ],
        ),
      ),
    );
  }
}

/// Keeps one amount controller per line id, so the row keeps its
/// cursor and its text while the list around it is rebuilt.
class LineAmountControllers {
  final Map<String, TextEditingController> _byId = {};

  TextEditingController of(String id, double amount) {
    return _byId.putIfAbsent(
      id,
      () => TextEditingController(text: amount == 0 ? '' : _num(amount)),
    );
  }

  /// Puts a value into the box from outside (voice, a details dialog)
  /// without moving a cursor that is somewhere else.
  void set(String id, double amount) {
    final c = _byId[id];
    if (c == null) return;
    final text = amount == 0 ? '' : _num(amount);
    if (c.text != text) c.text = text;
  }

  void remove(String id) => _byId.remove(id)?.dispose();

  void dispose() {
    for (final c in _byId.values) {
      c.dispose();
    }
    _byId.clear();
  }

  static String _num(double v) =>
      v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toString();
}
