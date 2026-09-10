import { useMemo } from 'react';
import { Alert, Avatar, Dropdown, Layout, Menu, Tag, Typography } from 'antd';
import {
  ApartmentOutlined,
  BellOutlined,
  DashboardOutlined,
  FileTextOutlined,
  InboxOutlined,
  LogoutOutlined,
  ProfileOutlined,
  SendOutlined,
  SettingOutlined,
  ShopOutlined,
  SolutionOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';

const { Header, Sider, Content } = Layout;

interface NavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  /** Hidden when the role holds none of these. An empty list means "always". */
  permissions?: string[];
  children?: { key: string; label: string; permissions?: string[] }[];
}

/**
 * `ux-system.md` §2's navigation, filtered by what the role may actually
 * do. A Billing Executive has no business seeing an Inbound menu that 403s
 * on every item -- but the filtering is presentation only, and a user who
 * types the URL still gets the API's own refusal, which is the control.
 */
const NAV: NavItem[] = [
  { key: '/', label: 'Dashboard', icon: <DashboardOutlined /> },
  {
    key: 'masters',
    label: 'Masters',
    icon: <ShopOutlined />,
    permissions: ['view_customer', 'view_warehouse', 'view_product', 'view_rate_card', 'view_transport_master'],
    children: [
      { key: '/customers', label: 'Customers', permissions: ['view_customer'] },
      { key: '/warehouses', label: 'Warehouses', permissions: ['view_warehouse'] },
      { key: '/products', label: 'Products', permissions: ['view_product'] },
      { key: '/transport', label: 'Transport', permissions: ['view_transport_master'] },
      { key: '/rate-cards', label: 'Rate cards', permissions: ['view_rate_card'] },
    ],
  },
  {
    key: 'commercial',
    label: 'Commercial',
    icon: <SolutionOutlined />,
    permissions: ['view_quotation', 'view_agreement'],
    children: [
      { key: '/quotations', label: 'Quotations', permissions: ['view_quotation'] },
      { key: '/agreements', label: 'Agreements', permissions: ['view_agreement'] },
    ],
  },
  {
    key: 'inbound',
    label: 'Inbound',
    icon: <InboxOutlined />,
    permissions: ['create_gate_entry', 'create_inward', 'create_grn', 'create_putaway', 'issue_warehouse_receipt'],
    children: [
      { key: '/gate-entries', label: 'Gate entries', permissions: ['create_gate_entry'] },
      { key: '/inwards', label: 'Inwards', permissions: ['create_inward'] },
      { key: '/grns', label: 'GRNs', permissions: ['create_grn'] },
      { key: '/putaways', label: 'Put-aways', permissions: ['create_putaway'] },
      { key: '/warehouse-receipts', label: 'Warehouse receipts', permissions: ['issue_warehouse_receipt'] },
    ],
  },
  {
    key: 'stock',
    label: 'Stock',
    icon: <ApartmentOutlined />,
    permissions: ['view_stock', 'view_stock_ledger', 'create_stock_transfer', 'create_stock_verification', 'view_reports'],
    children: [
      { key: '/stock', label: 'Stock on hand', permissions: ['view_stock'] },
      { key: '/stock/ledger', label: 'Ledger', permissions: ['view_stock_ledger'] },
      { key: '/stock-transfers', label: 'Transfers', permissions: ['create_stock_transfer'] },
      { key: '/stock-verifications', label: 'Verifications', permissions: ['create_stock_verification'] },
      { key: '/reports/ageing', label: 'Ageing', permissions: ['view_reports'] },
    ],
  },
  {
    key: 'outbound',
    label: 'Outbound',
    icon: <SendOutlined />,
    permissions: ['create_release_order', 'create_pick_list', 'create_dispatch', 'create_return_request'],
    children: [
      { key: '/release-orders', label: 'Release orders', permissions: ['create_release_order'] },
      { key: '/pick-lists', label: 'Pick lists', permissions: ['create_pick_list'] },
      { key: '/dispatches', label: 'Dispatches', permissions: ['create_dispatch'] },
      { key: '/return-requests', label: 'Returns', permissions: ['create_return_request'] },
    ],
  },
  {
    key: 'billing',
    label: 'Billing',
    icon: <ProfileOutlined />,
    permissions: ['generate_billing_run', 'create_invoice', 'record_payment', 'view_customer_statement'],
    children: [
      { key: '/billing-runs', label: 'Billing runs', permissions: ['generate_billing_run'] },
      { key: '/invoices', label: 'Invoices', permissions: ['create_invoice'] },
      { key: '/payments', label: 'Payments', permissions: ['record_payment'] },
      { key: '/statements', label: 'Statements', permissions: ['view_customer_statement'] },
    ],
  },
  { key: '/documents', label: 'Documents', icon: <FileTextOutlined />, permissions: ['view_documents'] },
  { key: '/notifications', label: 'Notifications', icon: <BellOutlined /> },
  {
    key: 'settings',
    label: 'Settings',
    icon: <SettingOutlined />,
    permissions: ['manage_company_settings', 'manage_users_and_roles', 'view_audit_log', 'view_plan_usage'],
    children: [
      { key: '/settings/company', label: 'Company', permissions: ['manage_company_settings'] },
      { key: '/settings/users', label: 'Users', permissions: ['manage_users_and_roles'] },
      { key: '/settings/plan', label: 'Plan & usage', permissions: ['view_plan_usage'] },
      { key: '/settings/audit', label: 'Audit log', permissions: ['view_audit_log'] },
    ],
  },
];


export function AppShell() {
  const { session, signOut, can } = useSession();
  const location = useLocation();
  const navigate = useNavigate();

  const items = useMemo(() => {
    const allowed = (permissions?: string[]) => !permissions || permissions.some(can);
    return NAV.filter((item) => allowed(item.permissions)).map((item) => ({
      key: item.key,
      icon: item.icon,
      label: item.children ? item.label : <Link to={item.key}>{item.label}</Link>,
      children: item.children
        ?.filter((child) => allowed(child.permissions))
        .map((child) => ({ key: child.key, label: <Link to={child.key}>{child.label}</Link> })),
    }));
  }, [can]);

  const selected = useMemo(() => {
    // Longest matching prefix, so /grns/<id> keeps the GRNs item lit.
    const keys = NAV.flatMap((item) => (item.children ? item.children.map((c) => c.key) : [item.key]));
    const match = keys
      .filter((key) => location.pathname === key || location.pathname.startsWith(`${key}/`))
      .sort((a, b) => b.length - a.length)[0];
    return match ? [match] : ['/'];
  }, [location.pathname]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={232}
        theme="light"
        breakpoint="lg"
        collapsedWidth={0}
        style={{ borderRight: '1px solid #f0f0f0', overflow: 'auto', height: '100vh', position: 'sticky', top: 0 }}
      >
        <div style={{ padding: '18px 20px 12px' }}>
          <Typography.Text strong style={{ fontSize: 15, display: 'block', lineHeight: 1.3 }}>
            {session?.tenant.legalName}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {session?.role.name}
          </Typography.Text>
        </div>
        <Menu mode="inline" selectedKeys={selected} defaultOpenKeys={['masters', 'inbound', 'stock', 'outbound', 'billing']} items={items} style={{ borderInlineEnd: 'none' }} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, paddingInline: 20 }}>
          {session?.tenant.isDemo && <Tag color="red">DEMO WORKSPACE</Tag>}
          <Dropdown
            menu={{
              items: [
                { key: 'email', label: session?.user.email, disabled: true },
                { type: 'divider' },
                {
                  key: 'signout',
                  icon: <LogoutOutlined />,
                  label: 'Sign out',
                  onClick: () => {
                    signOut();
                    navigate('/login');
                  },
                },
              ],
            }}
          >
            <span style={{ cursor: 'pointer' }}>
              <Avatar size="small" icon={<UserOutlined />} /> <span style={{ marginLeft: 8 }}>{session?.user.fullName}</span>
            </span>
          </Dropdown>
        </Header>
        <Content style={{ padding: 24, background: '#fafafa' }}>
          {session?.tenant.isDemo && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="This is a demo workspace"
              description="Every document generated here is watermarked DEMO / SAMPLE and is not a valid commercial document."
            />
          )}
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
