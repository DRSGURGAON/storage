import '../../storage_booking/models/booking_item_model.dart';
import '../../storage_booking/models/storage_status.dart';

/// One thing the app believes it heard, and the words it heard it in.
///
/// The operator sees this list before anything touches the form, so a
/// wrong reading costs a tap, never a wrong receipt.
class VoiceField {
  /// Which form field this belongs to.
  final VoiceFieldKind kind;

  /// What to show on the review list, e.g. "Rent" / "3,500 per month".
  final String label;
  final String display;

  /// The part of the sentence this came from, so the operator can see
  /// why the app read it that way.
  final String heard;

  const VoiceField({
    required this.kind,
    required this.label,
    required this.display,
    required this.heard,
  });
}

enum VoiceFieldKind {
  customerName,
  customerPhone,
  customerCity,
  customerPincode,
  storageStart,
  items,
  totalPackages,
  rent,
  securityDeposit,
  declaredValue,
  vehicleNumber,
}

/// Everything one spoken sentence produced. Fields the app did not hear
/// stay null, and the form leaves them alone.
class VoiceEntryDraft {
  final String transcript;

  final String? customerName;
  final String? customerPhone;
  final String? customerCity;
  final String? customerPincode;
  final DateTime? storageStart;
  final List<BookingItemModel> items;
  final double? rentRate;
  final RentBasis? rentBasis;
  final double? securityDeposit;
  final double? declaredValue;
  final String? vehicleNumber;

  /// The review list, in the order it should be shown.
  final List<VoiceField> fields;

  const VoiceEntryDraft({
    required this.transcript,
    this.customerName,
    this.customerPhone,
    this.customerCity,
    this.customerPincode,
    this.storageStart,
    this.items = const [],
    this.rentRate,
    this.rentBasis,
    this.securityDeposit,
    this.declaredValue,
    this.vehicleNumber,
    this.fields = const [],
  });

  bool get isEmpty => fields.isEmpty;

  /// The same reading with the rows the operator unticked dropped, so a
  /// wrong guess never reaches the form.
  VoiceEntryDraft keeping(Set<VoiceFieldKind> kinds) => VoiceEntryDraft(
        transcript: transcript,
        customerName:
            kinds.contains(VoiceFieldKind.customerName) ? customerName : null,
        customerPhone:
            kinds.contains(VoiceFieldKind.customerPhone) ? customerPhone : null,
        customerCity:
            kinds.contains(VoiceFieldKind.customerCity) ? customerCity : null,
        customerPincode: kinds.contains(VoiceFieldKind.customerPincode)
            ? customerPincode
            : null,
        storageStart:
            kinds.contains(VoiceFieldKind.storageStart) ? storageStart : null,
        items: kinds.contains(VoiceFieldKind.items) ? items : const [],
        rentRate: kinds.contains(VoiceFieldKind.rent) ? rentRate : null,
        rentBasis: kinds.contains(VoiceFieldKind.rent) ? rentBasis : null,
        securityDeposit: kinds.contains(VoiceFieldKind.securityDeposit)
            ? securityDeposit
            : null,
        declaredValue: kinds.contains(VoiceFieldKind.declaredValue)
            ? declaredValue
            : null,
        vehicleNumber:
            kinds.contains(VoiceFieldKind.vehicleNumber) ? vehicleNumber : null,
        fields: fields.where((f) => kinds.contains(f.kind)).toList(),
      );

  int get totalPackages =>
      items.fold(0.0, (sum, item) => sum + item.quantity).round();
}
