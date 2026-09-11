import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { Card, Empty, Icon, StatusPill, Stat } from '../components/ui';
import type { Booking, Paged, StorageUnit } from '../lib/types';

/**
 * What an operator wants on opening the app in the morning: how much is
 * lying in the godown, what is about to arrive, and what space is free.
 *
 * No money tiles yet, on purpose. Rent invoicing is the next slice, and a
 * "₹ due this month" tile that reads zero because the feature does not
 * exist is worse than no tile at all.
 */
export function Home() {
  const { session } = useSession();

  const inStorage = useQuery({
    queryKey: ['bookings', 'in_storage'],
    queryFn: () => api<Paged<Booking>>('/storage/bookings?status=in_storage&limit=5'),
  });
  const upcoming = useQuery({
    queryKey: ['bookings', 'confirmed'],
    queryFn: () => api<Paged<Booking>>('/storage/bookings?status=confirmed&limit=5'),
  });
  const enquiries = useQuery({
    queryKey: ['bookings', 'enquiry'],
    queryFn: () => api<Paged<Booking>>('/storage/bookings?status=enquiry&limit=5'),
  });
  const units = useQuery({
    queryKey: ['units'],
    queryFn: () => api<Paged<StorageUnit>>('/storage/units?limit=100'),
  });

  const vacant = units.data?.items.filter((u) => u.status === 'vacant' && u.isActive).length ?? 0;
  const occupied = units.data?.items.filter((u) => u.status === 'occupied').length ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Today</h1>
          <p>{session?.tenant.legalName}</p>
        </div>
        <Link className="btn primary sm" to="/bookings/new">
          {Icon.plus} New booking
        </Link>
      </div>

      <div className="stats">
        <Stat label="In storage" value={inStorage.data?.total ?? '—'} />
        <Stat label="Coming in" value={upcoming.data?.total ?? '—'} />
        <Stat label="Enquiries" value={enquiries.data?.total ?? '—'} />
        <Stat label="Units free" value={vacant} suffix={units.data ? `of ${vacant + occupied}` : undefined} />
      </div>

      <BookingStrip
        title="Goods in the godown"
        empty="Nothing is in storage yet."
        bookings={inStorage.data?.items ?? []}
        loading={inStorage.isLoading}
      />

      <BookingStrip
        title="Waiting to come in"
        empty="No confirmed bookings waiting."
        bookings={upcoming.data?.items ?? []}
        loading={upcoming.isLoading}
      />
    </>
  );
}

function BookingStrip({
  title,
  empty,
  bookings,
  loading,
}: {
  title: string;
  empty: string;
  bookings: Booking[];
  loading: boolean;
}) {
  return (
    <Card>
      <div className="card-head">
        <h2>{title}</h2>
        <Link className="btn ghost sm" to="/bookings">
          See all
        </Link>
      </div>
      <div style={{ paddingTop: 6 }}>
        {loading ? (
          <div className="empty">Loading…</div>
        ) : bookings.length === 0 ? (
          <Empty title={empty} />
        ) : (
          bookings.map((b) => (
            <Link key={b.id} className="row-link" to={`/bookings/${b.id}`}>
              <div className="row-top">
                <strong>{b.customerName ?? b.customerSnapshot?.name ?? 'Customer'}</strong>
                <StatusPill status={b.status} />
              </div>
              <div className="row-sub">
                <span className="num">{b.number}</span>
                {b.storageUnitCode ? <span className="dot">Unit {b.storageUnitCode}</span> : null}
                <span className="dot num">₹{b.monthlyRent.toLocaleString('en-IN')}/mo</span>
              </div>
            </Link>
          ))
        )}
      </div>
    </Card>
  );
}
