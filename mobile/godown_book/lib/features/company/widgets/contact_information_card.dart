import 'package:flutter/material.dart';

class ContactInformationCard extends StatelessWidget {
  const ContactInformationCard({
    super.key,
    required this.mobile1Controller,
    required this.mobile2Controller,
    required this.mobile3Controller,
    required this.mobile4Controller,
    required this.whatsappController,
    required this.landlineController,
    required this.emailController,
  });

  final TextEditingController mobile1Controller;
  final TextEditingController mobile2Controller;
  final TextEditingController mobile3Controller;
  final TextEditingController mobile4Controller;
  final TextEditingController whatsappController;
  final TextEditingController landlineController;
  final TextEditingController emailController;

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
                Icon(Icons.phone),
                SizedBox(width: 8),
                Text(
                  "Contact Information",
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
              ],
            ),

            const SizedBox(height: 20),

            TextField(
              controller: mobile1Controller,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: "Mobile Number 1 *",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.phone_android),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: mobile2Controller,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: "Mobile Number 2",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.phone_android),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: mobile3Controller,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: "Mobile Number 3",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.phone_android),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: mobile4Controller,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: "Mobile Number 4",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.phone_android),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: whatsappController,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: "WhatsApp Number",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.chat),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: landlineController,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: "Landline",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.call),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: emailController,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(
                labelText: "Email Address",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.email),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
