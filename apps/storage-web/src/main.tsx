import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import './app.css';
import { Icon, ToastProvider } from './components/ui';
import { SessionProvider, useSession } from './lib/session';
import { Bookings } from './screens/Bookings';
import { BookingDetail } from './screens/BookingDetail';
import { Home } from './screens/Home';
import { Login } from './screens/Login';
import { NewBooking } from './screens/NewBooking';
import { Units } from './screens/Units';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A godown has patchy signal; a failed read should retry once rather
      // than either giving up instantly or hammering a dead connection.
      retry: 1,
      refetchOnWindowFocus: true,
      staleTime: 15_000,
    },
  },
});

function Shell() {
  const { session, signOut } = useSession();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brandmark">SB</div>
        <div className="who">
          <strong>{session?.tenant.legalName}</strong>
          <span>{session?.role.name}</span>
        </div>
        {session?.tenant.isDemo ? <span className="pill warn">Demo</span> : null}
        <button type="button" className="btn ghost sm" onClick={signOut}>
          Sign out
        </button>
      </header>

      <main className="page">
        <Outlet />
      </main>

      <nav className="tabbar">
        <NavLink to="/" end>
          {Icon.home}
          Today
        </NavLink>
        <NavLink to="/bookings">
          {Icon.bookings}
          Bookings
        </NavLink>
        <NavLink to="/units">
          {Icon.godown}
          Godown
        </NavLink>
      </nav>
    </div>
  );
}

function Gate() {
  const { session, loading } = useSession();
  if (loading) {
    return (
      <div className="login-wrap">
        <div className="empty">Loading…</div>
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <Shell />;
}

function LoginRoute() {
  const { session, loading } = useSession();
  if (loading) return null;
  if (session) return <Navigate to="/" replace />;
  return <Login />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <ToastProvider>
            <Routes>
              <Route path="/login" element={<LoginRoute />} />
              <Route element={<Gate />}>
                <Route index element={<Home />} />
                <Route path="bookings" element={<Bookings />} />
                <Route path="bookings/new" element={<NewBooking />} />
                <Route path="bookings/:id" element={<BookingDetail />} />
                <Route path="units" element={<Units />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ToastProvider>
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
