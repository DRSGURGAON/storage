import 'package:flutter/material.dart';

class DocumentPreferencesCard extends StatelessWidget {
  const DocumentPreferencesCard({
    super.key,
    required this.quotationPrefixController,
    required this.bookingPrefixController,
    required this.invoicePrefixController,
    required this.receiptPrefixController,
    required this.releasePrefixController,
    required this.consignmentPrefixController,
    required this.footerController,
    required this.defaultTermsController,
  });

  final TextEditingController quotationPrefixController;
  final TextEditingController bookingPrefixController;
  final TextEditingController invoicePrefixController;
  final TextEditingController receiptPrefixController;
  final TextEditingController releasePrefixController;
  final TextEditingController consignmentPrefixController;
  final TextEditingController footerController;
  final TextEditingController defaultTermsController;

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
                Icon(Icons.description),
                SizedBox(width: 8),
                Text(
                  "Document Preferences",
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
              ],
            ),

            const SizedBox(height: 20),

            TextField(
              controller: quotationPrefixController,
              decoration: const InputDecoration(
                labelText: "Quotation Prefix",
                hintText: "QT",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.request_quote),
              ),
            ),

            const SizedBox(height: 12),

            TextField(
              controller: bookingPrefixController,
              decoration: const InputDecoration(
                labelText: "Storage Receipt Prefix",
                hintText: "SR",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.inventory_2),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: invoicePrefixController,
              decoration: const InputDecoration(
                labelText: "Storage Bill Prefix",
                hintText: "INV",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.receipt_long),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: receiptPrefixController,
              decoration: const InputDecoration(
                labelText: "Payment Receipt Prefix",
                hintText: "MR",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.payments),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: releasePrefixController,
              decoration: const InputDecoration(
                labelText: "Release Record Prefix",
                hintText: "RL",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.local_shipping),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: consignmentPrefixController,
              decoration: const InputDecoration(
                labelText: "Bilty / LR Prefix",
                hintText: "LR",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.fire_truck_outlined),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: footerController,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: "Footer",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.notes),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: defaultTermsController,
              maxLines: 6,
              decoration: const InputDecoration(
                labelText: "Default Terms & Conditions",
                border: OutlineInputBorder(),
                alignLabelWithHint: true,
                prefixIcon: Icon(Icons.gavel),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
