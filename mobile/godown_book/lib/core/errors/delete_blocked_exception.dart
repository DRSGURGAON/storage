/// A delete refused because other records still point at this one -
/// deleting it would leave them orphaned. The message says what to
/// delete first, in words the owner can act on.
class DeleteBlockedException implements Exception {
  final String message;

  const DeleteBlockedException(this.message);

  @override
  String toString() => message;
}
