/**
 * `tenant_settings` is a `(tenant_id, key, jsonb value)` table, which is
 * flexible enough to accept anything -- including a typo. That is the
 * failure mode worth designing against: a setting written under
 * `stock.allow_negatives` looks saved, reads back on the settings page,
 * and silently does nothing forever, because the code reads
 * `stock.allow_negative`. This is the same shape as the two gaps the
 * Phase 5 audit found (`DECISIONS.md` §33, §34) -- a value stored and
 * surfaced but never actually consulted -- so keys are declared here and
 * an unknown one is a 400 rather than a write nobody notices.
 *
 * A key belongs in this table only once something reads it. Every entry
 * below names its reader.
 */
export interface SettingDefinition {
  key: string;
  type: 'boolean' | 'string' | 'number' | 'string[]';
  /** Effective value when the tenant has stored none. */
  default: unknown;
  description: string;
  /** Where the value is actually consumed -- empty means nothing reads it yet. */
  readBy: string;
  allowed?: readonly string[];
}

export const TENANT_SETTINGS: readonly SettingDefinition[] = [
  {
    key: 'stock.allow_negative',
    type: 'boolean',
    default: false,
    description:
      "Allow a posting to take a stock balance below zero. Blueprint §61's explicit " +
      'escape hatch, off by default: with it on, the stock engine stops refusing ' +
      'movements that would leave a negative physical or reserved quantity.',
    readBy: 'StockService.allowsNegativeStock (stock-engine.md §3.1)',
  },
  {
    key: 'stock.ageing_buckets',
    type: 'string[]',
    default: ['0-30', '31-60', '61-90', '91-180', '180+'],
    description:
      'Day ranges the ageing report groups stock into, computed from ' +
      'batches.first_received_at (§26). A reporting-time computation, so changing ' +
      'this never needs a backfill.',
    readBy: 'ReportsService.ageing',
  },
  {
    key: 'stock.allocation_policy',
    type: 'string',
    default: 'fifo',
    allowed: ['fifo', 'lifo', 'fefo'],
    description:
      'Which shelved lots a release order reserves first when the reservation does ' +
      'not name lots explicitly: oldest received (fifo, §30 default), newest received ' +
      '(lifo), or earliest expiry (fefo, expiry-less lots last). A reservation may ' +
      'override it per order, or pass manual allocations.',
    readBy: 'ReleaseOrdersService.reserve (stock-engine.md §5)',
  },
  {
    key: 'workflow.outward_posting_point',
    type: 'string',
    default: 'gate_pass',
    allowed: ['gate_pass', 'dispatch'],
    description:
      'When physical stock actually leaves: at gate-out (§35/§68 default) or at ' +
      'dispatch confirmation, for a tenant that does not gate-track outbound ' +
      'vehicles. The schema supports either; only the trigger point differs.',
    readBy: 'OutboundPostingService.postingPoint / DispatchesService.confirm',
  },
  {
    key: 'approvals.stock_adjustment.owner_required',
    type: 'boolean',
    default: false,
    description:
      'Require a second, Owner-level approval on a stock adjustment on top of the ' +
      "manager's (§50).",
    readBy: 'StockAdjustmentsService.approve',
  },
] as const;

export const SETTINGS_BY_KEY = new Map(TENANT_SETTINGS.map((s) => [s.key, s]));

/** Returns an error message, or null when the value fits the key's declared type. */
export function validateSettingValue(def: SettingDefinition, value: unknown): string | null {
  switch (def.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : `${def.key} must be true or false`;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : `${def.key} must be a number`;
    case 'string':
      if (typeof value !== 'string') return `${def.key} must be a string`;
      if (def.allowed && !def.allowed.includes(value)) {
        return `${def.key} must be one of: ${def.allowed.join(', ')}`;
      }
      return null;
    case 'string[]':
      return Array.isArray(value) && value.every((v) => typeof v === 'string')
        ? null
        : `${def.key} must be an array of strings`;
    default:
      return `${def.key} has an unsupported type`;
  }
}
