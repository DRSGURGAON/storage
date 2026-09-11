import 'dart:io';

import 'package:flutter/material.dart';

class ImagePickerTile extends StatelessWidget {
  const ImagePickerTile({
    super.key,
    required this.title,
    required this.icon,
    required this.imagePath,
    required this.onTap,
    this.height = 150,
  });

  final String title;
  final IconData icon;
  final String? imagePath;
  final VoidCallback onTap;
  final double height;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Container(
        height: height,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: Colors.grey.shade300),
        ),
        child: imagePath == null || imagePath!.isEmpty
            ? Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(icon, size: 40, color: Theme.of(context).primaryColor),
                  const SizedBox(height: 10),
                  Text(
                    title,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    "Tap to Upload",
                    style: TextStyle(fontSize: 12, color: Colors.grey),
                  ),
                ],
              )
            : ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: Image.file(
                  File(imagePath!),
                  width: double.infinity,
                  height: height,
                  fit: BoxFit.cover,
                ),
              ),
      ),
    );
  }
}
