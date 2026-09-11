/// What went wrong with goods in the godown.
enum IncidentKind {
  damage,
  loss,
  theft,
  fire,
  water,
  pest,
  other;

  String get code => switch (this) {
        IncidentKind.damage => 'DAMAGE',
        IncidentKind.loss => 'LOSS',
        IncidentKind.theft => 'THEFT',
        IncidentKind.fire => 'FIRE',
        IncidentKind.water => 'WATER',
        IncidentKind.pest => 'PEST',
        IncidentKind.other => 'OTHER',
      };

  String get label => switch (this) {
        IncidentKind.damage => 'Damage',
        IncidentKind.loss => 'Missing / Lost',
        IncidentKind.theft => 'Theft',
        IncidentKind.fire => 'Fire',
        IncidentKind.water => 'Water / Leakage',
        IncidentKind.pest => 'Pests / Insects',
        IncidentKind.other => 'Other',
      };

  static IncidentKind fromCode(String? code) => switch (code) {
        'LOSS' => IncidentKind.loss,
        'THEFT' => IncidentKind.theft,
        'FIRE' => IncidentKind.fire,
        'WATER' => IncidentKind.water,
        'PEST' => IncidentKind.pest,
        'OTHER' => IncidentKind.other,
        _ => IncidentKind.damage,
      };
}

/// A damage or loss report, written the day it happened. Photographs
/// attach to it, and it is what an insurer asks for and what answers a
/// customer's claim months later.
class IncidentModel {
  final String id;
  final String reportNo;
  final String reportDate;
  final IncidentKind kind;

  final String bookingId;
  final String bookingNo;
  final String customerId;
  final String customerName;
  final String customerPhone;

  final String happenedOn;
  final String place;

  final String goodsAffected;
  final String whatHappened;
  final String actionTaken;

  final double estimatedLoss;
  final String policeReference;
  final bool insurerInformed;
  final bool customerInformed;

  final String reportedBy;
  final String createdAt;

  const IncidentModel({
    required this.id,
    this.reportNo = '',
    required this.reportDate,
    this.kind = IncidentKind.damage,
    this.bookingId = '',
    this.bookingNo = '',
    this.customerId = '',
    this.customerName = '',
    this.customerPhone = '',
    this.happenedOn = '',
    this.place = '',
    this.goodsAffected = '',
    this.whatHappened = '',
    this.actionTaken = '',
    this.estimatedLoss = 0,
    this.policeReference = '',
    this.insurerInformed = false,
    this.customerInformed = false,
    this.reportedBy = '',
    required this.createdAt,
  });

  IncidentModel copyWith({
    String? id,
    String? reportNo,
    String? reportDate,
    IncidentKind? kind,
    String? bookingId,
    String? bookingNo,
    String? customerId,
    String? customerName,
    String? customerPhone,
    String? happenedOn,
    String? place,
    String? goodsAffected,
    String? whatHappened,
    String? actionTaken,
    double? estimatedLoss,
    String? policeReference,
    bool? insurerInformed,
    bool? customerInformed,
    String? reportedBy,
    String? createdAt,
  }) {
    return IncidentModel(
      id: id ?? this.id,
      reportNo: reportNo ?? this.reportNo,
      reportDate: reportDate ?? this.reportDate,
      kind: kind ?? this.kind,
      bookingId: bookingId ?? this.bookingId,
      bookingNo: bookingNo ?? this.bookingNo,
      customerId: customerId ?? this.customerId,
      customerName: customerName ?? this.customerName,
      customerPhone: customerPhone ?? this.customerPhone,
      happenedOn: happenedOn ?? this.happenedOn,
      place: place ?? this.place,
      goodsAffected: goodsAffected ?? this.goodsAffected,
      whatHappened: whatHappened ?? this.whatHappened,
      actionTaken: actionTaken ?? this.actionTaken,
      estimatedLoss: estimatedLoss ?? this.estimatedLoss,
      policeReference: policeReference ?? this.policeReference,
      insurerInformed: insurerInformed ?? this.insurerInformed,
      customerInformed: customerInformed ?? this.customerInformed,
      reportedBy: reportedBy ?? this.reportedBy,
      createdAt: createdAt ?? this.createdAt,
    );
  }

  Map<String, dynamic> toMap() => {
        'id': id,
        'report_no': reportNo,
        'report_date': reportDate,
        'incident_kind': kind.code,
        'booking_id': bookingId,
        'booking_no': bookingNo,
        'customer_id': customerId,
        'customer_name': customerName,
        'customer_phone': customerPhone,
        'happened_on': happenedOn,
        'place': place,
        'goods_affected': goodsAffected,
        'what_happened': whatHappened,
        'action_taken': actionTaken,
        'estimated_loss': estimatedLoss,
        'police_reference': policeReference,
        'insurer_informed': insurerInformed ? 1 : 0,
        'customer_informed': customerInformed ? 1 : 0,
        'reported_by': reportedBy,
        'created_at': createdAt,
      };

  factory IncidentModel.fromMap(Map<String, dynamic> map) {
    String text(String key) => (map[key] as String?) ?? '';

    return IncidentModel(
      id: map['id'] as String,
      reportNo: text('report_no'),
      reportDate: text('report_date'),
      kind: IncidentKind.fromCode(map['incident_kind'] as String?),
      bookingId: text('booking_id'),
      bookingNo: text('booking_no'),
      customerId: text('customer_id'),
      customerName: text('customer_name'),
      customerPhone: text('customer_phone'),
      happenedOn: text('happened_on'),
      place: text('place'),
      goodsAffected: text('goods_affected'),
      whatHappened: text('what_happened'),
      actionTaken: text('action_taken'),
      estimatedLoss: (map['estimated_loss'] as num?)?.toDouble() ?? 0,
      policeReference: text('police_reference'),
      insurerInformed: (map['insurer_informed'] as int?) == 1,
      customerInformed: (map['customer_informed'] as int?) == 1,
      reportedBy: text('reported_by'),
      createdAt: text('created_at'),
    );
  }
}
