import 'package:flutter/material.dart';

class UpiDetailsCard extends StatelessWidget {
  const UpiDetailsCard({
    super.key,
    required this.upi1Controller,
    required this.upi2Controller,
    required this.phonePeController,
    required this.googlePayController,
    required this.paytmController,
  });

  final TextEditingController upi1Controller;
  final TextEditingController upi2Controller;
  final TextEditingController phonePeController;
  final TextEditingController googlePayController;
  final TextEditingController paytmController;

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
                Icon(Icons.qr_code_2),
                SizedBox(width: 8),
                Text(
                  "UPI Details",
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
              ],
            ),

            const SizedBox(height: 20),

            TextField(
              controller: upi1Controller,
              decoration: const InputDecoration(
                labelText: "UPI ID 1",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.account_balance_wallet),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: upi2Controller,
              decoration: const InputDecoration(
                labelText: "UPI ID 2",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.account_balance_wallet),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: phonePeController,
              decoration: const InputDecoration(
                labelText: "PhonePe Number",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.phone_android),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: googlePayController,
              decoration: const InputDecoration(
                labelText: "Google Pay Number",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.phone_android),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: paytmController,
              decoration: const InputDecoration(
                labelText: "Paytm Number",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.phone_android),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
