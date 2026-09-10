import { useState } from 'react';
import {
  Alert,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Layout,
  Menu,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ListPage } from '../../components/ListPage';
import { FormDrawer } from '../../components/FormDrawer';
import { RecordPicker } from '../../components/RecordPicker';
import { OpenDocumentButton } from '../../components/DocumentActions';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { date, dateTime, humanise, money, quantity, statusColor } from '../../lib/format';

const { Header, Content } = Layout;

interface PortalProfile {
  customer: { id: string; code: string; name: string; legalName: string | null; gstin: string | null };
  warehouseOperator: string;
  summary: {
    approvedGrns: number;
    dispatches: number;
    stockOnHand: number;
    outstanding: number;
    openReleaseOrders: number;
  };
}

/**
 * Blueprint §53. A customer signing in sees a different application, not
 * the staff one with menus removed: no warehouse operations, no other
 * customers, and no way to reach either. The API is the control — the
 * `customer` role is seeded with no staff permissions at all, and
 * `schema/98`'s restrictive policy narrows every read to this customer
 * underneath — but the shell matters too: showing a warehouse manager's
 * navigation to a customer would be confusing even where it is harmless.
 */
export function PortalShell() {
  const { session, signOut } = useSession();
  const location = useLocation();
  const navigate = useNavigate();

  const items = [
    { key: '/portal', label: <Link to="/portal">Overview</Link> },
    { key: '/portal/stock', label: <Link to="/portal/stock">My stock</Link> },
    { key: '/portal/goods-receipts', label: <Link to="/portal/goods-receipts">Receipts</Link> },
    { key: '/portal/dispatches', label: <Link to="/portal/dispatches">Dispatches</Link> },
    { key: '/portal/invoices', label: <Link to="/portal/invoices">Invoices</Link> },
    { key: '/portal/statement', label: <Link to="/portal/statement">Statement</Link> },
    { key: '/portal/documents', label: <Link to="/portal/documents">Documents</Link> },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#fff', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 12, paddingInline: 16 }}>
        {/*
          Both of these need a shrink limit, and for the same reason: a flex
          item defaults to `min-width: auto`, so it refuses to become
          narrower than its own content. Without them the seven-item menu
          stayed 591px wide on a 390px phone and pushed the whole page
          sideways -- §64's rule broken on every portal screen, which is
          the half of the product a *customer* opens, usually on a phone.
          With `minWidth: 0` antd's own overflow takes over and folds the
          tail of the menu into a "..." item.
        */}
        <Typography.Text strong ellipsis style={{ minWidth: 0, maxWidth: '40%' }}>
          {session?.tenant.legalName}
        </Typography.Text>
        <Menu
          mode="horizontal"
          selectedKeys={[items.map((i) => i.key).filter((key) => location.pathname === key).at(0) ?? '/portal']}
          items={items}
          style={{ flex: 1, minWidth: 0, borderBottom: 'none' }}
        />
        <a
          onClick={() => {
            signOut();
            navigate('/login');
          }}
        >
          Sign out
        </a>
      </Header>
      <Content style={{ padding: 24, background: '#fafafa' }}>
        <Outlet />
      </Content>
    </Layout>
  );
}

export function PortalOverview() {
  const { data, isLoading } = useQuery({ queryKey: ['/portal/me'], queryFn: () => api<PortalProfile>('/portal/me') });

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Card loading={isLoading} title={<Typography.Title level={4} style={{ margin: 0 }}>{data?.customer.legalName ?? data?.customer.name}</Typography.Title>}>
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
          <Descriptions.Item label="Account">{data?.customer.code}</Descriptions.Item>
          <Descriptions.Item label="GSTIN">{data?.customer.gstin ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Stored with">{data?.warehouseOperator}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}>
          <Card size="small">
            <Statistic title="In store" value={quantity(data?.summary.stockOnHand)} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card size="small">
            <Statistic title="Receipts" value={data?.summary.approvedGrns ?? 0} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card size="small">
            <Statistic title="Dispatches" value={data?.summary.dispatches ?? 0} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card size="small">
            <Statistic
              title="Outstanding"
              value={money(data?.summary.outstanding)}
              valueStyle={Number(data?.summary.outstanding ?? 0) > 0 ? { color: '#cf1322' } : undefined}
            />
          </Card>
        </Col>
      </Row>

      {(data?.summary.openReleaseOrders ?? 0) > 0 && (
        <Alert
          type="info"
          showIcon
          message={`${data?.summary.openReleaseOrders} release order(s) in progress`}
          description="Goods you have asked for that have not left the warehouse yet."
        />
      )}
    </Space>
  );
}

interface PortalLot {
  id: string;
  sku: string;
  productName: string;
  batchNo: string | null;
  warehouseCode: string;
  physicalQty: string;
  reservedQty: string;
  availableQty: string;
}

export function PortalStock() {
  return (
    <ListPage<PortalLot>
      title="My stock"
      path="/portal/stock"
      searchPlaceholder="SKU or product"
      emptyDescription="Nothing of yours is in store right now."
      rowKey={(row) => `${row.sku}-${row.batchNo ?? ''}-${row.warehouseCode}`}
      columns={[
        {
          title: 'Product',
          render: (_, row) => (
            <Space direction="vertical" size={0}>
              <strong>{row.productName}</strong>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {row.sku}
                {row.batchNo ? ` · batch ${row.batchNo}` : ''}
              </Typography.Text>
            </Space>
          ),
        },
        { title: 'Warehouse', dataIndex: 'warehouseCode', width: 130 },
        { title: 'Physical', dataIndex: 'physicalQty', align: 'right', width: 130, render: (v) => <strong>{quantity(v)}</strong> },
        { title: 'Reserved', dataIndex: 'reservedQty', align: 'right', width: 130, render: (v) => quantity(v) },
        { title: 'Available', dataIndex: 'availableQty', align: 'right', width: 130, render: (v) => quantity(v) },
      ]}
    />
  );
}

export function PortalReceipts() {
  return (
    <ListPage
      title="Goods received"
      path="/portal/goods-receipts"
      searchPlaceholder="Number"
      emptyDescription="Nothing received yet."
      rowKey={(row: { id: string }) => row.id}
      columns={[
        { title: 'GRN', dataIndex: 'number', width: 190 },
        { title: 'Date', dataIndex: 'grnDate', width: 140, render: (v) => date(v) },
        { title: 'Warehouse', dataIndex: 'warehouseCode', width: 130 },
        { title: 'Accepted', dataIndex: 'acceptedQty', align: 'right', width: 140, render: (v) => quantity(v) },
        {
          title: 'Warehouse receipt',
          dataIndex: 'warehouseReceiptNumber',
          render: (v: string | null) => v ?? <Typography.Text type="secondary">not issued</Typography.Text>,
        },
        {
          title: 'Status',
          dataIndex: 'status',
          width: 130,
          render: (status: string) => <Tag color={statusColor(status)}>{humanise(status)}</Tag>,
        },
      ]}
    />
  );
}

export function PortalDispatches() {
  const [requesting, setRequesting] = useState<string | null>(null);

  return (
    <>
      <ListPage
        title="Dispatches"
        path="/portal/dispatches"
        searchPlaceholder="Number or LR"
        emptyDescription="Nothing has been shipped to you yet."
        rowKey={(row: { id: string }) => row.id}
        columns={[
          { title: 'Number', dataIndex: 'number', width: 190 },
          { title: 'Date', dataIndex: 'dispatchDate', width: 140, render: (v) => date(v) },
          { title: 'LR', dataIndex: 'lrNumber', render: (v) => v ?? '—' },
          {
            title: 'Status',
            dataIndex: 'status',
            width: 140,
            render: (status: string) => <Tag color={statusColor(status)}>{humanise(status)}</Tag>,
          },
          {
            title: '',
            width: 160,
            render: (_, row: { id: string; status: string }) =>
              ['gate_out', 'completed'].includes(row.status) ? (
                <a onClick={() => setRequesting(row.id)}>Request a return</a>
              ) : null,
          },
        ]}
      />
      <FormDrawer
        open={requesting !== null}
        title="Request a return"
        path="/portal/return-requests"
        invalidate={['/portal/dispatches']}
        initialValues={{ originalDispatchId: requesting }}
        onClose={() => setRequesting(null)}
      >
        {() => (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="Only what this dispatch carried"
              description="A request is held to the products and quantities that actually went out on it, less anything an earlier request already claims."
            />
            <Form.Item name="originalDispatchId" hidden>
              <Input />
            </Form.Item>
            <Form.Item name="reason" label="Why?" rules={[{ required: true }]}>
              <Input.TextArea rows={2} placeholder="Ten bags damaged in transit" />
            </Form.Item>
            <Form.List name="lines" initialValue={[{}]}>
              {(fields) => (
                <>
                  {fields.map((field) => (
                    <Row key={field.key} gutter={12}>
                      <Col span={16}>
                        <Form.Item {...field} name={[field.name, 'productId']} label="Product" rules={[{ required: true }]}>
                          <RecordPicker<{ id: string; sku: string; name: string }>
                            path="/portal/stock"
                            unpaged
                            label={(row) => `${row.sku} — ${row.name}`}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item {...field} name={[field.name, 'quantity']} label="Quantity" rules={[{ required: true }]}>
                          <InputNumber min={0} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                    </Row>
                  ))}
                </>
              )}
            </Form.List>
          </>
        )}
      </FormDrawer>
    </>
  );
}

export function PortalInvoices() {
  return (
    <ListPage
      title="Invoices"
      path="/portal/invoices"
      searchPlaceholder="Number"
      emptyDescription="Nothing invoiced yet."
      rowKey={(row: { id: string }) => row.id}
      columns={[
        { title: 'Number', dataIndex: 'number', width: 190 },
        { title: 'Date', dataIndex: 'invoiceDate', width: 140, render: (v) => date(v) },
        { title: 'Due', dataIndex: 'dueDate', width: 140, render: (v) => date(v) },
        { title: 'Total', dataIndex: 'grandTotal', align: 'right', width: 150, render: (v) => money(v) },
        { title: 'Paid', dataIndex: 'amountPaid', align: 'right', width: 140, render: (v) => money(v) },
        {
          title: 'Outstanding',
          dataIndex: 'balanceDue',
          align: 'right',
          width: 150,
          render: (v: number) => (Number(v) > 0 ? <strong>{money(v)}</strong> : money(v)),
        },
        {
          title: 'Status',
          dataIndex: 'status',
          width: 150,
          render: (status: string) => <Tag color={statusColor(status)}>{humanise(status)}</Tag>,
        },
      ]}
    />
  );
}

interface StatementEntry {
  type: string;
  date: string;
  number: string;
  debit: number;
  credit: number;
  balance: number;
}

export function PortalStatement() {
  const { data, isLoading } = useQuery({
    queryKey: ['/portal/statement'],
    queryFn: () => api<{ openingBalance: number; closingBalance: number; entries: StatementEntry[] }>('/portal/statement'),
  });

  return (
    <Card title={<Typography.Title level={4} style={{ margin: 0 }}>Account statement</Typography.Title>}>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Statistic title="Opening" value={money(data?.openingBalance)} />
        </Col>
        <Col span={8}>
          <Statistic title="Closing" value={money(data?.closingBalance)} />
        </Col>
      </Row>
      <Table<StatementEntry>
        scroll={{ x: 'max-content' }}
        size="small"
        rowKey={(row) => `${row.type}-${row.number}`}
        loading={isLoading}
        pagination={false}
        dataSource={data?.entries ?? []}
        locale={{ emptyText: 'Nothing billed or paid yet.' }}
        columns={[
          { title: 'Date', dataIndex: 'date', width: 140, render: (v) => date(v) },
          { title: 'Type', dataIndex: 'type', width: 140, render: (v) => <Tag>{humanise(v)}</Tag> },
          { title: 'Number', dataIndex: 'number' },
          { title: 'Debit', dataIndex: 'debit', align: 'right', width: 140, render: (v: number) => (Number(v) ? money(v) : '—') },
          { title: 'Credit', dataIndex: 'credit', align: 'right', width: 140, render: (v: number) => (Number(v) ? money(v) : '—') },
          { title: 'Balance', dataIndex: 'balance', align: 'right', width: 150, render: (v) => <strong>{money(v)}</strong> },
        ]}
      />
    </Card>
  );
}

export function PortalDocuments() {
  return (
    <ListPage
      title="My documents"
      path="/portal/documents"
      searchPlaceholder="Number"
      emptyDescription="No documents have been issued to you yet."
      rowKey={(row: { id: string }) => row.id}
      columns={[
        { title: 'Number', dataIndex: 'documentNumber', width: 210 },
        { title: 'Type', dataIndex: 'documentType', width: 190, render: (v) => <Tag>{humanise(v)}</Tag> },
        { title: 'Issued', dataIndex: 'generatedAt', width: 200, render: (v) => dateTime(v) },
        {
          title: '',
          width: 120,
          render: (_, row: { id: string }) => <PortalDownload documentId={row.id} />,
        },
      ]}
    />
  );
}

/**
 * The portal's own signed-link route, not the staff one: the claims it
 * mints carry this customer, so a forwarded link stays scoped to them.
 */
function PortalDownload({ documentId }: { documentId: string }) {
  return <OpenDocumentButton documentId={documentId} label="Open" portal />;
}
