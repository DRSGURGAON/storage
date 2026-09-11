import 'dart:io';

import 'package:flutter/material.dart';

class LivePreviewCard extends StatelessWidget {
  const LivePreviewCard({
    super.key,
    required this.companyName,
    required this.address,
    required this.mobile,
    required this.email,
    required this.website,
    required this.gst,
    required this.logoPath,
  });

  final String companyName;
  final String address;
  final String mobile;
  final String email;
  final String website;
  final String gst;
  final String? logoPath;

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 3,
      margin: const EdgeInsets.symmetric(vertical: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.preview),
                SizedBox(width: 8),
                Text(
                  "Live Letterhead Preview",
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
                ),
              ],
            ),

            const SizedBox(height: 20),

            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Colors.grey.shade50,
                border: Border.all(color: Colors.grey.shade300),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                children: [
                  if (logoPath != null && logoPath!.isNotEmpty)
                    Image.file(File(logoPath!), height: 70)
                  else
                    const Icon(Icons.business, size: 60),

                  const SizedBox(height: 12),

                  Text(
                    companyName.isEmpty ? "YOUR COMPANY NAME" : companyName,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                    ),
                  ),

                  const SizedBox(height: 8),

                  Text(
                    address.isEmpty ? "Company Address" : address,
                    textAlign: TextAlign.center,
                  ),

                  const SizedBox(height: 8),

                  Text(mobile.isEmpty ? "Mobile Number" : mobile),

                  if (email.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(email),
                    ),

                  if (website.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(website),
                    ),

                  const SizedBox(height: 10),

                  if (gst.isNotEmpty)
                    Text(
                      "GSTIN : $gst",
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),

                  const Divider(height: 30),

                  const Text(
                    "Premium Packers & Movers Services",
                    style: TextStyle(fontWeight: FontWeight.w600),
                  ),

                  const SizedBox(height: 6),

                  Text(
                    "This preview will appear on Warehouse Receipt, Rent Bill, Money Receipt and Delivery Order.",
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.grey.shade600, fontSize: 12),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
