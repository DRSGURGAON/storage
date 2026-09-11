/// The three letters an operator sends about money owed, in the order
/// they go out. Each one is a step the next one relies on: a godown can
/// only act on unpaid rent if it can show it asked, then warned, then
/// gave notice.
enum NoticeKind {
  reminder,
  finalNotice,
  disposal;

  String get code => switch (this) {
        NoticeKind.reminder => 'REMINDER',
        NoticeKind.finalNotice => 'FINAL',
        NoticeKind.disposal => 'DISPOSAL',
      };

  /// What the operator sees in the app.
  String get label => switch (this) {
        NoticeKind.reminder => 'Payment Reminder',
        NoticeKind.finalNotice => 'Final Notice',
        NoticeKind.disposal => 'Notice Before Disposal',
      };

  /// One line explaining when to use it.
  String get hint => switch (this) {
        NoticeKind.reminder => 'Rent is due - a polite first letter',
        NoticeKind.finalNotice =>
          'Still unpaid - says the goods will be held until it is cleared',
        NoticeKind.disposal =>
          'Long unpaid - says the goods may be sold to recover the dues',
      };

  /// The heading printed on the letter.
  String get heading => switch (this) {
        NoticeKind.reminder => 'PAYMENT REMINDER',
        NoticeKind.finalNotice => 'FINAL NOTICE',
        NoticeKind.disposal => 'NOTICE BEFORE DISPOSAL OF GOODS',
      };

  /// How many days the letter gives the customer, by default.
  int get defaultDays => switch (this) {
        NoticeKind.reminder => 7,
        NoticeKind.finalNotice => 15,
        NoticeKind.disposal => 30,
      };

  static NoticeKind fromCode(String? code) => switch (code) {
        'FINAL' => NoticeKind.finalNotice,
        'DISPOSAL' => NoticeKind.disposal,
        _ => NoticeKind.reminder,
      };
}

/// One letter, as it was sent. The customer's details are snapshotted so
/// a reprint months later is the same letter, word for word.
class NoticeModel {
  final String id;
  final String noticeNo;
  final String noticeDate;
  final NoticeKind kind;

  final String customerId;
  final String bookingId;

  final String customerName;
  final String customerPhone;
  final String customerAddress;
  final String bookingNo;

  /// What was owed when the letter went out, and the date that figure
  /// was taken on.
  final double amountDue;
  final String dueAsOn;

  /// The date the letter asks the customer to pay by.
  final String payByDate;

  /// Anything the operator wants to add in their own words.
  final String bodyNote;

  /// How it was sent - WhatsApp, post, by hand. The operator's record.
  final String sentVia;

  final String createdAt;

  const NoticeModel({
    required this.id,
    this.noticeNo = '',
    required this.noticeDate,
    this.kind = NoticeKind.reminder,
    this.customerId = '',
    this.bookingId = '',
    required this.customerName,
    this.customerPhone = '',
    this.customerAddress = '',
    this.bookingNo = '',
    this.amountDue = 0,
    this.dueAsOn = '',
    this.payByDate = '',
    this.bodyNote = '',
    this.sentVia = '',
    required this.createdAt,
  });

  NoticeModel copyWith({
    String? id,
    String? noticeNo,
    String? noticeDate,
    NoticeKind? kind,
    String? customerId,
    String? bookingId,
    String? customerName,
    String? customerPhone,
    String? customerAddress,
    String? bookingNo,
    double? amountDue,
    String? dueAsOn,
    String? payByDate,
    String? bodyNote,
    String? sentVia,
    String? createdAt,
  }) {
    return NoticeModel(
      id: id ?? this.id,
      noticeNo: noticeNo ?? this.noticeNo,
      noticeDate: noticeDate ?? this.noticeDate,
      kind: kind ?? this.kind,
      customerId: customerId ?? this.customerId,
      bookingId: bookingId ?? this.bookingId,
      customerName: customerName ?? this.customerName,
      customerPhone: customerPhone ?? this.customerPhone,
      customerAddress: customerAddress ?? this.customerAddress,
      bookingNo: bookingNo ?? this.bookingNo,
      amountDue: amountDue ?? this.amountDue,
      dueAsOn: dueAsOn ?? this.dueAsOn,
      payByDate: payByDate ?? this.payByDate,
      bodyNote: bodyNote ?? this.bodyNote,
      sentVia: sentVia ?? this.sentVia,
      createdAt: createdAt ?? this.createdAt,
    );
  }

  Map<String, dynamic> toMap() => {
        'id': id,
        'notice_no': noticeNo,
        'notice_date': noticeDate,
        'notice_kind': kind.code,
        'customer_id': customerId,
        'booking_id': bookingId,
        'customer_name': customerName,
        'customer_phone': customerPhone,
        'customer_address': customerAddress,
        'booking_no': bookingNo,
        'amount_due': amountDue,
        'due_as_on': dueAsOn,
        'pay_by_date': payByDate,
        'body_note': bodyNote,
        'sent_via': sentVia,
        'created_at': createdAt,
      };

  factory NoticeModel.fromMap(Map<String, dynamic> map) {
    String text(String key) => (map[key] as String?) ?? '';

    return NoticeModel(
      id: map['id'] as String,
      noticeNo: text('notice_no'),
      noticeDate: text('notice_date'),
      kind: NoticeKind.fromCode(map['notice_kind'] as String?),
      customerId: text('customer_id'),
      bookingId: text('booking_id'),
      customerName: text('customer_name'),
      customerPhone: text('customer_phone'),
      customerAddress: text('customer_address'),
      bookingNo: text('booking_no'),
      amountDue: (map['amount_due'] as num?)?.toDouble() ?? 0,
      dueAsOn: text('due_as_on'),
      payByDate: text('pay_by_date'),
      bodyNote: text('body_note'),
      sentVia: text('sent_via'),
      createdAt: text('created_at'),
    );
  }
}
