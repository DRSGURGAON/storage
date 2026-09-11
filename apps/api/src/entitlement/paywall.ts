import type postgres from 'postgres';
import { CheckEntitlementResult } from './entitlement.types';
import { resourceLimitFor } from './resource-limits';

/**
 * Who the block happened to, in the words a person would use: the feature
 * they clicked and the plan they are on.
 *
 * `ux-system.md` §11 is explicit that the upgrade prompt is "never a bare
 * 'Payment required' dialog" and that its copy is "templated per feature
 * ... pulling `featureName` from `feature_keys.name`". Both halves of that
 * sentence are a database read, so the sentence itself is built here --
 * once -- rather than in each caller that can hit a limit.
 */
export interface PaywallContext {
  featureCode: string;
  featureName: string;
  planCode: string | null;
  planName: string | null;
}

export async function loadPaywallContext(
  tx: postgres.TransactionSql,
  tenantId: string,
  featureCode: string,
): Promise<PaywallContext> {
  const [feature] = await tx<{ name: string }[]>`
    select name from feature_keys where code = ${featureCode}
  `;
  // A workspace with no subscription row at all is a real state (an
  // inactive or never-created subscription), not an error to throw from
  // inside a paywall -- the message below simply says "no active plan".
  const [plan] = await tx<{ code: string; name: string }[]>`
    select p.code, p.name from tenant_subscriptions ts join plans p on p.id = ts.plan_id
    where ts.tenant_id = ${tenantId}
  `;
  return {
    featureCode,
    featureName: feature?.name ?? featureCode,
    planCode: plan?.code ?? null,
    planName: plan?.name ?? null,
  };
}

/**
 * The sentence the 402 carries in `message`.
 *
 * It exists because a client that reads only `message` -- Nest's own
 * convention for every other error this API raises -- previously got
 * nothing at all from a paywall body, and fell back to "Request failed
 * (402)" at the exact moment the product is asking someone to pay.
 */
export function paywallMessage(ctx: PaywallContext, result: CheckEntitlementResult): string {
  const plan = ctx.planName ? `the ${ctx.planName} plan` : 'this workspace’s plan';
  const feature = lowerFirst(ctx.featureName);
  if (result.reason === 'FEATURE_DISABLED') {
    return `${ctx.featureName} is not part of ${plan}.`;
  }
  if (result.reason === 'SUBSCRIPTION_INACTIVE') {
    return `This workspace has no active subscription, so ${feature} is paused.`;
  }
  if (result.limit === null) {
    return `You have reached ${plan}’s limit for ${feature}.`;
  }

  // A resource is held, not spent, so "you have used your 1 free godown
  // copy" is wrong twice over: nothing was consumed, and closing one gives
  // the slot straight back. Say what is in use and what the plan allows,
  // which is also the sentence that makes the upgrade obvious.
  if (resourceLimitFor(ctx.featureCode)) {
    const allowed = result.limit === 1 ? `1 ${feature}` : `${result.limit} ${plural(feature)}`;
    const inUse =
      result.used === result.limit
        ? result.limit === 1
          ? 'and it is in use'
          : `and all ${result.limit} are in use`
        : `and ${result.used} of those are in use`;
    return `${capitalise(plan)} includes ${allowed}, ${inUse}.`;
  }

  const copies = result.limit === 1 ? 'copy' : 'copies';
  return `You have used your ${result.limit} free ${feature} ${copies} on ${plan}.`;
}

/**
 * Enough pluralisation for a feature name, which is a short noun phrase
 * chosen by us and stored in `feature_keys.name` -- not arbitrary text.
 *
 * The head noun is what takes the plural, not the last word: "customer in
 * storage" has to become "customers in storage", and the first version of
 * this said "customer in storages" in the one sentence whose job is to ask
 * somebody for money.
 */
function plural(noun: string): string {
  const head = noun.match(/^(.*?)(\s+(?:in|on|of|per|for|with)\s+.*)$/i);
  if (head) return `${plural(head[1])}${head[2]}`;
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lowerFirst(text: string): string {
  // "GRN generation" must stay "GRN generation"; only a leading capital
  // followed by a lowercase letter is a sentence-cased word.
  return /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}
