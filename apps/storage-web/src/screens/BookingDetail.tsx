import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { Card, Field, Icon, KV, Sheet, StatusPill, useToast } from '../components/ui';
import { categoryLabel, formatDate, idProofLabel } from '../lib/format';
import type { Booking, BookingItem } from '../lib/types';

type Action = 'intake' | 'release' | 'close' | 'cancel' | null;

export function BookingDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useSession();
  const [action, setAction] = useState<Action>(null);

  const { data: booking, isLoading } = useQuery({
    queryKey: ['booking', id],
    queryFn: () => api<Booking>(`/storage/bookings/${id}`),
  });

  if (isLoading) return <div className="empty">Loading…</div>;
  if (!booking) return <div className="empty">This booking is not here.</div>;

  const inStorage = booking.status === 'in_storage';
  const stillInside = (booking.items ?? []).filter((i) => i.inStorageQty > 0);
  const canTakeIn = ['enquiry', 'quoted', 'confirmed'].includes(booking.status);

  return (
    <>
      <div className="page-head">
        <div>
          <button type="button" className="btn ghost sm" style={{ paddingLeft: 0 }} onClick={() => navigate(-1)}>
            {Icon.back} Back
          </button>
          <h1 style={{ marginTop: 4 }}>{booking.customerName ?? 'Customer'}</h1>
          <p className="num">{booking.number}</p>
        </div>
        <StatusPill status={booking.status} />
      </div>

      {booking.status === 'cancelled' && booking.cancelReason ? (
        <div className="notice warn">Cancelled — {booking.cancelReason}</div>
      ) : null}

      <div className="btn-row">
        {canTakeIn && can('confirm_storage_intake') ? (
          <button type="button" className="btn primary" onClick={() => setAction('intake')}>
            Goods arrived
          </button>
        ) : null}
        {inStorage && can('release_storage_goods') ? (
          <button type="button" className="btn primary" onClick={() => setAction('release')}>
            Hand goods back
          </button>
        ) : null}
        {inStorage && stillInside.length === 0 && can('close_storage_booking') ? (
          <button type="button" className="btn" onClick={() => setAction('close')}>
            Close booking
          </button>
        ) : null}
        {canTakeIn && can('edit_storage_booking') ? (
          <button type="button" className="btn danger" onClick={() => setAction('cancel')}>
            Cancel
          </button>
        ) : null}
      </div>

      <Card>
        <div className="card-body">
          <dl style={{ margin: 0 }}>
            <KV label="Phone">
              <span className="num">{booking.customerSnapshot?.mobile ?? '—'}</span>
            </KV>
            <KV label="Godown">
              {booking.warehouseName}
              {booking.storageUnitCode ? ` · Unit ${booking.storageUnitCode}` : ''}
            </KV>
            <KV label="Rent">
              <span className="num">₹{booking.monthlyRent.toLocaleString('en-IN')}</span> / month
            </KV>
            {booking.securityDeposit > 0 ? (
              <KV label="Deposit">
                <span className="num">₹{booking.securityDeposit.toLocaleString('en-IN')}</span>
              </KV>
            ) : null}
            <KV label="In storage since">
              {booking.storageStartDate ? formatDate(booking.storageStartDate) : 'Not yet'}
            </KV>
            <KV label="Notice period">{booking.noticeDays} days</KV>
            {booking.idProofType ? (
              <KV label="ID checked">
                {idProofLabel(booking.idProofType)}
                {booking.idProofLast4 ? ` ••••${booking.idProofLast4}` : ''}
              </KV>
            ) : null}
          </dl>
        </div>
      </Card>

      <Card>
        <div className="card-head">
          <h2>Inventory</h2>
          <span className="pill">
            {stillInside.length} of {(booking.items ?? []).length} still inside
          </span>
        </div>
        <div className="card-body">
          {(booking.items ?? []).length === 0 ? (
            <div className="notice warn">
              No items listed yet. Add the inventory list before the goods arrive — the app will not
              record an intake without one.
            </div>
          ) : (
            (booking.items ?? []).map((item) => <ItemLine key={item.id} item={item} />)
          )}
        </div>
        {booking.declaredValueTotal ? (
          <div className="card-foot" style={{ justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)', fontSize: 14 }}>Declared value</span>
            <strong className="num">₹{booking.declaredValueTotal.toLocaleString('en-IN')}</strong>
          </div>
        ) : null}
      </Card>

      {(booking.movements ?? []).length > 0 ? (
        <Card>
          <div className="card-head">
            <h2>Handovers</h2>
          </div>
          <div style={{ paddingTop: 6 }}>
            {(booking.movements ?? []).map((m) => (
              <div key={m.id} className="row-link" style={{ cursor: 'default' }}>
                <div className="row-top">
                  <strong>{m.direction === 'in' ? 'Goods received' : 'Goods handed back'}</strong>
                  <span className="num" style={{ color: 'var(--muted)', fontSize: 13 }}>
                    {formatDate(m.movementDate)}
                  </span>
                </div>
                <div className="row-sub">
                  <span className="num">{m.number}</span>
                  {m.counterpartyName ? <span className="dot">{m.counterpartyName}</span> : null}
                  {m.vehicleNumber ? <span className="dot num">{m.vehicleNumber}</span> : null}
                </div>
                {m.authorisationNote ? (
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>{m.authorisationNote}</div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {(booking.charges ?? []).length > 0 ? (
        <Card>
          <div className="card-head">
            <h2>One-time charges</h2>
          </div>
          <div className="card-body">
            <dl style={{ margin: 0 }}>
              {(booking.charges ?? []).map((c) => (
                <KV key={c.id} label={c.description}>
                  <span className="num">₹{c.amount.toLocaleString('en-IN')}</span>
                </KV>
              ))}
            </dl>
          </div>
        </Card>
      ) : null}

      {booking.notes ? (
        <Card>
          <div className="card-body">
            <span className="section-label">Notes</span>
            <p style={{ fontSize: 14.5 }}>{booking.notes}</p>
          </div>
        </Card>
      ) : null}

      {action === 'intake' ? <IntakeSheet booking={booking} onClose={() => setAction(null)} /> : null}
      {action === 'release' ? (
        <ReleaseSheet booking={booking} items={stillInside} onClose={() => setAction(null)} />
      ) : null}
      {action === 'close' ? <CloseSheet booking={booking} onClose={() => setAction(null)} /> : null}
      {action === 'cancel' ? <CancelSheet booking={booking} onClose={() => setAction(null)} /> : null}
    </>
  );
}

function ItemLine({ item }: { item: BookingItem }) {
  const gone = item.inStorageQty === 0;
  return (
    <div className="item-line">
      <span className="no">{item.lineNo}</span>
      <div className="body">
        <strong style={gone ? { color: 'var(--muted)' } : undefined}>{item.description}</strong>
        <div className="meta">
          {categoryLabel(item.category)}
          {item.declaredValue ? ` · ₹${item.declaredValue.toLocaleString('en-IN')}` : ''}
        </div>
        {item.conditionNote ? <div className="condition">Noted at intake: {item.conditionNote}</div> : null}
      </div>
      <div className="qty num">
        {item.inStorageQty}
        <small>of {item.quantity}</small>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- actions */

function useAction(bookingId: string, onClose: () => void, successText: string) {
  const queryClient = useQueryClient();
  const { say } = useToast();
  const [error, setError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: (payload: { path: string; body: unknown }) =>
      api<Booking>(`/storage/bookings/${bookingId}${payload.path}`, { method: 'POST', body: payload.body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['booking', bookingId] });
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      void queryClient.invalidateQueries({ queryKey: ['units'] });
      say(successText);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'That did not work'),
  });

  return { run, error, setError };
}

function IntakeSheet({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const { run, error } = useAction(booking.id, onClose, 'Goods recorded as received');
  const [vehicleNumber, setVehicle] = useState('');
  const [driverName, setDriver] = useState('');
  const [counterpartyName, setHandedBy] = useState(booking.customerName ?? '');
  const [remarks, setRemarks] = useState('');
  const noItems = (booking.items ?? []).length === 0;

  return (
    <Sheet
      title="Goods arrived"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Not yet
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={noItems || run.isPending}
            onClick={() =>
              run.mutate({
                path: '/intake',
                body: {
                  ...(vehicleNumber.trim() ? { vehicleNumber: vehicleNumber.trim() } : {}),
                  ...(driverName.trim() ? { driverName: driverName.trim() } : {}),
                  ...(counterpartyName.trim() ? { counterpartyName: counterpartyName.trim() } : {}),
                  ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
                },
              })
            }
          >
            {run.isPending ? 'Saving…' : 'Record intake'}
          </button>
        </>
      }
    >
      {noItems ? (
        <div className="notice danger">
          This booking has no inventory list. Add the items first — once the tempo has been unloaded,
          nobody can reconstruct what was on it.
        </div>
      ) : (
        <div className="notice info">
          This starts the rent from today and marks all {(booking.items ?? []).length} items as in storage.
        </div>
      )}
      <Field label="Vehicle number">
        {(id) => (
          <input
            id={id}
            className="input"
            placeholder="HR26 AB 1234"
            value={vehicleNumber}
            onChange={(e) => setVehicle(e.target.value.toUpperCase())}
          />
        )}
      </Field>
      <Field label="Driver">
        {(id) => <input id={id} className="input" value={driverName} onChange={(e) => setDriver(e.target.value)} />}
      </Field>
      <Field label="Handed over by">
        {(id) => (
          <input id={id} className="input" value={counterpartyName} onChange={(e) => setHandedBy(e.target.value)} />
        )}
      </Field>
      <Field label="Remarks">
        {(id) => (
          <textarea id={id} className="textarea" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        )}
      </Field>
      {error ? <div className="notice danger">{error}</div> : null}
    </Sheet>
  );
}

function ReleaseSheet({
  booking,
  items,
  onClose,
}: {
  booking: Booking;
  items: BookingItem[];
  onClose: () => void;
}) {
  const { run, error } = useAction(booking.id, onClose, 'Handover recorded');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [counterpartyName, setTakenBy] = useState(booking.customerName ?? '');
  const [authorisationNote, setAuth] = useState('');
  const [vehicleNumber, setVehicle] = useState('');

  const lines = items
    .map((item) => ({ item, qty: Number(quantities[item.id] ?? '0') }))
    .filter((l) => l.qty > 0);

  const takeAll = () =>
    setQuantities(Object.fromEntries(items.map((i) => [i.id, String(i.inStorageQty)])));

  return (
    <Sheet
      title="Hand goods back"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={lines.length === 0 || !counterpartyName.trim() || run.isPending}
            onClick={() =>
              run.mutate({
                path: '/release',
                body: {
                  counterpartyName: counterpartyName.trim(),
                  ...(authorisationNote.trim() ? { authorisationNote: authorisationNote.trim() } : {}),
                  ...(vehicleNumber.trim() ? { vehicleNumber: vehicleNumber.trim() } : {}),
                  lines: lines.map((l) => ({ itemId: l.item.id, quantity: l.qty })),
                },
              })
            }
          >
            {run.isPending ? 'Saving…' : `Hand back ${lines.length || ''}`.trim()}
          </button>
        </>
      }
    >
      <div className="notice warn">
        Goods leaving the godown cannot be undone in software. Check who is collecting them before
        you save this.
      </div>

      <Field label="Collected by" hint="The person physically taking the goods.">
        {(id) => (
          <input id={id} className="input" value={counterpartyName} onChange={(e) => setTakenBy(e.target.value)} />
        )}
      </Field>
      <Field
        label="Authorisation"
        hint="If this is not the customer, write how they authorised it."
      >
        {(id) => (
          <input
            id={id}
            className="input"
            placeholder="wife, authorised by customer on call"
            value={authorisationNote}
            onChange={(e) => setAuth(e.target.value)}
          />
        )}
      </Field>
      <Field label="Vehicle number">
        {(id) => (
          <input
            id={id}
            className="input"
            value={vehicleNumber}
            onChange={(e) => setVehicle(e.target.value.toUpperCase())}
          />
        )}
      </Field>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="section-label">What is going back</span>
        <button type="button" className="btn ghost sm" onClick={takeAll}>
          Everything
        </button>
      </div>

      {items.map((item) => (
        <div key={item.id} className="item-line">
          <span className="no">{item.lineNo}</span>
          <div className="body">
            <strong>{item.description}</strong>
            <div className="meta num">{item.inStorageQty} in storage</div>
          </div>
          <input
            className="input num"
            style={{ width: 84, textAlign: 'right' }}
            inputMode="decimal"
            placeholder="0"
            aria-label={`Quantity of ${item.description} going back`}
            value={quantities[item.id] ?? ''}
            onChange={(e) => setQuantities((q) => ({ ...q, [item.id]: e.target.value }))}
          />
        </div>
      ))}

      {error ? <div className="notice danger">{error}</div> : null}
    </Sheet>
  );
}

function CloseSheet({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const { run, error } = useAction(booking.id, onClose, 'Booking closed');
  const [notes, setNotes] = useState('');
  return (
    <Sheet
      title="Close booking"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Not yet
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={run.isPending}
            onClick={() => run.mutate({ path: '/close', body: notes.trim() ? { notes: notes.trim() } : {} })}
          >
            {run.isPending ? 'Saving…' : 'Close it'}
          </button>
        </>
      }
    >
      <div className="notice info">
        Everything has gone back. Closing frees the unit and stops the rent from today.
      </div>
      <Field label="Closing note">
        {(id) => (
          <textarea id={id} className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
        )}
      </Field>
      {error ? <div className="notice danger">{error}</div> : null}
    </Sheet>
  );
}

function CancelSheet({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const { run, error } = useAction(booking.id, onClose, 'Booking cancelled');
  const [reason, setReason] = useState('');
  return (
    <Sheet
      title="Cancel booking"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Keep it
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={!reason.trim() || run.isPending}
            onClick={() => run.mutate({ path: '/cancel', body: { reason: reason.trim() } })}
          >
            {run.isPending ? 'Saving…' : 'Cancel booking'}
          </button>
        </>
      }
    >
      <Field label="Why" hint="Kept on the record, so the same question is not asked twice.">
        {(id) => (
          <input
            id={id}
            className="input"
            autoFocus
            placeholder="customer postponed the move"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
      {error ? <div className="notice danger">{error}</div> : null}
    </Sheet>
  );
}

export function BookingNotFound() {
  return (
    <div className="empty">
      <strong>Not found</strong>
      <p>
        That booking is not in this workspace. <Link to="/bookings">Back to bookings</Link>
      </p>
    </div>
  );
}
