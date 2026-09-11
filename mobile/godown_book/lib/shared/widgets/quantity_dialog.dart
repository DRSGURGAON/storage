import 'package:flutter/material.dart';

class QuantityDialog extends StatefulWidget {
  final String itemName;

  const QuantityDialog({super.key, required this.itemName});

  @override
  State<QuantityDialog> createState() => _QuantityDialogState();
}

class _QuantityDialogState extends State<QuantityDialog> {
  int quantity = 1;

  bool packingRequired = true;
  bool fragile = false;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.itemName),

      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: 10),

          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              IconButton(
                onPressed: () {
                  if (quantity > 1) {
                    setState(() {
                      quantity--;
                    });
                  }
                },
                icon: const Icon(Icons.remove_circle),
              ),

              Text(
                quantity.toString(),
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                ),
              ),

              IconButton(
                onPressed: () {
                  setState(() {
                    quantity++;
                  });
                },
                icon: const Icon(Icons.add_circle),
              ),
            ],
          ),

          const SizedBox(height: 20),

          CheckboxListTile(
            value: packingRequired,
            title: const Text("Packing Required"),
            onChanged: (v) {
              setState(() {
                packingRequired = v!;
              });
            },
          ),

          CheckboxListTile(
            value: fragile,
            title: const Text("Fragile Item"),
            onChanged: (v) {
              setState(() {
                fragile = v!;
              });
            },
          ),
        ],
      ),

      actions: [
        TextButton(
          onPressed: () {
            Navigator.pop(context);
          },
          child: const Text("Cancel"),
        ),

        ElevatedButton(
          onPressed: () {
            Navigator.pop(context, {
              "quantity": quantity,
              "packingRequired": packingRequired,
              "fragile": fragile,
            });
          },
          child: const Text("Add Item"),
        ),
      ],
    );
  }
}
