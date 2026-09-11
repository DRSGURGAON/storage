import 'package:flutter/material.dart';

class BankDetailsCard extends StatelessWidget {
  const BankDetailsCard({
    super.key,
    required this.beneficiaryController,
    required this.bankController,
    required this.branchController,
    required this.accountController,
    required this.ifscController,
  });

  final TextEditingController beneficiaryController;
  final TextEditingController bankController;
  final TextEditingController branchController;
  final TextEditingController accountController;
  final TextEditingController ifscController;

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
                Icon(Icons.account_balance),
                SizedBox(width: 8),
                Text(
                  "Bank Details",
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
              ],
            ),

            const SizedBox(height: 20),

            TextField(
              controller: beneficiaryController,
              decoration: const InputDecoration(
                labelText: "Beneficiary Name",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.person),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: bankController,
              decoration: const InputDecoration(
                labelText: "Bank Name",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.account_balance),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: branchController,
              decoration: const InputDecoration(
                labelText: "Branch Name",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.location_city),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: accountController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: "Account Number",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.credit_card),
              ),
            ),

            const SizedBox(height: 16),

            TextField(
              controller: ifscController,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(
                labelText: "IFSC Code",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.qr_code),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
