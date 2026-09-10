/** The formatting rules every screen shares, in one place so they cannot drift apart. */

const MONEY = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const QUANTITY = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

/**
 * Quantities arrive as strings, not numbers, and deliberately: they are
 * `numeric` columns, and postgres.js hands them over as text so a
 * three-decimal warehouse quantity cannot be quietly rounded through a
 * float on its way to the screen. Formatting is the only place they become
 * numbers.
 */
export function quantity(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return QUANTITY.format(Number(value));
}

export function money(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return MONEY.format(Number(value));
}

export function date(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return `${date(parsed)} ${parsed.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
}

/** `pending_approval` -> `Pending approval`, for statuses the API returns raw. */
export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * `workflow-and-statuses.md`'s status vocabulary, mapped to one colour
 * scheme for the whole app. Every module reuses these words -- draft,
 * submitted, approved, cancelled -- so colouring them per screen would mean
 * the same word rendering differently depending on where you saw it.
 */
export function statusColor(status: string | null | undefined): string {
  switch (status) {
    case 'draft':
    case 'open':
    case 'pending':
      return 'default';
    case 'submitted':
    case 'checked':
    case 'sent':
    case 'in_progress':
    case 'pending_approval':
    case 'pending_manager':
    case 'pending_owner':
    case 'requested':
    case 'reserved':
      return 'processing';
    case 'approved':
    case 'accepted':
    case 'active':
    case 'completed':
    case 'issued':
    case 'delivered':
    case 'gate_out':
    case 'posted':
    case 'paid':
    case 'received':
    case 'linked':
    case 'grn_created':
      return 'success';
    case 'partially_paid':
    case 'overdue':
    case 'discrepancy':
      return 'warning';
    case 'rejected':
    case 'cancelled':
    case 'reversed':
    case 'closed':
    case 'expired':
    case 'terminated':
      return 'error';
    default:
      return 'default';
  }
}
