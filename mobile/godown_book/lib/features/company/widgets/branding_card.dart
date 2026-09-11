import 'dart:io';

import 'package:flutter/material.dart';

/// Logo (uploaded) + Signature (drawn in-app) + Stamp (uploaded).
class BrandingCard extends StatelessWidget {
  const BrandingCard({
    super.key,
    required this.logoPath,
    required this.signaturePath,
    required this.stampPath,
    required this.onLogoTap,
    required this.onSignatureTap,
    required this.onStampTap,
    this.onLogoRemove,
    this.onSignatureRemove,
    this.onStampRemove,
  });

  final String? logoPath;
  final String? signaturePath;
  final String? stampPath;

  final VoidCallback onLogoTap;
  final VoidCallback onSignatureTap;
  final VoidCallback onStampTap;

  /// Null hides the remove button - callers only pass it once something has
  /// actually been picked/drawn, since there's nothing to remove otherwise.
  final VoidCallback? onLogoRemove;
  final VoidCallback? onSignatureRemove;
  final VoidCallback? onStampRemove;

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
                Icon(Icons.palette),
                SizedBox(width: 8),
                Text(
                  "Branding",
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
              ],
            ),

            const SizedBox(height: 24),

            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: _imageBox(
                    title: "Company Logo",
                    imagePath: logoPath,
                    icon: Icons.business,
                    tapLabel: "Tap to Upload",
                    onTap: onLogoTap,
                    onRemove: onLogoRemove,
                  ),
                ),

                const SizedBox(width: 12),

                Expanded(
                  child: _imageBox(
                    title: "Authorised Signature",
                    imagePath: signaturePath,
                    icon: Icons.draw,
                    tapLabel: "Tap to Draw",
                    onTap: onSignatureTap,
                    onRemove: onSignatureRemove,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _imageBox({
    required String title,
    required String? imagePath,
    required IconData icon,
    required String tapLabel,
    required VoidCallback onTap,
    VoidCallback? onRemove,
  }) {
    final hasImage = !(imagePath?.isEmpty ?? true);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            height: 150,
            decoration: BoxDecoration(
              border: Border.all(color: Colors.grey.shade300),
              borderRadius: BorderRadius.circular(12),
            ),
            child: !hasImage
                ? Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(icon, size: 40),
                      const SizedBox(height: 10),
                      Text(title, textAlign: TextAlign.center),
                      const SizedBox(height: 6),
                      Text(tapLabel, style: const TextStyle(fontSize: 12)),
                    ],
                  )
                : ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: Image.file(
                      File(imagePath!),
                      fit: BoxFit.cover,
                      width: double.infinity,
                    ),
                  ),
          ),
        ),
        if (hasImage && onRemove != null) ...[
          const SizedBox(height: 6),
          TextButton.icon(
            onPressed: onRemove,
            icon: const Icon(Icons.delete_outline, size: 18),
            label: const Text("Remove"),
            style: TextButton.styleFrom(
              foregroundColor: Colors.red,
              padding: EdgeInsets.zero,
              minimumSize: const Size(0, 32),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
          ),
        ],
      ],
    );
  }
}
