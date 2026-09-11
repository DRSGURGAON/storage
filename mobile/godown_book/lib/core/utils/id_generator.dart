import 'package:uuid/uuid.dart';

class IdGenerator {
  IdGenerator._();

  static final Uuid _uuid = Uuid();

  static String generateId() {
    return _uuid.v4();
  }

  static String generateCode({required String prefix, required int number}) {
    return '$prefix${number.toString().padLeft(3, '0')}';
  }
}
