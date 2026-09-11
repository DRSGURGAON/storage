class CompanyValidation {
  CompanyValidation._();

  // ==========================
  // Required
  // ==========================

  static String? requiredField(String? value, String fieldName) {
    if (value == null || value.trim().isEmpty) {
      return 'Please enter $fieldName';
    }

    return null;
  }

  // ==========================
  // Mobile
  // ==========================

  static String? mobile(String? value) {
    if (value == null || value.trim().isEmpty) {
      return 'Please enter mobile number';
    }

    if (value.length != 10) {
      return 'Mobile number must contain 10 digits';
    }

    return null;
  }

  // ==========================
  // Email
  // ==========================

  static String? email(String? value) {
    if (value == null || value.trim().isEmpty) {
      return null;
    }

    final regex = RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$');

    if (!regex.hasMatch(value.trim())) {
      return 'Please enter a valid email';
    }

    return null;
  }

  // ==========================
  // GST
  // ==========================

  static String? gst(String? value) {
    if (value == null || value.trim().isEmpty) {
      return null;
    }

    final regex = RegExp(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{3}$');

    if (!regex.hasMatch(value.toUpperCase())) {
      return 'Please enter a valid GST number';
    }

    return null;
  }

  // ==========================
  // PAN
  // ==========================

  static String? pan(String? value) {
    if (value == null || value.trim().isEmpty) {
      return null;
    }

    final regex = RegExp(r'^[A-Z]{5}[0-9]{4}[A-Z]{1}$');

    if (!regex.hasMatch(value.toUpperCase())) {
      return 'Please enter a valid PAN number';
    }

    return null;
  }

  // ==========================
  // IFSC
  // ==========================

  static String? ifsc(String? value) {
    if (value == null || value.trim().isEmpty) {
      return null;
    }

    final regex = RegExp(r'^[A-Z]{4}0[A-Z0-9]{6}$');

    if (!regex.hasMatch(value.toUpperCase())) {
      return 'Please enter a valid IFSC code';
    }

    return null;
  }

  // ==========================
  // Website
  // ==========================

  static String? website(String? value) {
    if (value == null || value.trim().isEmpty) {
      return null;
    }

    if (!value.startsWith('http://') &&
        !value.startsWith('https://') &&
        !value.contains('.')) {
      return 'Please enter a valid website';
    }

    return null;
  }

  // ==========================
  // Pincode
  // ==========================

  static String? pincode(String? value) {
    if (value == null || value.trim().isEmpty) {
      return null;
    }

    if (value.length != 6) {
      return 'Pincode must contain 6 digits';
    }

    return null;
  }
}
