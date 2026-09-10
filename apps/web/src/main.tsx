import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, Button, ConfigProvider, Result, Spin } from 'antd';
import enGB from 'antd/locale/en_GB';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { SessionProvider, useSession } from './lib/session';
import { Login } from './screens/Login';
import { Dashboard } from './screens/Dashboard';
import { Onboarding } from './screens/Onboarding';
import { NotBuilt } from './screens/NotBuilt';
import { AccountSettings, ForgotPassword, ResetPassword } from './screens/Password';
import { DeleteAccountInfo, PrivacyPolicy } from './screens/Legal';
import { PaywallProvider } from './components/Paywall';
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
import { Pods, PodDetail } from './screens/outbound/Pods';
import {
  BillingRuns,
  BillingRunDetail,
  Invoices,
  InvoiceDetail,
  Payments,
  Statements,
} from './screens/billing/Billing';
import { Reports } from './screens/Reports';
import { Documents, DocumentRelations } from './screens/Documents';
import {
  CompanySettings,
  UserSettings,
  PlanSettings,
  AuditSettings,
  NotificationRuleSettings,
  NumberSeriesSettings,
  OperationsSettings,
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
import {
  PortalShell,
  PortalOverview,
  PortalStock,
  PortalReceipts,
  PortalDispatches,
  PortalInvoices,
  PortalStatement,
  PortalDocuments,
} from './screens/portal/Portal';
import 'antd/dist/reset.css';
import './app.css';

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
  const { session, loading, unreachable, retry } = useSession();
  if (loading) return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><Spin size="large" /></div>;
  // Still signed in, but the API did not answer. Sending someone to the
  // login screen here would be a lie -- their session is fine.
  if (unreachable) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 16 }}>
        <Result
          status="warning"
          title="Cannot reach the server"
          subTitle="You are still signed in. This is the connection, not your session."
          extra={
            <Button type="primary" onClick={retry}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/**
 * A customer login lands in the portal, not the staff app.
 *
 * The API is what actually keeps them apart -- the `customer` role holds
 * no staff permission, and `schema/98`'s restrictive policy narrows every
 * read to their own rows -- but sending a customer to a warehouse
 * manager's dashboard would be confusing even where it is harmless, and
 * sending staff into the portal would hide half the product.
 */
function RoleHome() {
  const { session } = useSession();
  if (session?.role.code === 'customer') return <Navigate to="/portal" replace />;
  return <Outlet />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider locale={enGB} theme={{ token: { colorPrimary: '#1f6feb', borderRadius: 6 } }}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <SessionProvider>
              {/*
                Inside the router (it navigates to Plan & Usage) and inside
                the session (it asks whether this person may see a plan at
                all), but outside the routes, so a limit hit on any screen
                raises the same prompt.
              */}
              <PaywallProvider>
              <Routes>
                <Route path="/login" element={<Login />} />
                {/* Both anonymous: someone who cannot sign in is exactly
                    who needs them. */}
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                {/* The two URLs a Play Store listing points at. Public,
                    because a reviewer opens them without an account. */}
                <Route path="/privacy" element={<PrivacyPolicy />} />
                <Route path="/delete-account" element={<DeleteAccountInfo />} />
                <Route element={<RequireSession />}>
                  <Route path="portal" element={<PortalShell />}>
                    <Route index element={<PortalOverview />} />
                    <Route path="stock" element={<PortalStock />} />
                    <Route path="goods-receipts" element={<PortalReceipts />} />
                    <Route path="dispatches" element={<PortalDispatches />} />
                    <Route path="invoices" element={<PortalInvoices />} />
                    <Route path="statement" element={<PortalStatement />} />
                    <Route path="documents" element={<PortalDocuments />} />
                  </Route>
                  <Route element={<RoleHome />}>
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
                    <Route path="pods" element={<Pods />} />
                    <Route path="pods/:id" element={<PodDetail />} />
                    <Route path="billing-runs" element={<BillingRuns />} />
                    <Route path="billing-runs/:id" element={<BillingRunDetail />} />
                    <Route path="invoices" element={<Invoices />} />
                    <Route path="invoices/:id" element={<InvoiceDetail />} />
                    <Route path="payments" element={<Payments />} />
                    <Route path="statements" element={<Statements />} />
                    <Route path="reports" element={<Reports />} />
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
                    <Route path="settings/account" element={<AccountSettings />} />
                    <Route path="settings/company" element={<CompanySettings />} />
                    <Route path="settings/users" element={<UserSettings />} />
                    <Route path="settings/plan" element={<PlanSettings />} />
                    <Route path="settings/notifications" element={<NotificationRuleSettings />} />
                    <Route path="settings/number-series" element={<NumberSeriesSettings />} />
                    <Route path="settings/operations" element={<OperationsSettings />} />
                    <Route path="settings/audit" element={<AuditSettings />} />
                    {/*
                      Everything the navigation offers that has no screen yet.
                      Explicit, so a menu item never leads to a blank page.
                    */}
                    <Route path="*" element={<NotBuilt />} />
                  </Route>
                  </Route>
                </Route>
              </Routes>
              </PaywallProvider>
            </SessionProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
