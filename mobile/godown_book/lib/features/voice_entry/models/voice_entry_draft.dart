import '../../storage_booking/models/booking_item_model.dart';
import '../../storage_booking/models/storage_status.dart';
import 'voice_reading.dart';

/// What one spoken sentence produced for a new storage entry. Anything
/// the app did not hear stays null, and the form leaves it alone.
class VoiceEntryDraft implements VoiceReading {
  @override
  final String transcript;
  @override
  final List<VoiceField> fields;

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

  @override
  bool get isEmpty => fields.isEmpty;

  int get totalPackages =>
      items.fold(0.0, (sum, item) => sum + item.quantity).round();

  @override
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
}
