import 'package:flutter/material.dart';

class MasterListScreen extends StatelessWidget {
  final String title;
  final Widget body;
  final VoidCallback onAdd;

  const MasterListScreen({
    super.key,
    required this.title,
    required this.body,
    required this.onAdd,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      floatingActionButton: FloatingActionButton(
        onPressed: onAdd,
        child: const Icon(Icons.add),
      ),
      body: body,
    );
  }
}
