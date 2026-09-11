import 'package:flutter/material.dart';

class LegalInformationCard extends StatelessWidget {
  const LegalInformationCard({
    super.key,
    required this.gstController,
    required this.panController,
    required this.msmeController,
    required this.isoController,
  });

  final TextEditingController gstController;
  final TextEditingController panController;
  final TextEditingController msmeController;
  final TextEditingController isoController;

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
            const Row(
              children: [
                Icon(Icons.gavel),
                SizedBox(width: 8),
                Text(
                  "Legal Information",
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
              ],
            ),

            const SizedBox(height: 20),

            TextField(
              controller: gstController,
              decoration: const InputDecoration(
                labelText: "GST Number",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.receipt_long),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: panController,
              decoration: const InputDecoration(
                labelText: "PAN Number",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.badge),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: msmeController,
              decoration: const InputDecoration(
                labelText: "MSME Number",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.business_center),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: isoController,
              decoration: const InputDecoration(
                labelText: "ISO Certificate",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.verified),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
