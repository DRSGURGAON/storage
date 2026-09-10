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
import { NotBuilt } from './screens/NotBuilt';
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
import { Stock, StockLedger, Ageing } from './screens/stock/Stock';
import { ReleaseOrders, ReleaseOrderDetail } from './screens/outbound/ReleaseOrders';
import { PickLists, PickListDetail, Dispatches, DispatchDetail } from './screens/outbound/Dispatches';
import {
  BillingRuns,
  BillingRunDetail,
  Invoices,
  InvoiceDetail,
  Payments,
  Statements,
} from './screens/billing/Billing';
import { Documents, DocumentRelations } from './screens/Documents';
import {
  CompanySettings,
  UserSettings,
  PlanSettings,
  AuditSettings,
  Notifications,
} from './screens/settings/Settings';
import {
  Quotations,
  QuotationDetail,
  Agreements,
  AgreementDetail,
  StockTransfers,
  StockTransferDetail,
  StockVerifications,
  StockVerificationDetail,
  ReturnRequests,
  ReturnRequestDetail,
} from './screens/Remaining';
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
                    <Route path="stock" element={<Stock />} />
                    <Route path="stock/ledger" element={<StockLedger />} />
                    <Route path="reports/ageing" element={<Ageing />} />
                    <Route path="release-orders" element={<ReleaseOrders />} />
                    <Route path="release-orders/:id" element={<ReleaseOrderDetail />} />
                    <Route path="pick-lists" element={<PickLists />} />
                    <Route path="pick-lists/:id" element={<PickListDetail />} />
                    <Route path="dispatches" element={<Dispatches />} />
                    <Route path="dispatches/:id" element={<DispatchDetail />} />
                    <Route path="billing-runs" element={<BillingRuns />} />
                    <Route path="billing-runs/:id" element={<BillingRunDetail />} />
                    <Route path="invoices" element={<Invoices />} />
                    <Route path="invoices/:id" element={<InvoiceDetail />} />
                    <Route path="payments" element={<Payments />} />
                    <Route path="statements" element={<Statements />} />
                    <Route path="documents" element={<Documents />} />
                    <Route path="documents/:sourceType/:sourceId" element={<DocumentRelations />} />
                    <Route path="quotations" element={<Quotations />} />
                    <Route path="quotations/:id" element={<QuotationDetail />} />
                    <Route path="agreements" element={<Agreements />} />
                    <Route path="agreements/:id" element={<AgreementDetail />} />
                    <Route path="stock-transfers" element={<StockTransfers />} />
                    <Route path="stock-transfers/:id" element={<StockTransferDetail />} />
                    <Route path="stock-verifications" element={<StockVerifications />} />
                    <Route path="stock-verifications/:id" element={<StockVerificationDetail />} />
                    <Route path="return-requests" element={<ReturnRequests />} />
                    <Route path="return-requests/:id" element={<ReturnRequestDetail />} />
                    <Route path="notifications" element={<Notifications />} />
                    <Route path="settings/company" element={<CompanySettings />} />
                    <Route path="settings/users" element={<UserSettings />} />
                    <Route path="settings/plan" element={<PlanSettings />} />
                    <Route path="settings/audit" element={<AuditSettings />} />
                    {/*
                      Everything the navigation offers that has no screen yet.
                      Explicit, so a menu item never leads to a blank page.
                    */}
                    <Route path="*" element={<NotBuilt />} />
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
