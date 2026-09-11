import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type PaywallBody } from '../lib/api';
import { useToast } from './ui';
import { Paywall } from './Paywall';
import type { Booking } from '../lib/types';

interface Paper {
  slug: string;
  label: string;
  blurb: string;
  /** Whether this paper can be printed yet, given where the booking has got to. */
  ready: (booking: Booking) => boolean;
  notYet: string;
}

const PAPERS: Paper[] = [
  {
    slug: 'inventory-list',
    label: 'Inventory list',
    blurb: 'Item-wise, with the condition of each. The customer signs this one.',
    ready: (b) => (b.items ?? []).length > 0,
    notYet: 'Add the items first.',
  },
  {
    slug: 'receipt',
    label: 'Storage receipt',
    blurb: "What the customer keeps: proof the godown is holding their things.",
    ready: (b) => (b.movements ?? []).some((m) => m.direction === 'in'),
    notYet: 'Record the intake first.',
  },
  {
    slug: 'release-note',
    label: 'Release note',
    blurb: 'What went back, to whom, and on whose authority.',
    ready: (b) => (b.movements ?? []).some((m) => m.direction === 'out'),
    notYet: 'Nothing has gone back yet.',
  },
];

interface Committed {
  id: string;
  documentNumber: string;
}

/**
 * The three papers, printed from the booking.
 *
 * A PDF opens in a new tab, and a new tab carries no Authorization header
 * — so the file is fetched through a short-lived signed link rather than
 * by pointing the browser at an endpoint that would simply 401.
 */
export function Papers({ booking }: { booking: Booking }) {
  const { say } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<PaywallBody | null>(null);

  const generate = async (paper: Paper) => {
    setBusy(paper.slug);
    try {
      const doc = await api<Committed>(`/storage/bookings/${booking.id}/documents/${paper.slug}`, {
        method: 'POST',
        body: {},
      });
      void queryClient.invalidateQueries({ queryKey: ['plan-usage'] });
      say(`${doc.documentNumber} ready`);
      const link = await api<{ url: string }>(`/documents/${doc.id}/download-link`, { method: 'POST' });
      window.open(link.url, '_blank', 'noopener');
    } catch (err) {
      const body = err instanceof ApiError ? err.paywall : null;
      if (body) setPaywall(body);
      else say(err instanceof ApiError ? err.message : 'Could not make that document', true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Papers</h2>
        </div>
        <div className="card-body">
          {PAPERS.map((paper) => {
            const ready = paper.ready(booking);
            return (
              <div key={paper.slug} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                  type="button"
                  className="btn block"
                  style={{ justifyContent: 'space-between' }}
                  disabled={!ready || busy !== null}
                  onClick={() => generate(paper)}
                >
                  <span>{paper.label}</span>
                  <span style={{ color: 'var(--muted)', fontWeight: 500, fontSize: 14 }}>
                    {busy === paper.slug ? 'Making…' : 'PDF'}
                  </span>
                </button>
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {ready ? paper.blurb : paper.notYet}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {paywall ? <Paywall body={paywall} onClose={() => setPaywall(null)} /> : null}
    </>
  );
}
