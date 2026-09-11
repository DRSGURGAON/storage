import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type PaywallBody } from '../lib/api';
import { useSession } from '../lib/session';
import { Card, Field, Money, Sheet, useToast } from '../components/ui';
import { Paywall } from './Paywall';
import { formatDate } from '../lib/format';
import type { Booking, RentInvoice, RentPreview } from '../lib/types';

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The end of the month a date falls in, as YYYY-MM-DD. */
function endOfMonth(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Rent on a booking: what has been billed, what is still owed, and the
 * button that raises the next bill.
 *
 * The godown owner's whole commercial life is on this card. It is
 * deliberately not a billing module -- there is no run to configure and no
 * approval queue to clear, because the person tapping the button is the
 * person who hands the bill over.
 */
export function Rent({ booking }: { booking: Booking }) {
  const { can } = useSession();
  const { say } = useToast();
  const [billing, setBilling] = useState(false);
  const [paywall, setPaywall] = useState<PaywallBody | null>(null);

  const { data: invoices } = useQuery({
    queryKey: ['booking-invoices', booking.id],
    queryFn: () => api<RentInvoice[]>(`/storage/bookings/${booking.id}/invoices`),
  });

  const arrived = Boolean(booking.storageStartDate);
  const outstanding = (invoices ?? []).reduce((sum, i) => sum + i.outstanding, 0);
  const mayBill = can('create_invoice') && arrived && booking.status !== 'cancelled';

  /** A tax invoice opens the way every other paper does: signed link, new tab. */
  const openPdf = async (invoiceId: string) => {
    try {
      const doc = await api<{ id: string }>(`/invoices/${invoiceId}/document`, { method: 'POST', body: {} });
      const link = await api<{ url: string }>(`/documents/${doc.id}/download-link`, { method: 'POST' });
      window.open(link.url, '_blank', 'noopener');
    } catch (err) {
      const body = err instanceof ApiError ? err.paywall : null;
      if (body) setPaywall(body);
      else say(err instanceof ApiError ? err.message : 'Could not open that bill', true);
    }
  };

  return (
    <>
      <Card>
        <div className="card-head">
          <h2>Rent</h2>
          {booking.rentBilledUpto ? (
            <span className="pill">Billed to {formatDate(booking.rentBilledUpto)}</span>
          ) : null}
        </div>

        {(invoices ?? []).length === 0 ? (
          <div className="card-body">
            <p style={{ fontSize: 14, color: 'var(--muted)' }}>
              {arrived
                ? `No bill raised yet. Rent runs from ${formatDate(booking.storageStartDate)} at ₹${booking.monthlyRent.toLocaleString('en-IN')} a month.`
                : 'Rent starts the day the goods arrive.'}
            </p>
          </div>
        ) : (
          <div style={{ paddingTop: 6 }}>
            {(invoices ?? []).map((inv) => (
              <button
                key={inv.invoiceId}
                type="button"
                className="row-link"
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--rule)' }}
                onClick={() => void openPdf(inv.invoiceId)}
              >
                <div className="row-top">
                  <strong className="num">{inv.number}</strong>
                  <strong className="num">
                    <Money value={inv.grandTotal} />
                  </strong>
                </div>
                <div className="row-sub">
                  <span>
                    {formatDate(inv.periodStart)} – {formatDate(inv.periodEnd)}
                  </span>
                  {inv.outstanding > 0 ? (
                    <span className="dot" style={{ color: 'var(--warn)' }}>
                      ₹{inv.outstanding.toLocaleString('en-IN')} due
                    </span>
                  ) : (
                    <span className="dot" style={{ color: 'var(--ok)' }}>
                      Paid
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {outstanding > 0 ? (
          <div className="card-foot" style={{ justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)', fontSize: 14 }}>Outstanding</span>
            <strong className="num">₹{outstanding.toLocaleString('en-IN')}</strong>
          </div>
        ) : null}

        {mayBill ? (
          <div className="card-foot">
            <button type="button" className="btn primary block" onClick={() => setBilling(true)}>
              Bill rent
            </button>
          </div>
        ) : null}
      </Card>

      {billing ? <RentSheet booking={booking} onClose={() => setBilling(false)} /> : null}
      {paywall ? <Paywall body={paywall} onClose={() => setPaywall(null)} /> : null}
    </>
  );
}

/**
 * The bill before it exists.
 *
 * Nothing is raised until the operator has seen the period, the number of
 * days and the amount -- a rent bill that surprises a customer is a
 * WhatsApp argument the godown owner has to win without paperwork.
 */
function RentSheet({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { say } = useToast();
  // Where the *unbilled* period starts: the day after the last bill, not
  // the day the last bill ended. Getting this wrong re-proposes a month
  // that has already been billed, and the sheet opens on a refusal.
  const from = booking.rentBilledUpto
    ? addDays(booking.rentBilledUpto, 1)
    : (booking.storageStartDate ?? today());
  const [periodEnd, setPeriodEnd] = useState(() => {
    const candidate = endOfMonth(from);
    // Default to the month the unbilled period starts in, unless that
    // month has not finished yet -- nobody bills September on the 11th.
    return candidate <= today() ? candidate : today();
  });
  const [paywall, setPaywall] = useState<PaywallBody | null>(null);

  const preview = useQuery({
    queryKey: ['rent-preview', booking.id, periodEnd],
    queryFn: () =>
      api<RentPreview>(`/storage/bookings/${booking.id}/invoice/preview`, {
        method: 'POST',
        body: { periodEnd },
      }),
    retry: false,
    // Never answered from cache: what the next bill says changes the
    // moment one is raised, and a stale preview is a wrong amount shown
    // with total confidence.
    gcTime: 0,
    staleTime: 0,
  });

  const raise = useMutation({
    mutationFn: () =>
      api<{ invoice: { id: string; number: string } }>(`/storage/bookings/${booking.id}/invoice`, {
        method: 'POST',
        body: { periodEnd },
      }),
    onSuccess: async (result) => {
      void queryClient.invalidateQueries({ queryKey: ['booking', booking.id] });
      void queryClient.invalidateQueries({ queryKey: ['booking-invoices', booking.id] });
      // The preview is deliberately *not* invalidated: this sheet is
      // closing, and refetching it here only asks the server to refuse a
      // period that was just billed.
      void queryClient.invalidateQueries({ queryKey: ['plan-usage'] });
      say(`${result.invoice.number} raised`);
      onClose();
    },
    onError: (err) => {
      const body = err instanceof ApiError ? err.paywall : null;
      if (body) setPaywall(body);
    },
  });

  if (paywall) {
    return (
      <Paywall
        body={paywall}
        onClose={() => {
          setPaywall(null);
          onClose();
        }}
      />
    );
  }

  const problem =
    preview.error instanceof ApiError
      ? preview.error.message
      : raise.error instanceof ApiError
        ? raise.error.message
        : null;
  const ready = preview.data !== undefined && preview.error === null;

  return (
    <Sheet
      title="Bill rent"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Not now
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!ready || raise.isPending}
            onClick={() => raise.mutate()}
          >
            {raise.isPending ? 'Raising…' : 'Raise bill'}
          </button>
        </>
      }
    >
      <Field label="Bill up to" hint="Rent is charged by the day for a part month.">
        {(id) => (
          <input
            id={id}
            type="date"
            className="input"
            value={periodEnd}
            min={booking.storageStartDate ?? undefined}
            onChange={(e) => setPeriodEnd(e.target.value)}
          />
        )}
      </Field>

      {problem ? <div className="notice warn">{problem}</div> : null}

      {preview.isFetching ? <p style={{ color: 'var(--muted)', fontSize: 14 }}>Working it out…</p> : null}

      {ready && preview.data ? (
        <>
          <div className="notice info">
            {formatDate(preview.data.periodStart)} to {formatDate(preview.data.periodEnd)} —{' '}
            {preview.data.days} day{preview.data.days === 1 ? '' : 's'}
          </div>
          <dl style={{ margin: 0 }}>
            <div className="kv">
              <dt>{preview.data.description}</dt>
              <dd>
                <Money value={preview.data.rentAmount} />
              </dd>
            </div>
            {preview.data.charges.map((c) => (
              <div className="kv" key={c.id}>
                <dt>{c.description}</dt>
                <dd>
                  <Money value={c.amount} />
                </dd>
              </div>
            ))}
            <div className="kv">
              <dt>
                <strong>Before GST</strong>
              </dt>
              <dd>
                <strong>
                  <Money value={preview.data.subtotal} />
                </strong>
              </dd>
            </div>
          </dl>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 10 }}>
            GST at 18% is added on the invoice, split as CGST and SGST or charged as IGST depending on
            the customer's state.
          </p>
        </>
      ) : null}
    </Sheet>
  );
}
