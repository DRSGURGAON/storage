/**
 * document-engine.md §2: regenerating a document is "only permitted when
 * the source record's status still allows edits, or by a user holding a
 * specific `regenerate_after_approval` permission."
 *
 * This is the table that decides which half of that sentence applies. For
 * each document type it lists the source statuses in which the record is
 * still **provisional** -- nobody outside the warehouse has acted on it,
 * so replacing its PDF retracts nothing. In every other status the
 * document has been approved, issued, or handed over, and superseding it
 * silently flips the copy someone is already holding to `revoked` on the
 * public verify page. That is an Owner/Admin decision
 * (`permissions-matrix.md` grants `regenerate_after_approval` to those two
 * roles only), not a routine one.
 *
 * The statuses come from each module's own edit guard -- the same states
 * in which `PATCH` is accepted -- so this table cannot drift from what the
 * workflow already considers open. Two entries are not edit guards:
 *
 * - `putaway` has no PATCH at all, but a slip is a working instruction
 *   until `complete` confirms it, so `pending`/`in_progress` are open on
 *   the same reasoning.
 * - `warehouse_receipt` has no open state by design. It exists only as
 *   `issued`, it is the document the customer keeps, and blueprint §22
 *   makes it the one that must never be quietly reissued -- so every
 *   regeneration of it needs the elevated permission.
 */
export const PROVISIONAL_SOURCE_STATUSES: Record<string, readonly string[]> = {
  quotation: ['draft'],
  agreement: ['draft'],
  gate_entry: ['open'],
  inward: ['draft'],
  grn: ['draft'],
  discrepancy_report: ['draft'],
  putaway: ['pending', 'in_progress'],
  warehouse_receipt: [],
  // A transfer note is provisional until the goods leave. Once it is
  // in_transit the TRANSFER_OUT is in the ledger and a driver may be
  // carrying the printed copy.
  stock_transfer: ['draft', 'approved'],
  // A blank count sheet is provisional; a completed verification is the
  // record someone signed, and reissuing it should be a deliberate act.
  stock_verification: ['draft'],
  // A statement is reissued freely -- each issue is a fresh reading of the
  // balance, and the previous one is superseded by design.
  stock_statement: ['issued'],
};

/**
 * Which permission a regeneration of this document, in this state, needs
 * *in addition to* `regenerate_document`. `null` means none.
 *
 * An unknown document type is treated as final rather than open: a new
 * template that forgets to declare itself here gets the stricter rule, not
 * the looser one.
 */
export function elevatedPermissionForRegeneration(
  documentType: string,
  sourceStatus: string,
): string | null {
  const provisional = PROVISIONAL_SOURCE_STATUSES[documentType];
  if (provisional && provisional.includes(sourceStatus)) return null;
  return 'regenerate_after_approval';
}
