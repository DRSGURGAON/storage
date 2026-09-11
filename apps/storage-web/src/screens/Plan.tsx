import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { Card, Field, Pill, Sheet, useToast } from '../components/ui';
import type { PlanUsage, UpgradeOptions } from '../lib/types';

/**
 * Plan and usage: what this workspace is on, what it is using, and what
 * the next plan up allows.
 *
 * The headline number is customers in storage, because that is what the
 * plan is priced on. Every figure comes from the same check that blocks an
 * intake, so this page and the refusal can never disagree.
 */
export function Plan() {
  const { session, can } = useSession();
  const [asking, setAsking] = useState<string | null>(null);

  const usage = useQuery({ queryKey: ['plan-usage'], queryFn: () => api<PlanUsage>('/plan/usage') });
  const upgrade = useQuery({
    queryKey: ['upgrade', 'STORAGE_ACTIVE_BOOKING'],
    queryFn: () => api<UpgradeOptions>('/plan/upgrade/STORAGE_ACTIVE_BOOKING'),
    enabled: can('view_plan_usage'),
  });

  if (!can('view_plan_usage')) {
    return (
      <Card>
        <div className="card-body">
          <div className="empty">
            <strong>Only an owner sees the plan</strong>
            <p>Ask the owner of this workspace about the subscription.</p>
          </div>
        </div>
      </Card>
    );
  }

  const bookings = usage.data?.features.find((f) => f.featureCode === 'STORAGE_ACTIVE_BOOKING');
  const godowns = usage.data?.features.find((f) => f.featureCode === 'WAREHOUSE');
  const documents = (usage.data?.features ?? []).filter(
    (f) => f.module === 'storage' && f.featureCode !== 'STORAGE_ACTIVE_BOOKING',
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Plan</h1>
          <p>{session?.tenant.legalName}</p>
        </div>
        {usage.data ? <Pill tone="brand">{usage.data.plan.name}</Pill> : null}
      </div>

      {usage.isLoading ? (
        <div className="empty">Loading…</div>
      ) : (
        <>
          <Card>
            <div className="card-body">
              <span className="section-label">Customers in storage</span>
              {bookings ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span className="num" style={{ fontSize: 38, fontWeight: 680, letterSpacing: '-.02em' }}>
                      {bookings.used}
                    </span>
                    <span style={{ color: 'var(--muted)', fontSize: 16 }}>
                      {bookings.limit === null ? 'no limit' : `of ${bookings.limit}`}
                    </span>
                  </div>
                  <Meter used={bookings.used} limit={bookings.limit} />
                  <p style={{ fontSize: 14, color: 'var(--muted)' }}>
                    Only goods actually in the godown count. Close a booking when a family takes
                    their things home and the slot is free the same day.
                  </p>
                </>
              ) : (
                <p style={{ color: 'var(--muted)' }}>No allowance on this plan.</p>
              )}
            </div>
            {godowns ? (
              <div className="card-foot" style={{ justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted)', fontSize: 14 }}>Godowns</span>
                <strong className="num">
                  {godowns.used} {godowns.limit === null ? '' : `of ${godowns.limit}`}
                </strong>
              </div>
            ) : null}
          </Card>

          {documents.length > 0 ? (
            <Card>
              <div className="card-head">
                <h2>Documents</h2>
              </div>
              <div className="card-body">
                <dl style={{ margin: 0 }}>
                  {documents.map((f) => (
                    <div key={f.featureCode} className="kv">
                      <dt>{f.name}</dt>
                      <dd className="num">
                        {f.limitType === 'unlimited' ? 'No limit' : `${f.used} of ${f.limit}`}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </Card>
          ) : null}

          <Card>
            <div className="card-head">
              <h2>Bigger plans</h2>
            </div>
            <div className="card-body">
              {(upgrade.data?.options.length ?? 0) === 0 ? (
                <p style={{ color: 'var(--muted)', fontSize: 14.5 }}>
                  You are on the largest plan we publish. If you need more than this, tell us — we
                  will work something out.
                </p>
              ) : (
                <>
                  <p style={{ color: 'var(--muted)', fontSize: 14.5 }}>
                    Nothing is charged from inside the app. Ask for a plan and we will get in touch
                    to arrange payment.
                  </p>
                  {upgrade.data!.options.map((option) => (
                    <button
                      key={option.code}
                      type="button"
                      className="btn block"
                      style={{ justifyContent: 'space-between' }}
                      onClick={() => setAsking(option.code)}
                    >
                      <span>
                        {option.name}
                        {option.trialDays > 0 ? ` · ${option.trialDays}-day trial` : ''}
                      </span>
                      <span className="num">
                        ₹{(option.priceMonthly ?? 0).toLocaleString('en-IN')}/mo
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </Card>
        </>
      )}

      {asking ? (
        <AskToUpgrade
          planCode={asking}
          planName={upgrade.data?.options.find((o) => o.code === asking)?.name ?? asking}
          onClose={() => setAsking(null)}
        />
      ) : null}
    </>
  );
}

function Meter({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null) return null;
  const pct = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  const tone = pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warn)' : 'var(--brand)';
  return (
    <div
      style={{ height: 8, borderRadius: 999, background: 'var(--surface-sunken)', overflow: 'hidden' }}
      role="img"
      aria-label={`${used} of ${limit} used`}
    >
      <div style={{ width: `${pct}%`, height: '100%', background: tone }} />
    </div>
  );
}

function AskToUpgrade({
  planCode,
  planName,
  onClose,
}: {
  planCode: string;
  planName: string;
  onClose: () => void;
}) {
  const { say } = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const ask = useMutation({
    mutationFn: () =>
      api<{ message: string }>('/plan/upgrade-request', {
        method: 'POST',
        body: { planCode, ...(note.trim() ? { note: note.trim() } : {}) },
      }),
    onSuccess: (res) => {
      say(res.message);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not send the request'),
  });

  return (
    <Sheet
      title={`Ask for ${planName}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={ask.isPending} onClick={() => ask.mutate()}>
            {ask.isPending ? 'Sending…' : 'Send the request'}
          </button>
        </>
      }
    >
      <div className="notice info">
        Nothing changes on your workspace and nothing is charged. We will call you to arrange
        payment, and move you across once it is in.
      </div>
      <Field label="Anything we should know" hint="How many customers, when you want to start.">
        {(id) => (
          <textarea
            id={id}
            className="textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Around 30 customers, want to start next month"
          />
        )}
      </Field>
      {error ? <div className="notice danger">{error}</div> : null}
    </Sheet>
  );
}
