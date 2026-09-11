/**
 * Dates a person reads, not the ones the database stores. "2026-09-11" is
 * correct and unreadable; a customer on the phone says "eleventh of
 * September".
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const ID_PROOF_LABELS: Record<string, string> = {
  aadhaar: 'Aadhaar',
  driving_licence: 'Driving licence',
  voter_id: 'Voter ID',
  passport: 'Passport',
  other: 'Other ID',
};

export function idProofLabel(type: string | null): string {
  if (!type) return '—';
  return ID_PROOF_LABELS[type] ?? type;
}

const CATEGORY_LABELS: Record<string, string> = {
  furniture: 'Furniture',
  appliance: 'Appliance',
  carton: 'Cartons',
  vehicle: 'Vehicle',
  other: 'Other',
};

export function categoryLabel(category: string | null): string {
  if (!category) return 'Item';
  return CATEGORY_LABELS[category] ?? category;
}
