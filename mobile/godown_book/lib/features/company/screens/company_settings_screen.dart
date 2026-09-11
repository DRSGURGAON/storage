import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/document_theme/document_theme.dart';
import '../../../core/tenant/tenant_provider.dart';
import '../controllers/company_controller.dart';
import '../models/company_model.dart';
import '../providers/company_provider.dart';

import '../utils/company_image_picker.dart';
import '../utils/company_text_controllers.dart';
import '../utils/company_validation.dart';

import '../widgets/address_card.dart';
import '../widgets/bank_details_card.dart';
import '../widgets/branding_card.dart';
import '../widgets/business_information_card.dart';
import '../widgets/signature_pad_dialog.dart';
import '../widgets/contact_information_card.dart';
import '../widgets/document_preferences_card.dart';
import '../widgets/legal_information_card.dart';
import '../widgets/live_preview_card.dart';
import '../widgets/save_button.dart';
import '../widgets/upi_details_card.dart';

class CompanySettingsScreen extends ConsumerStatefulWidget {
  const CompanySettingsScreen({super.key});

  @override
  ConsumerState<CompanySettingsScreen> createState() =>
      _CompanySettingsScreenState();
}

class _CompanySettingsScreenState extends ConsumerState<CompanySettingsScreen> {
  final CompanyTextControllers c = CompanyTextControllers();

  bool isSaving = false;

  String? logoPath;
  String? signaturePath;
  String? stampPath;
  DocumentTheme documentTheme = DocumentTheme.classic;

  /// Display-only - the customer's own DRS ID (see DrsIdCounterService),
  /// assigned once at company creation and never editable here, same
  /// reasoning already established for companyId itself.
  String? companyCode;

  /// The company as loaded from the database - see _loadCompany().
  CompanyModel? _existingCompany;

  @override
  void initState() {
    super.initState();

    _loadCompany();
  }

  Future<void> _loadCompany() async {
    final company = await CompanyController.instance.getCompany();

    if (company == null) return;

    // Kept so _createModel() can carry forward fields this screen
    // doesn't edit (e.g. footerText2, set from Reports -> Customise
    // Documents) instead of silently resetting them on every save.
    _existingCompany = company;

    _fillControllers(company);
  }

  // ==========================
  // Fill Controllers
  // ==========================

  void _fillControllers(CompanyModel company) {
    companyCode = company.companyCode;

    c.companyName.text = company.companyName;
    c.tagLine.text = company.tagLine;
    c.affiliatedBy.text = company.affiliatedBy;
    c.authorizedSignatoryName.text = company.authorizedSignatoryName;

    c.mobile1.text = company.mobile1;
    c.mobile2.text = company.mobile2;
    c.mobile3.text = company.mobile3;
    c.mobile4.text = company.mobile4;

    c.whatsapp.text = company.whatsappNumber;
    c.landline.text = company.landline;

    c.email.text = company.email;
    c.website.text = company.website;

    c.address.text = company.address;
    c.city.text = company.city;
    c.state.text = company.state;
    c.pincode.text = company.pincode;
    c.jurisdiction.text = company.jurisdiction;

    c.gst.text = company.gstNumber;
    c.pan.text = company.panNumber;
    c.msme.text = company.msmeNumber;
    c.iso.text = company.isoCertificate;

    c.beneficiary.text = company.beneficiaryName;
    c.bank.text = company.bankName;
    c.branch.text = company.branchName;
    c.account.text = company.accountNumber;
    c.ifsc.text = company.ifscCode;

    c.upi1.text = company.upiId1;
    c.upi2.text = company.upiId2;
    c.phonePe.text = company.phonePeNumber;
    c.googlePay.text = company.googlePayNumber;
    c.paytm.text = company.paytmNumber;

    c.bookingPrefix.text = company.bookingPrefix;
    c.invoicePrefix.text = company.invoicePrefix;
    c.receiptPrefix.text = company.receiptPrefix;
    c.releasePrefix.text = company.releasePrefix;

    c.defaultTerms.text = company.defaultTerms;
    c.footer.text = company.footerText;

    logoPath = company.logoPath;
    signaturePath = company.signaturePath;
    stampPath = company.stampPath;
    documentTheme = company.documentTheme;

    if (mounted) {
      setState(() {});
    }
  }

  // ==========================
  // Create Model
  // ==========================

  CompanyModel _createModel() {
    return CompanyModel(
      companyName: c.companyName.text.trim(),

      tagLine: c.tagLine.text.trim(),
      affiliatedBy: c.affiliatedBy.text.trim(),

      logoPath: logoPath ?? '',
      signaturePath: signaturePath ?? '',
      stampPath: stampPath ?? '',
      authorizedSignatoryName: c.authorizedSignatoryName.text.trim(),
      documentTheme: documentTheme,

      mobile1: c.mobile1.text.trim(),
      mobile2: c.mobile2.text.trim(),
      mobile3: c.mobile3.text.trim(),
      mobile4: c.mobile4.text.trim(),

      whatsappNumber: c.whatsapp.text.trim(),
      landline: c.landline.text.trim(),

      email: c.email.text.trim(),
      website: c.website.text.trim(),

      gstNumber: c.gst.text.trim(),
      panNumber: c.pan.text.trim(),
      msmeNumber: c.msme.text.trim(),
      isoCertificate: c.iso.text.trim(),

      address: c.address.text.trim(),
      city: c.city.text.trim(),
      state: c.state.text.trim(),
      pincode: c.pincode.text.trim(),
      jurisdiction: c.jurisdiction.text.trim(),

      beneficiaryName: c.beneficiary.text.trim(),
      bankName: c.bank.text.trim(),
      branchName: c.branch.text.trim(),
      accountNumber: c.account.text.trim(),
      ifscCode: c.ifsc.text.trim(),

      upiId1: c.upi1.text.trim(),
      upiId2: c.upi2.text.trim(),
      phonePeNumber: c.phonePe.text.trim(),
      googlePayNumber: c.googlePay.text.trim(),
      paytmNumber: c.paytm.text.trim(),

      bookingPrefix: c.bookingPrefix.text.trim(),
      invoicePrefix: c.invoicePrefix.text.trim(),
      receiptPrefix: c.receiptPrefix.text.trim(),
      releasePrefix: c.releasePrefix.text.trim(),

      defaultTerms: c.defaultTerms.text.trim(),
      footerText: c.footer.text.trim(),
      // Not edited on this screen (Reports -> Customise Documents owns
      // it) - carried forward so saving here doesn't wipe it.
      footerText2: _existingCompany?.footerText2 ?? '',

      createdAt: DateTime.now().toIso8601String(),
      updatedAt: DateTime.now().toIso8601String(),
    );
  }

  // ==========================
  // Save Company
  // ==========================

  Future<void> _saveCompany() async {
    if (c.companyName.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Please enter Company Name")),
      );
      return;
    }

    // These fields are printed verbatim on every Warehouse Receipt/Bill/
    // Letterhead - CompanyValidation already defines the correct format
    // checks for each, they just weren't being called before a save.
    final formatError = CompanyValidation.email(c.email.text.trim()) ??
        CompanyValidation.gst(c.gst.text.trim()) ??
        CompanyValidation.pan(c.pan.text.trim()) ??
        CompanyValidation.ifsc(c.ifsc.text.trim()) ??
        CompanyValidation.pincode(c.pincode.text.trim());
    if (formatError != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(formatError)),
      );
      return;
    }

    setState(() {
      isSaving = true;
    });

    try {
      final company = _createModel();

      await CompanyController.instance.saveCompany(company);

      if (!mounted) return;

      ref.invalidate(companyProvider);

      // The tenant provider caches the company for the router guard and the
      // PDF configuration check.
      ref.invalidate(currentCompanyProvider);

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Company details saved successfully.")),
      );
    } catch (e) {
      if (!mounted) return;

      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("Error: $e")));
    } finally {
      if (mounted) {
        setState(() {
          isSaving = false;
        });
      }
    }
  }
  // ==========================
  // Image Pickers
  // ==========================

  Future<void> _pickLogo() async {
    final path = await CompanyImagePicker.pickLogo();

    if (path == null) return;

    // A new image was picked to replace the old one - the previous file is
    // no longer referenced anywhere, so delete it instead of leaving it as
    // dead storage on the device.
    final previousPath = logoPath;

    setState(() {
      logoPath = path;
    });

    if (previousPath != null && previousPath.isNotEmpty) {
      await CompanyImagePicker.deleteImage(previousPath);
    }
  }

  Future<void> _drawSignature() async {
    final bytes = await Navigator.of(context).push<Uint8List?>(
      MaterialPageRoute(builder: (_) => const SignaturePadDialog()),
    );

    if (bytes == null) return;

    final path = await CompanyImagePicker.saveDrawnSignature(bytes);

    final previousPath = signaturePath;

    setState(() {
      signaturePath = path;
    });

    if (previousPath != null && previousPath.isNotEmpty) {
      await CompanyImagePicker.deleteImage(previousPath);
    }
  }

  Future<void> _pickStamp() async {
    final path = await CompanyImagePicker.pickStamp();

    if (path == null) return;

    final previousPath = stampPath;

    setState(() {
      stampPath = path;
    });

    if (previousPath != null && previousPath.isNotEmpty) {
      await CompanyImagePicker.deleteImage(previousPath);
    }
  }

  Future<void> _removeStamp() async {
    final previousPath = stampPath;

    setState(() => stampPath = null);

    if (previousPath != null && previousPath.isNotEmpty) {
      await CompanyImagePicker.deleteImage(previousPath);
    }
  }

  Future<void> _removeLogo() async {
    final previousPath = logoPath;

    setState(() => logoPath = null);

    if (previousPath != null && previousPath.isNotEmpty) {
      await CompanyImagePicker.deleteImage(previousPath);
    }
  }

  Future<void> _removeSignature() async {
    final previousPath = signaturePath;

    setState(() => signaturePath = null);

    if (previousPath != null && previousPath.isNotEmpty) {
      await CompanyImagePicker.deleteImage(previousPath);
    }
  }

  // ==========================
  // BUILD
  // ==========================

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Company Settings"), centerTitle: true),

      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),

          child: Column(
            children: [
              if ((companyCode ?? '').isNotEmpty && companyCode != 'DRS001')
                Card(
                  color: const Color(0xffEAF1FB),
                  margin: const EdgeInsets.only(bottom: 16),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    child: Row(
                      children: [
                        const Icon(Icons.badge_outlined, color: Color(0xff1F3864)),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Your Customer ID',
                                style: TextStyle(fontSize: 12, color: Colors.grey),
                              ),
                              Text(
                                companyCode!,
                                style: const TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xff1F3864),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              BusinessInformationCard(
                companyNameController: c.companyName,
                tagLineController: c.tagLine,
                affiliatedByController: c.affiliatedBy,
                websiteController: c.website,
                onLogoTap: _pickLogo,
                logoPath: logoPath,
              ),

              const SizedBox(height: 16),

              ContactInformationCard(
                mobile1Controller: c.mobile1,
                mobile2Controller: c.mobile2,
                mobile3Controller: c.mobile3,
                mobile4Controller: c.mobile4,
                whatsappController: c.whatsapp,
                landlineController: c.landline,
                emailController: c.email,
              ),

              const SizedBox(height: 16),

              AddressCard(
                addressController: c.address,
                cityController: c.city,
                stateController: c.state,
                pincodeController: c.pincode,
                jurisdictionController: c.jurisdiction,
              ),

              const SizedBox(height: 16),

              LegalInformationCard(
                gstController: c.gst,
                panController: c.pan,
                msmeController: c.msme,
                isoController: c.iso,
              ),

              const SizedBox(height: 16),

              BankDetailsCard(
                beneficiaryController: c.beneficiary,
                bankController: c.bank,
                branchController: c.branch,
                accountController: c.account,
                ifscController: c.ifsc,
              ),

              const SizedBox(height: 16),

              UpiDetailsCard(
                upi1Controller: c.upi1,
                upi2Controller: c.upi2,
                phonePeController: c.phonePe,
                googlePayController: c.googlePay,
                paytmController: c.paytm,
              ),
              const SizedBox(height: 16),

              BrandingCard(
                logoPath: logoPath,
                signaturePath: signaturePath,
                stampPath: stampPath,
                onLogoTap: _pickLogo,
                onSignatureTap: _drawSignature,
                onStampTap: _pickStamp,
                onLogoRemove: _removeLogo,
                onSignatureRemove: _removeSignature,
                onStampRemove: _removeStamp,
              ),

              const SizedBox(height: 12),

              Card(
                elevation: 2,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Row(
                        children: [
                          Icon(Icons.palette_outlined),
                          SizedBox(width: 8),
                          Text(
                            "Document Theme",
                            style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        "Controls the look of every generated document - "
                        "Warehouse Receipt, Inventory List, Storage Agreement, "
                        "Delivery Order, Gate Pass, Rent Bill, Money Receipt, "
                        "Statement, Letter Head and Company Card - "
                        "not the data or totals on any of them.",
                        style: Theme.of(
                          context,
                        ).textTheme.bodySmall?.copyWith(color: Colors.grey),
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<DocumentTheme>(
                        initialValue: documentTheme,
                        decoration: const InputDecoration(
                          labelText: 'Select Theme',
                          border: OutlineInputBorder(),
                        ),
                        selectedItemBuilder: (context) {
                          // The selected value shown on the closed
                          // dropdown - a plain, single-line row
                          // (swatch + label), since the open menu's
                          // own richer preview row would look
                          // cramped collapsed into the field itself.
                          return [
                            for (final theme in DocumentTheme.values)
                              Row(
                                children: [
                                  _ThemeSwatch(theme: theme),
                                  const SizedBox(width: 8),
                                  Text(theme.label),
                                ],
                              ),
                          ];
                        },
                        items: [
                          for (final theme in DocumentTheme.values)
                            DropdownMenuItem(
                              value: theme,
                              child: Row(
                                children: [
                                  _ThemeSwatch(theme: theme),
                                  const SizedBox(width: 10),
                                  Text(theme.label),
                                ],
                              ),
                            ),
                        ],
                        onChanged: (value) {
                          if (value != null) {
                            setState(() => documentTheme = value);
                          }
                        },
                      ),
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 12),

              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: TextField(
                    controller: c.authorizedSignatoryName,
                    decoration: const InputDecoration(
                      labelText: 'Authorized Signatory Name',
                      hintText: 'e.g. Rajesh Kumar, Director',
                      helperText: 'Printed below the signature on every document',
                    ),
                  ),
                ),
              ),

              const SizedBox(height: 16),

              DocumentPreferencesCard(
                bookingPrefixController: c.bookingPrefix,
                invoicePrefixController: c.invoicePrefix,
                receiptPrefixController: c.receiptPrefix,
                releasePrefixController: c.releasePrefix,
                footerController: c.footer,
                defaultTermsController: c.defaultTerms,
              ),

              const SizedBox(height: 16),

              LivePreviewCard(
                companyName: c.companyName.text,
                address: c.address.text,
                mobile: c.mobile1.text,
                email: c.email.text,
                website: c.website.text,
                gst: c.gst.text,
                logoPath: logoPath,
              ),

              const SizedBox(height: 24),

              SaveButton(isLoading: isSaving, onPressed: _saveCompany),

              const SizedBox(height: 30),
            ],
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    c.dispose();
    super.dispose();
  }
}

/// A small rounded color chip previewing one DocumentTheme's own
/// primary color, shown next to its name in both the closed dropdown
/// field and the open menu - so the user can genuinely see what
/// "Bold" or "Elegant" looks like before picking it, rather than
/// guessing from the name alone.
class _ThemeSwatch extends StatelessWidget {
  final DocumentTheme theme;

  const _ThemeSwatch({required this.theme});

  @override
  Widget build(BuildContext context) {
    // PdfColor's own .toInt() returns the same 0xAARRGGBB format
    // Flutter's Color constructor accepts (confirmed via the pdf
    // package's own official API docs), so this is a direct,
    // lossless conversion - not an approximation.
    final pdfColor = DocumentThemeStyle.of(theme).primary;
    final flutterColor = Color(pdfColor.toInt());

    return Container(
      width: 20,
      height: 20,
      decoration: BoxDecoration(
        color: flutterColor,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.black26, width: 0.5),
      ),
    );
  }
}
