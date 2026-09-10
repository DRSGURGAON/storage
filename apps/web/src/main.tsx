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
import { Onboarding } from './screens/Onboarding';
import { Customers } from './screens/masters/Customers';
import { CustomerDetail } from './screens/masters/CustomerDetail';
import { Warehouses, WarehouseDetail } from './screens/masters/Warehouses';
import { Products } from './screens/masters/Products';
import { Transport } from './screens/masters/Transport';
import { RateCards, RateCardDetail } from './screens/masters/RateCards';
import { GateEntries, GateEntryDetail } from './screens/inbound/GateEntries';
import { Inwards, InwardDetail } from './screens/inbound/Inwards';
import { Grns, GrnDetail } from './screens/inbound/Grns';
import {
  Putaways,
  PutawayDetail,
  WarehouseReceipts,
  WarehouseReceiptDetail,
} from './screens/inbound/Putaways';
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
                    <Route path="onboarding" element={<Onboarding />} />
                    <Route path="customers" element={<Customers />} />
                    <Route path="customers/:id" element={<CustomerDetail />} />
                    <Route path="warehouses" element={<Warehouses />} />
                    <Route path="warehouses/:id" element={<WarehouseDetail />} />
                    <Route path="products" element={<Products />} />
                    <Route path="transport" element={<Transport />} />
                    <Route path="rate-cards" element={<RateCards />} />
                    <Route path="rate-cards/:id" element={<RateCardDetail />} />
                    <Route path="gate-entries" element={<GateEntries />} />
                    <Route path="gate-entries/:id" element={<GateEntryDetail />} />
                    <Route path="inwards" element={<Inwards />} />
                    <Route path="inwards/:id" element={<InwardDetail />} />
                    <Route path="grns" element={<Grns />} />
                    <Route path="grns/:id" element={<GrnDetail />} />
                    <Route path="putaways" element={<Putaways />} />
                    <Route path="putaways/:id" element={<PutawayDetail />} />
                    <Route path="warehouse-receipts" element={<WarehouseReceipts />} />
                    <Route path="warehouse-receipts/:id" element={<WarehouseReceiptDetail />} />
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
