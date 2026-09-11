import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Card, Empty, Icon, StatusPill } from '../components/ui';
import type { Booking, Paged } from '../lib/types';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'in_storage', label: 'In storage' },
  { value: 'confirmed', label: 'Coming in' },
  { value: 'enquiry', label: 'Enquiries' },
  { value: 'closed', label: 'Closed' },
];

export function Bookings() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const [q, setQ] = useState(params.get('q') ?? '');
  const search = params.get('q') ?? '';

  const { data, isLoading } = useQuery({
    queryKey: ['bookings', status, search],
    queryFn: () =>
      api<Paged<Booking>>(
        `/storage/bookings?limit=50${status ? `&status=${status}` : ''}${search ? `&q=${encodeURIComponent(search)}` : ''}`,
      ),
  });

  const setFilter = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('status', value);
    else next.delete('status');
    setParams(next, { replace: true });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bookings</h1>
          <p>{data ? `${data.total} booking${data.total === 1 ? '' : 's'}` : ' '}</p>
        </div>
        <Link className="btn primary sm" to="/bookings/new">
          {Icon.plus} New
        </Link>
      </div>

      <form
        className="prefixed"
        onSubmit={(e) => {
          e.preventDefault();
          const next = new URLSearchParams(params);
          if (q.trim()) next.set('q', q.trim());
          else next.delete('q');
          setParams(next, { replace: true });
        }}
      >
        <span className="prefix">{Icon.search}</span>
        <input
          className="input"
          type="search"
          inputMode="search"
          placeholder="Name, phone or booking number"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search bookings"
        />
      </form>

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={`btn sm ${status === f.value ? 'primary' : ''}`.trim()}
            style={{ flex: 'none' }}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card>
        {isLoading ? (
          <div className="empty">Loading…</div>
        ) : (data?.items.length ?? 0) === 0 ? (
          <Empty title="Nothing here">
            {search ? 'No booking matches that.' : 'New bookings will show up here.'}
          </Empty>
        ) : (
          data!.items.map((b) => (
            <Link key={b.id} className="row-link" to={`/bookings/${b.id}`}>
              <div className="row-top">
                <strong>{b.customerName ?? 'Customer'}</strong>
                <StatusPill status={b.status} />
              </div>
              <div className="row-sub">
                <span className="num">{b.number}</span>
                {b.customerSnapshot?.mobile ? <span className="dot num">{b.customerSnapshot.mobile}</span> : null}
                <span className="dot num">₹{b.monthlyRent.toLocaleString('en-IN')}/mo</span>
              </div>
            </Link>
          ))
        )}
      </Card>
    </>
  );
}
