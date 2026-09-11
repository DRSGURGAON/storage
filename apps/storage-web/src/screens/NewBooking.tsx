import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { Card, Field, Icon, Sheet, useToast } from '../components/ui';
import {
  ID_PROOF_TYPES,
  ITEM_CATEGORIES,
  type Booking,
  type Customer,
  type Godown,
  type Paged,
  type StorageUnit,
} from '../lib/types';

interface DraftItem {
  key: string;
  description: string;
  category: string;
  quantity: string;
  conditionNote: string;
  declaredValue: string;
}

const blankItem = (): DraftItem => ({
  key: Math.random().toString(36).slice(2),
  description: '',
  category: 'carton',
  quantity: '1',
  conditionNote: '',
  declaredValue: '',
});

/**
 * One screen, top to bottom: who, where, how much, and what.
 *
 * Not a wizard. A wizard is right when the steps are long and the user is
 * at a desk; this is filled in standing next to a tempo, and a form you can
 * scroll back up in beats four screens you cannot.
 */
export function NewBooking() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { say } = useToast();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [pickingCustomer, setPickingCustomer] = useState(false);
  const [godownId, setGodownId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [monthlyRent, setMonthlyRent] = useState('');
  const [deposit, setDeposit] = useState('');
  const [noticeDays, setNoticeDays] = useState('30');
  const [idProofType, setIdProofType] = useState('');
  const [idProofLast4, setIdProofLast4] = useState('');
  const [pickupAddress, setPickupAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftItem[]>([blankItem()]);
  const [error, setError] = useState<string | null>(null);

  const godowns = useQuery({ queryKey: ['godowns'], queryFn: () => api<Godown[]>('/warehouses') });

  // One godown is the common case; picking it for them removes a step that
  // has only one answer. The unit list keys off *this*, not the raw state:
  // keying off the untouched state meant the auto-picked godown loaded no
  // units at all, and the picker sat empty with a unit standing free.
  const effectiveGodown = godownId || (godowns.data?.length === 1 ? godowns.data[0].id : '');

  const units = useQuery({
    queryKey: ['units', effectiveGodown],
    queryFn: () =>
      api<Paged<StorageUnit>>(`/storage/units?warehouseId=${effectiveGodown}&status=vacant&limit=100`),
    enabled: Boolean(effectiveGodown),
  });

  const filledItems = useMemo(() => items.filter((i) => i.description.trim()), [items]);
  const declaredTotal = useMemo(
    () => filledItems.reduce((sum, i) => sum + (Number(i.declaredValue) || 0), 0),
    [filledItems],
  );

  const create = useMutation({
    mutationFn: async () => {
      return api<Booking>('/storage/bookings', {
        method: 'POST',
        body: {
          customerId: customer!.id,
          warehouseId: effectiveGodown,
          ...(unitId ? { storageUnitId: unitId } : {}),
          monthlyRent: Number(monthlyRent),
          ...(deposit ? { securityDeposit: Number(deposit) } : {}),
          ...(noticeDays ? { noticeDays: Number(noticeDays) } : {}),
          ...(idProofType ? { idProofType } : {}),
          ...(idProofLast4 ? { idProofLast4 } : {}),
          ...(pickupAddress.trim() ? { pickupAddress: pickupAddress.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          items: filledItems.map((i) => ({
            description: i.description.trim(),
            category: i.category,
            quantity: Number(i.quantity) || 1,
            ...(i.conditionNote.trim() ? { conditionNote: i.conditionNote.trim() } : {}),
            ...(i.declaredValue ? { declaredValue: Number(i.declaredValue) } : {}),
          })),
        },
      });
    },
    onSuccess: (booking) => {
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      say(`Booking ${booking.number} created`);
      navigate(`/bookings/${booking.id}`, { replace: true });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save the booking'),
  });

  const ready = Boolean(customer && effectiveGodown && Number(monthlyRent) >= 0 && monthlyRent !== '');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>New booking</h1>
          <p>Who, where, how much, and what is being stored.</p>
        </div>
      </div>

      <Card>
        <div className="card-body">
          <span className="section-label">Customer</span>
          {customer ? (
            <div className="row-top">
              <div>
                <strong style={{ fontSize: 16 }}>{customer.name}</strong>
                <div className="row-sub">
                  <span className="num">{customer.mobile ?? 'No phone on file'}</span>
                  <span className="dot num">{customer.code}</span>
                </div>
              </div>
              <button type="button" className="btn sm" onClick={() => setPickingCustomer(true)}>
                Change
              </button>
            </div>
          ) : (
            <button type="button" className="btn block" onClick={() => setPickingCustomer(true)}>
              {Icon.plus} Choose or add a customer
            </button>
          )}
        </div>
      </Card>

      <Card>
        <div className="card-body">
          <span className="section-label">Where</span>
          <Field label="Godown">
            {(id) => (
              <select
                id={id}
                className="select"
                value={effectiveGodown}
                onChange={(e) => {
                  setGodownId(e.target.value);
                  setUnitId('');
                }}
              >
                <option value="">Choose a godown</option>
                {(godowns.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.code})
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field
            label="Unit or room"
            hint="Optional. Leave it blank if the goods go into a shared hall."
          >
            {(id) => (
              <select
                id={id}
                className="select"
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                disabled={!effectiveGodown}
              >
                <option value="">No specific unit</option>
                {(units.data?.items ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code}
                    {u.areaSqft ? ` — ${u.areaSqft} sq ft` : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </Card>

      <Card>
        <div className="card-body">
          <span className="section-label">Money</span>
          <div className="field-row">
            <Field label="Rent per month">
              {(id) => (
                <div className="prefixed">
                  <span className="prefix">₹</span>
                  <input
                    id={id}
                    className="input num"
                    inputMode="decimal"
                    placeholder="4500"
                    value={monthlyRent}
                    onChange={(e) => setMonthlyRent(e.target.value)}
                  />
                </div>
              )}
            </Field>
            <Field label="Security deposit">
              {(id) => (
                <div className="prefixed">
                  <span className="prefix">₹</span>
                  <input
                    id={id}
                    className="input num"
                    inputMode="decimal"
                    placeholder="9000"
                    value={deposit}
                    onChange={(e) => setDeposit(e.target.value)}
                  />
                </div>
              )}
            </Field>
          </div>
          <Field label="Notice period" hint="Days of notice before the goods are taken back.">
            {(id) => (
              <input
                id={id}
                className="input num"
                inputMode="numeric"
                value={noticeDays}
                onChange={(e) => setNoticeDays(e.target.value)}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card>
        <div className="card-head">
          <span className="section-label">What is being stored</span>
          <span className="pill">{filledItems.length} item{filledItems.length === 1 ? '' : 's'}</span>
        </div>
        <div className="card-body">
          <div className="notice info">
            Write the condition of anything already damaged — a scratch, a dent, a torn cover.
            This is the line that settles an argument when the goods go back.
          </div>

          {items.map((item, index) => (
            <div key={item.key} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {index > 0 ? <hr className="divider" /> : null}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="section-label">Item {index + 1}</span>
                {items.length > 1 ? (
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => setItems((all) => all.filter((i) => i.key !== item.key))}
                  >
                    Remove
                  </button>
                ) : null}
              </div>

              <Field label="What is it">
                {(id) => (
                  <input
                    id={id}
                    className="input"
                    placeholder="Godrej almirah, 3 door"
                    value={item.description}
                    onChange={(e) => patch(setItems, item.key, { description: e.target.value })}
                  />
                )}
              </Field>

              <div className="field-row">
                <Field label="Kind">
                  {(id) => (
                    <select
                      id={id}
                      className="select"
                      value={item.category}
                      onChange={(e) => patch(setItems, item.key, { category: e.target.value })}
                    >
                      {ITEM_CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="How many">
                  {(id) => (
                    <input
                      id={id}
                      className="input num"
                      inputMode="decimal"
                      value={item.quantity}
                      onChange={(e) => patch(setItems, item.key, { quantity: e.target.value })}
                    />
                  )}
                </Field>
              </div>

              <Field label="Condition now" hint="Leave blank if it is in good condition.">
                {(id) => (
                  <input
                    id={id}
                    className="input"
                    placeholder="left door scratched"
                    value={item.conditionNote}
                    onChange={(e) => patch(setItems, item.key, { conditionNote: e.target.value })}
                  />
                )}
              </Field>

              <Field label="Declared value" hint="What the customer says it is worth.">
                {(id) => (
                  <div className="prefixed">
                    <span className="prefix">₹</span>
                    <input
                      id={id}
                      className="input num"
                      inputMode="decimal"
                      value={item.declaredValue}
                      onChange={(e) => patch(setItems, item.key, { declaredValue: e.target.value })}
                    />
                  </div>
                )}
              </Field>
            </div>
          ))}

          <button type="button" className="btn block" onClick={() => setItems((all) => [...all, blankItem()])}>
            {Icon.plus} Add another item
          </button>

          {declaredTotal > 0 ? (
            <div className="kv">
              <dt>Declared value, total</dt>
              <dd className="num">₹{declaredTotal.toLocaleString('en-IN')}</dd>
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <div className="card-body">
          <span className="section-label">ID and pickup</span>
          <div className="field-row">
            <Field label="ID shown">
              {(id) => (
                <select
                  id={id}
                  className="select"
                  value={idProofType}
                  onChange={(e) => setIdProofType(e.target.value)}
                >
                  <option value="">Not recorded</option>
                  {ID_PROOF_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Last 4 digits" hint="Only the last four are stored.">
              {(id) => (
                <input
                  id={id}
                  className="input num"
                  inputMode="numeric"
                  maxLength={4}
                  value={idProofLast4}
                  onChange={(e) => setIdProofLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
              )}
            </Field>
          </div>
          <Field label="Pickup address">
            {(id) => (
              <textarea
                id={id}
                className="textarea"
                placeholder="Where the goods are being collected from"
                value={pickupAddress}
                onChange={(e) => setPickupAddress(e.target.value)}
              />
            )}
          </Field>
          <Field label="Notes">
            {(id) => (
              <textarea
                id={id}
                className="textarea"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
          </Field>
        </div>
      </Card>

      {error ? <div className="notice danger">{error}</div> : null}

      <button
        type="button"
        className="btn primary block"
        disabled={!ready || create.isPending}
        onClick={() => {
          setError(null);
          create.mutate();
        }}
      >
        {create.isPending ? 'Saving…' : 'Create booking'}
      </button>
      <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
        The goods are not in storage yet — record the intake when the tempo actually arrives.
      </p>

      {pickingCustomer ? (
        <CustomerPicker
          onClose={() => setPickingCustomer(false)}
          onPick={(c) => {
            setCustomer(c);
            setPickingCustomer(false);
          }}
        />
      ) : null}
    </>
  );
}

function patch(
  setItems: React.Dispatch<React.SetStateAction<DraftItem[]>>,
  key: string,
  values: Partial<DraftItem>,
) {
  setItems((all) => all.map((i) => (i.key === key ? { ...i, ...values } : i)));
}

/**
 * Search first, add second -- a repeat customer is common in this trade
 * (the same family storing again after a posting), and creating a
 * duplicate is how their history gets split in two.
 */
function CustomerPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (customer: Customer) => void;
}) {
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const found = useQuery({
    queryKey: ['customers', q],
    queryFn: () => api<Paged<Customer>>(`/customers?limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  });

  const create = useMutation({
    mutationFn: () =>
      api<Customer>('/customers', {
        method: 'POST',
        body: { name: name.trim(), customerType: 'individual', ...(mobile.trim() ? { mobile: mobile.trim() } : {}) },
      }),
    onSuccess: (customer) => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      onPick(customer);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not add the customer'),
  });

  return (
    <Sheet title={adding ? 'New customer' : 'Choose customer'} onClose={onClose}>
      {adding ? (
        <>
          <Field label="Name">
            {(id) => (
              <input id={id} className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <Field label="Phone">
            {(id) => (
              <input
                id={id}
                className="input num"
                inputMode="tel"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
              />
            )}
          </Field>
          {error ? <div className="notice danger">{error}</div> : null}
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => setAdding(false)}>
              Back
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!name.trim() || create.isPending}
              onClick={() => {
                setError(null);
                create.mutate();
              }}
            >
              {create.isPending ? 'Saving…' : 'Add customer'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="prefixed">
            <span className="prefix">{Icon.search}</span>
            <input
              className="input"
              type="search"
              placeholder="Name or phone"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search customers"
            />
          </div>
          <div style={{ margin: '0 -16px' }}>
            {found.isLoading ? (
              <div className="empty">Searching…</div>
            ) : (found.data?.items.length ?? 0) === 0 ? (
              <div className="empty">
                <strong>No customer found</strong>
                <p>Add them below — name and phone are enough to start.</p>
              </div>
            ) : (
              found.data!.items.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="row-link"
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--rule)', font: 'inherit', cursor: 'pointer' }}
                  onClick={() => onPick(c)}
                >
                  <div className="row-top">
                    <strong>{c.name}</strong>
                  </div>
                  <div className="row-sub">
                    <span className="num">{c.mobile ?? 'No phone'}</span>
                    <span className="dot num">{c.code}</span>
                  </div>
                </button>
              ))
            )}
          </div>
          <button type="button" className="btn primary block" onClick={() => setAdding(true)}>
            {Icon.plus} Add a new customer
          </button>
        </>
      )}
    </Sheet>
  );
}
