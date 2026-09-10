import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider, Spin } from 'antd';
import enGB from 'antd/locale/en_GB';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { SessionProvider, useSession } from './lib/session';
import { Login } from './screens/Login';
import { Dashboard } from './screens/Dashboard';
import 'antd/dist/reset.css';

/**
 * One retry, not three. This app's failures are overwhelmingly 4xx --
 * a permission the role does not hold, a status transition the record does
 * not allow -- and retrying those just delays the message the user needs
 * to read.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
});

function RequireSession() {
  const { session, loading } = useSession();
  if (loading) return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><Spin size="large" /></div>;
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider locale={enGB} theme={{ token: { colorPrimary: '#1f6feb', borderRadius: 6 } }}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <SessionProvider>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route element={<RequireSession />}>
                  <Route element={<AppShell />}>
                    <Route index element={<Dashboard />} />
                  </Route>
                </Route>
              </Routes>
            </SessionProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
