import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, type PaywallBody } from '../lib/api';
import { pluralNoun } from '../lib/format';
import type { UpgradeOptions } from '../lib/types';
import { Sheet } from './ui';

/**
 * What an operator sees when the plan runs out.
 *
 * Everything on it is server data: the sentence is the 402's own message,
 * built from the feature's name and the workspace's plan, and the list of
 * what a bigger plan gives is the same `plan_feature_limits` rows the
 * engine enforces. Nothing here is written copy about the product, because
 * the screen that asks somebody for money is the last place a promise
 * should be able to drift from what the code allows.
 */
export function Paywall({ body, onClose }: { body: PaywallBody; onClose: () => void }) {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['upgrade', body.featureCode],
    queryFn: () => api<UpgradeOptions>(`/plan/upgrade/${body.featureCode}`),
  });

  const held = body.limitKind === 'resource';
  const noun = body.featureName.toLowerCase();
  const nouns = pluralNoun(noun);

  return (
    <Sheet
      title={`${body.featureName} — plan limit reached`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Not now
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              onClose();
              navigate('/plan');
            }}
          >
            See plans
          </button>
        </>
      }
    >
      <p style={{ fontSize: 16 }}>{body.message}</p>

      {body.limit !== null ? (
        <div className="kv">
          <dt>In use</dt>
          <dd className="num">
            {body.used} of {body.limit}
          </dd>
        </div>
      ) : null}

      {held ? (
        <div className="notice info">
          Nothing you have taken in is affected. When a family takes their things home and you close
          that booking, the slot comes back the same day — you are only ever billed for the{' '}
          {nouns} you are holding.
        </div>
      ) : (
        <div className="notice info">
          Everything already generated stays where it is. This limit is only on making a new copy.
        </div>
      )}

      {data && data.options.length > 0 ? (
        <>
          <span className="section-label">What a larger plan allows</span>
          {data.options.map((option) => (
            <div key={option.code} className="kv">
              <dt>
                <strong style={{ color: 'var(--ink)' }}>{option.name}</strong>
                {option.priceMonthly !== null ? (
                  <span className="num"> · ₹{option.priceMonthly.toLocaleString('en-IN')}/mo</span>
                ) : null}
              </dt>
              <dd className="num">
                {option.limitType === 'unlimited' ? 'No limit' : `${option.limit} ${nouns}`}
              </dd>
            </div>
          ))}
        </>
      ) : null}
    </Sheet>
  );
}
