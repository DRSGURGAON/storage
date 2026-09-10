/**
 * Blueprint §15's wizard, as data.
 *
 * "Wizard steps: 1. Parties 2. Warehouse 3. Services 4. Goods
 * 5. Commercial terms 6. Rates 7. Payment 8. Liability / insurance
 * 9. Term 10. Termination 11. Signatories."
 *
 * Until now `agreements.wizard_data` was a freeform jsonb object: the API
 * accepted any shape, nothing said what a complete agreement was, and the
 * template could not print an answer because no answer had a name. The
 * eleven steps are declared here instead, once, and everything else reads
 * them -- the endpoint that draws the wizard, the validation that refuses
 * a key nobody defined, the completeness check that gates approval, and
 * the `{{wizard.*}}` tokens the clauses resolve.
 *
 * Two rules worth stating.
 *
 * **A draft may be incomplete; an approval may not.** Required fields do
 * not block saving, because a wizard whose first step refuses to save is
 * not a wizard. They block *submitting for approval*, which is the moment
 * the document starts meaning something.
 *
 * **Steps 1, 2 and 6 mostly come from masters.** The parties, the
 * warehouse and the rates are the company, customer, warehouse and rate
 * card records -- §15's "the generated document must automatically use"
 * list. Those steps therefore collect only what the masters cannot know
 * (a contact for notices, the areas allotted, whether the rate card is
 * exclusive), and the rest is pre-filled. Asking someone to retype their
 * customer's GSTIN into an agreement is how the two come to disagree.
 */
export interface WizardField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'money' | 'date' | 'boolean' | 'select';
  options?: string[];
  required?: boolean;
  help?: string;
}

export interface WizardStep {
  id: string;
  title: string;
  /** What this step is for, in one sentence. Shown under the title. */
  help: string;
  /** Masters this step is filled from, named so the screen can say so rather than asking twice. */
  prefilledFrom?: string[];
  fields: WizardField[];
}

export const AGREEMENT_WIZARD: WizardStep[] = [
  {
    id: 'parties',
    title: 'Parties',
    help: 'Who is contracting with whom. The names, addresses and GSTINs come from the company and customer masters; this adds the people who actually sign and receive notices.',
    prefilledFrom: ['company', 'customer'],
    fields: [
      { key: 'customerContactName', label: 'Customer contact', type: 'text', required: true },
      { key: 'customerContactDesignation', label: 'Designation', type: 'text' },
      { key: 'customerContactEmail', label: 'Email for notices', type: 'text', required: true },
      { key: 'noticeAddress', label: 'Address for notices', type: 'textarea', help: 'Leave blank to use the customer master address.' },
    ],
  },
  {
    id: 'warehouse',
    title: 'Warehouse',
    help: 'Which facility, and how much of it. The address comes from the warehouse master.',
    prefilledFrom: ['warehouse'],
    fields: [
      { key: 'areaAllotted', label: 'Area allotted', type: 'text', help: 'e.g. "1,200 sq ft in Zone A" or "40 pallet positions".' },
      { key: 'dedicatedSpace', label: 'Dedicated (not shared) space', type: 'boolean' },
      { key: 'operatingHours', label: 'Operating hours', type: 'text', help: 'e.g. "09:00–18:00, Monday to Saturday".' },
    ],
  },
  {
    id: 'services',
    title: 'Services',
    help: 'What the warehouse will actually do. Anything not listed here is not part of the agreement.',
    fields: [
      { key: 'scope', label: 'Services provided', type: 'textarea', required: true, help: 'Storage, inward handling, put-away, picking, packing, dispatch, returns…' },
      { key: 'valueAdded', label: 'Value-added services', type: 'textarea', help: 'Labelling, kitting, palletization, re-packing.' },
      { key: 'exclusions', label: 'Expressly excluded', type: 'textarea' },
    ],
  },
  {
    id: 'goods',
    title: 'Goods',
    help: 'What is being stored — the description a fire officer, an insurer and a claims adjuster all read.',
    fields: [
      { key: 'description', label: 'Description of goods', type: 'textarea', required: true },
      { key: 'storageConditions', label: 'Storage conditions', type: 'select', options: ['ambient', 'air_conditioned', 'cold_chain', 'frozen'] },
      { key: 'hazardous', label: 'Hazardous or restricted goods', type: 'boolean', help: 'If yes, say which category and licence under Special conditions.' },
      { key: 'specialConditions', label: 'Special conditions', type: 'textarea' },
    ],
  },
  {
    id: 'commercial_terms',
    title: 'Commercial terms',
    help: 'The shape of the deal: how long the rates hold, what is guaranteed, what is billed monthly regardless.',
    fields: [
      { key: 'minimumMonthlyCharge', label: 'Minimum monthly charge', type: 'money' },
      { key: 'minimumGuaranteedVolume', label: 'Minimum guaranteed volume', type: 'text' },
      { key: 'rateRevision', label: 'Rate revision', type: 'text', help: 'e.g. "Annually, by mutual written agreement".' },
      { key: 'securityDeposit', label: 'Security deposit', type: 'money' },
    ],
  },
  {
    id: 'rates',
    title: 'Rates',
    help: 'The priced lines come from the rate card attached to this agreement — that is the one the billing engine will actually use. This step records how they are read.',
    prefilledFrom: ['rateCard'],
    fields: [
      { key: 'rateBasis', label: 'How storage is charged', type: 'select', options: ['per_pallet_per_day', 'per_sqft_per_month', 'per_unit_per_day', 'per_mt_per_month'] },
      { key: 'billingCycle', label: 'Billing cycle', type: 'select', options: ['monthly', 'fortnightly', 'weekly'], required: true },
      { key: 'taxesExtra', label: 'Taxes charged extra', type: 'boolean' },
    ],
  },
  {
    id: 'payment',
    title: 'Payment',
    help: 'When the money is due, and what happens when it is not paid.',
    fields: [
      { key: 'creditDays', label: 'Credit period (days)', type: 'number', required: true },
      { key: 'paymentMode', label: 'Payment mode', type: 'select', options: ['neft', 'rtgs', 'cheque', 'upi', 'other'] },
      { key: 'lateFeePct', label: 'Interest on delayed payment (% per month)', type: 'number' },
      { key: 'disputeWindowDays', label: 'Invoice dispute window (days)', type: 'number' },
    ],
  },
  {
    id: 'liability_insurance',
    title: 'Liability & insurance',
    help: 'Who insures the goods, for how much, and where the warehouse\'s liability stops. The clause most likely to be read out in an argument.',
    fields: [
      { key: 'insuredBy', label: 'Goods insured by', type: 'select', options: ['customer', 'service_provider'], required: true },
      { key: 'insuredValue', label: 'Declared value of goods', type: 'money' },
      { key: 'liabilityCap', label: 'Liability cap', type: 'text', help: 'e.g. "One month\'s storage charges" or a figure.' },
      { key: 'exclusions', label: 'Liability exclusions', type: 'textarea', help: 'Acts of God, inherent vice, pre-existing damage…' },
    ],
  },
  {
    id: 'term',
    title: 'Term',
    help: 'How long it runs. The dates themselves are the agreement\'s own start and end; this is what happens at the end of them.',
    prefilledFrom: ['agreement'],
    fields: [
      { key: 'lockInMonths', label: 'Lock-in (months)', type: 'number' },
      { key: 'renewalTerms', label: 'Renewal terms', type: 'textarea' },
    ],
  },
  {
    id: 'termination',
    title: 'Termination',
    help: 'How either side gets out, and what happens to the goods still in the building when they do.',
    fields: [
      { key: 'noticeDays', label: 'Notice period (days)', type: 'number', required: true },
      { key: 'terminationForCause', label: 'Termination for cause', type: 'textarea' },
      { key: 'goodsRemoval', label: 'Removal of goods on termination', type: 'textarea', required: true, help: 'Who moves them, by when, at whose cost, and what the warehouse may do if they are not collected.' },
    ],
  },
  {
    id: 'signatories',
    title: 'Signatories',
    help: 'Who signs, for each side. Printed under the signature blocks on the agreement itself.',
    fields: [
      { key: 'providerName', label: 'For the service provider — name', type: 'text', required: true },
      { key: 'providerDesignation', label: 'Designation', type: 'text', required: true },
      { key: 'customerName', label: 'For the customer — name', type: 'text', required: true },
      { key: 'customerDesignation', label: 'Designation', type: 'text', required: true },
      { key: 'placeOfExecution', label: 'Place of execution', type: 'text' },
      { key: 'witnesses', label: 'Witnesses', type: 'textarea' },
    ],
  },
];

export const WIZARD_STEPS_BY_ID = new Map(AGREEMENT_WIZARD.map((step) => [step.id, step]));

export interface StepCompletion {
  id: string;
  title: string;
  complete: boolean;
  /** Field labels this step still needs before the agreement can be submitted. */
  missing: string[];
}

/** Empty string counts as unanswered: a form posts '' for a field nobody filled in. */
function isAnswered(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

/**
 * Which steps are done. Used twice: shown on the agreement so someone can
 * see what is left, and checked at submit-for-approval so an incomplete
 * agreement cannot become a document.
 */
export function wizardCompletion(data: Record<string, unknown> | null | undefined): StepCompletion[] {
  return AGREEMENT_WIZARD.map((step) => {
    const answers = (data?.[step.id] ?? {}) as Record<string, unknown>;
    const missing = step.fields
      .filter((field) => field.required && !isAnswered(answers?.[field.key]))
      .map((field) => field.label);
    return { id: step.id, title: step.title, complete: missing.length === 0, missing };
  });
}

/**
 * Refuses a step or a field nobody declared, rather than storing it.
 * `wizard_data` is jsonb, so an unknown key is accepted silently by the
 * database and then never read by anything -- an operator would fill in a
 * field, see it saved, and find it missing from the printed agreement.
 */
export function validateWizardData(data: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const [stepId, answers] of Object.entries(data)) {
    const step = WIZARD_STEPS_BY_ID.get(stepId);
    if (!step) {
      problems.push(`'${stepId}' is not a step of the agreement wizard`);
      continue;
    }
    if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
      problems.push(`Step '${stepId}' must be an object of its own answers`);
      continue;
    }
    const known = new Set(step.fields.map((field) => field.key));
    for (const key of Object.keys(answers as Record<string, unknown>)) {
      if (!known.has(key)) problems.push(`'${key}' is not a field of the '${step.title}' step`);
    }
  }
  return problems;
}

/**
 * The answers as a clause should read them.
 *
 * A `select` stores a machine value (`per_pallet_per_day`,
 * `air_conditioned`) because that is what a stored answer should be --
 * stable, comparable, not a sentence someone retyped. Printed straight
 * into a contract it reads "Storage is charged per_pallet_per_day", which
 * is the sort of thing that makes a document look generated. Only the
 * select fields are touched: free text is printed exactly as it was
 * written.
 */
export function wizardDataForPrinting(
  data: Record<string, unknown> | null | undefined,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const step of AGREEMENT_WIZARD) {
    const answers = (data?.[step.id] ?? {}) as Record<string, unknown>;
    const printed: Record<string, unknown> = { ...answers };
    for (const field of step.fields) {
      const value = answers?.[field.key];
      if (field.type === 'select' && typeof value === 'string') {
        printed[field.key] = value.replace(/_/g, ' ');
      }
      if (field.type === 'boolean' && typeof value === 'boolean') {
        printed[field.key] = value ? 'yes' : 'no';
      }
    }
    out[step.id] = printed;
  }
  return out;
}
