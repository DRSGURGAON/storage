import 'package:flutter/material.dart';

class CompanyTextControllers {
  // ==========================
  // Business
  // ==========================

  final companyName = TextEditingController();
  final tagLine = TextEditingController();
  final affiliatedBy = TextEditingController();
  final authorizedSignatoryName = TextEditingController();

  // ==========================
  // Contact
  // ==========================

  final mobile1 = TextEditingController();
  final mobile2 = TextEditingController();
  final mobile3 = TextEditingController();
  final mobile4 = TextEditingController();

  final whatsapp = TextEditingController();
  final landline = TextEditingController();

  final email = TextEditingController();
  final website = TextEditingController();

  // ==========================
  // Address
  // ==========================

  final address = TextEditingController();
  final city = TextEditingController();
  final state = TextEditingController();
  final pincode = TextEditingController();
  final jurisdiction = TextEditingController();

  // ==========================
  // Legal
  // ==========================

  final gst = TextEditingController();
  final pan = TextEditingController();
  final msme = TextEditingController();
  final iso = TextEditingController();

  // ==========================
  // Bank
  // ==========================

  final beneficiary = TextEditingController();
  final bank = TextEditingController();
  final branch = TextEditingController();
  final account = TextEditingController();
  final ifsc = TextEditingController();

  // ==========================
  // UPI
  // ==========================

  final upi1 = TextEditingController();
  final upi2 = TextEditingController();
  final phonePe = TextEditingController();
  final googlePay = TextEditingController();
  final paytm = TextEditingController();

  // ==========================
  // Documents
  // ==========================

  final bookingPrefix = TextEditingController();
  final invoicePrefix = TextEditingController();
  final receiptPrefix = TextEditingController();
  final releasePrefix = TextEditingController();

  final defaultTerms = TextEditingController();
  final footer = TextEditingController();

  void dispose() {
    companyName.dispose();
    tagLine.dispose();
    affiliatedBy.dispose();

    mobile1.dispose();
    mobile2.dispose();
    mobile3.dispose();
    mobile4.dispose();

    whatsapp.dispose();
    landline.dispose();

    email.dispose();
    website.dispose();

    address.dispose();
    city.dispose();
    state.dispose();
    pincode.dispose();
    jurisdiction.dispose();

    gst.dispose();
    pan.dispose();
    msme.dispose();
    iso.dispose();

    beneficiary.dispose();
    bank.dispose();
    branch.dispose();
    account.dispose();
    ifsc.dispose();

    upi1.dispose();
    upi2.dispose();
    phonePe.dispose();
    googlePay.dispose();
    paytm.dispose();

    bookingPrefix.dispose();
    invoicePrefix.dispose();
    receiptPrefix.dispose();
    releasePrefix.dispose();

    defaultTerms.dispose();
    footer.dispose();

    authorizedSignatoryName.dispose();
  }
}
