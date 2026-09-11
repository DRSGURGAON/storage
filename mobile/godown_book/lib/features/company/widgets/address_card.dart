import 'package:flutter/material.dart';

import '../../../shared/widgets/state_autocomplete_field.dart';

class AddressCard extends StatelessWidget {
  const AddressCard({
    super.key,
    required this.addressController,
    required this.cityController,
    required this.stateController,
    required this.pincodeController,
    required this.jurisdictionController,
  });

  final TextEditingController addressController;
  final TextEditingController cityController;
  final TextEditingController stateController;
  final TextEditingController pincodeController;
  final TextEditingController jurisdictionController;

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 2,
      margin: const EdgeInsets.symmetric(vertical: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: const [
                Icon(Icons.location_on),
                SizedBox(width: 8),
                Text(
                  "Address",
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
              ],
            ),

            const SizedBox(height: 20),

            TextField(
              controller: addressController,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: "Complete Address",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.home),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: cityController,
              decoration: const InputDecoration(
                labelText: "City",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.location_city),
              ),
            ),

            const SizedBox(height: 16),

            StateAutocompleteField(
              controller: stateController,
              decoration: const InputDecoration(
                labelText: "State",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.map),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: pincodeController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: "Pincode",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.pin_drop),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: jurisdictionController,
              decoration: const InputDecoration(
                labelText: "Jurisdiction (Optional)",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.account_balance),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
