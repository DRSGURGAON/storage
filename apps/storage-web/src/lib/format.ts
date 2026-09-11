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

/**
 * Pluralises the *head* of a noun phrase, not its last word: "customer in
 * storage" becomes "customers in storage", not "customer in storages".
 *
 * The server does the same thing for the 402's own sentence. This copy
 * exists because the upgrade list builds its own phrases ("25 customers in
 * storage"), and the first version of it read like a machine wrote it --
 * on the one screen whose job is to ask somebody for money.
 */
export function pluralNoun(noun: string): string {
  const head = noun.match(/^(.*?)(\s+(?:in|on|of|per|for|with)\s+.*)$/i);
  if (head) return `${pluralNoun(head[1])}${head[2]}`;
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}
