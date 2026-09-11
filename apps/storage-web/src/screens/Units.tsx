import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { Card, Empty, Field, Icon, Pill, Sheet, useToast } from '../components/ui';
import type { Godown, Paged, StorageUnit } from '../lib/types';

const UNIT_TYPES = [
  { value: 'room', label: 'Room' },
  { value: 'locker', label: 'Locker' },
  { value: 'open_area', label: 'Marked floor area' },
  { value: 'pallet', label: 'Pallet' },
  { value: 'container', label: 'Container' },
];

export function Units() {
  const { can } = useSession();
  const [adding, setAdding] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['units'],
    queryFn: () => api<Paged<StorageUnit>>('/storage/units?limit=100'),
  });

  const vacant = data?.items.filter((u) => u.status === 'vacant').length ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Godown</h1>
          <p>{data ? `${vacant} of ${data.total} free` : ' '}</p>
        </div>
        {can('create_warehouse') ? (
          <button type="button" className="btn primary sm" onClick={() => setAdding(true)}>
            {Icon.plus} Add unit
          </button>
        ) : null}
      </div>

      <Card>
        {isLoading ? (
          <div className="empty">Loading…</div>
        ) : (data?.items.length ?? 0) === 0 ? (
          <Empty title="No units yet">
            Units are optional — you can take bookings without them, and add them when you want to
            track which room a family's goods are in.
          </Empty>
        ) : (
          data!.items.map((u) => (
            <div key={u.id} className="row-link" style={{ cursor: 'default' }}>
              <div className="row-top">
                <strong>{u.code}</strong>
                {u.status === 'occupied' ? (
                  <Pill tone="ok">Occupied</Pill>
                ) : u.status === 'maintenance' ? (
                  <Pill tone="warn">Maintenance</Pill>
                ) : (
                  <Pill>Free</Pill>
                )}
              </div>
              <div className="row-sub">
                <span>{UNIT_TYPES.find((t) => t.value === u.unitType)?.label ?? u.unitType}</span>
                {u.areaSqft ? <span className="dot num">{u.areaSqft} sq ft</span> : null}
                {u.monthlyRate ? <span className="dot num">₹{u.monthlyRate.toLocaleString('en-IN')}/mo</span> : null}
                {u.occupiedBy ? <span className="dot num">{u.occupiedBy}</span> : null}
              </div>
            </div>
          ))
        )}
      </Card>

      {adding ? <AddUnit onClose={() => setAdding(false)} /> : null}
    </>
  );
}

function AddUnit({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { say } = useToast();
  const [code, setCode] = useState('');
  const [unitType, setUnitType] = useState('room');
  const [areaSqft, setArea] = useState('');
  const [monthlyRate, setRate] = useState('');
  const [godownId, setGodownId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const godowns = useQuery({ queryKey: ['godowns'], queryFn: () => api<Godown[]>('/warehouses') });
  const only = godowns.data?.length === 1 ? godowns.data[0].id : '';
  const effective = godownId || only;

  const create = useMutation({
    mutationFn: () =>
      api<StorageUnit>('/storage/units', {
        method: 'POST',
        body: {
          warehouseId: effective,
          code: code.trim(),
          unitType,
          ...(areaSqft ? { areaSqft: Number(areaSqft) } : {}),
          ...(monthlyRate ? { monthlyRate: Number(monthlyRate) } : {}),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['units'] });
      say('Unit added');
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not add the unit'),
  });

  return (
    <Sheet
      title="Add a unit"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!code.trim() || !effective || create.isPending}
            onClick={() => {
              setError(null);
              create.mutate();
            }}
          >
            {create.isPending ? 'Saving…' : 'Add unit'}
          </button>
        </>
      }
    >
      <Field label="Godown">
        {(id) => (
          <select id={id} className="select" value={effective} onChange={(e) => setGodownId(e.target.value)}>
            <option value="">Choose a godown</option>
            {(godowns.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.code})
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Unit code" hint="What it is called on the floor — A-12, Locker 7.">
        {(id) => (
          <input
            id={id}
            className="input"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        )}
      </Field>
      <Field label="Kind">
        {(id) => (
          <select id={id} className="select" value={unitType} onChange={(e) => setUnitType(e.target.value)}>
            {UNIT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="field-row">
        <Field label="Size (sq ft)">
          {(id) => (
            <input
              id={id}
              className="input num"
              inputMode="decimal"
              value={areaSqft}
              onChange={(e) => setArea(e.target.value)}
            />
          )}
        </Field>
        <Field label="List rent">
          {(id) => (
            <div className="prefixed">
              <span className="prefix">₹</span>
              <input
                id={id}
                className="input num"
                inputMode="decimal"
                value={monthlyRate}
                onChange={(e) => setRate(e.target.value)}
              />
            </div>
          )}
        </Field>
      </div>
      {error ? <div className="notice danger">{error}</div> : null}
    </Sheet>
  );
}
