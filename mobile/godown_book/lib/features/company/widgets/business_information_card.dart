import 'dart:io';

import 'package:flutter/material.dart';

class BusinessInformationCard extends StatelessWidget {
  const BusinessInformationCard({
    super.key,
    required this.companyNameController,
    required this.tagLineController,
    required this.affiliatedByController,
    required this.websiteController,
    required this.onLogoTap,
    this.logoPath,
  });

  final TextEditingController companyNameController;
  final TextEditingController tagLineController;
  final TextEditingController affiliatedByController;
  final TextEditingController websiteController;

  final VoidCallback onLogoTap;

  /// The company's own currently-selected logo file path, if any -
  /// genuinely displayed in the avatar below (this previously always
  /// showed just the camera icon regardless of whether a logo had
  /// been picked, since this parameter didn't exist).
  final String? logoPath;

  @override
  Widget build(BuildContext context) {
    final hasLogo = logoPath != null && logoPath!.isNotEmpty;

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
                Icon(Icons.business),
                SizedBox(width: 8),
                Text(
                  "Business Information",
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
              ],
            ),

            const SizedBox(height: 20),

            Center(
              child: GestureDetector(
                onTap: onLogoTap,
                child: CircleAvatar(
                  radius: 45,
                  // Padded so the full logo genuinely fits inside the
                  // circle - BoxFit.contain (not .cover) means nothing
                  // gets cropped, only letterboxed if the aspect ratio
                  // doesn't match a perfect circle.
                  child: hasLogo
                      ? ClipOval(
                          child: Padding(
                            padding: const EdgeInsets.all(6),
                            child: Image.file(
                              File(logoPath!),
                              fit: BoxFit.contain,
                              errorBuilder: (context, error, stackTrace) =>
                                  const Icon(Icons.add_a_photo),
                            ),
                          ),
                        )
                      : const Icon(Icons.add_a_photo),
                ),
              ),
            ),

            const SizedBox(height: 20),

            TextField(
              controller: companyNameController,
              decoration: const InputDecoration(
                labelText: "Company Name *",
                border: OutlineInputBorder(),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: tagLineController,
              decoration: const InputDecoration(
                labelText: "Tag Line",
                border: OutlineInputBorder(),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: affiliatedByController,
              decoration: const InputDecoration(
                labelText: "Affiliated By",
                border: OutlineInputBorder(),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: websiteController,
              decoration: const InputDecoration(
                labelText: "Website",
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
