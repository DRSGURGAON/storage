import { Alert, Card, Col, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { ListPage } from '../../components/ListPage';
import { date, dateTime, humanise, quantity } from '../../lib/format';

interface StockLot {
  id: string;
  customerName: string | null;
  warehouseCode: string;
  locationFullCode: string | null;
  sku: string;
  productName: string;
  batchNo: string | null;
  expiryDate: string | null;
  firstReceivedAt: string | null;
  serialNo: string | null;
  physicalQty: string;
  reservedQty: string;
  availableQty: string;
}

interface LedgerRow {
  id: string;
  txnAt: string;
  txnType: string;
  warehouseCode: string;
  locationFullCode: string | null;
  sku: string;
  productName: string;
  batchNo: string | null;
  qtyIn: string;
  qtyOut: string;
  reservedDelta: string;
  balancePhysicalQty: string;
  sourceType: string;
  reversalOfId: string | null;
}

/** How each movement type reads at a glance. `stock-engine.md` §2's vocabulary. */
const TXN_COLOR: Record<string, string> = {
  INWARD: 'green',
  RETURN: 'green',
  TRANSFER_IN: 'blue',
  TRANSFER_OUT: 'blue',
  OUTWARD: 'red',
  ADJUSTMENT: 'orange',
  RESERVE: 'purple',
  UNRESERVE: 'default',
};

/**
 * What is on hand, per lot.
 *
 * A "lot" is one balance for one (customer, warehouse, location, product,
 * batch, serial) — which is why the same SKU appears more than once, and
 * why that is right rather than a display bug: two batches in one bin are
 * two balances, and merging them on screen would suggest they are
 * interchangeable when the FEFO reservation that draws from them says
 * otherwise.
 */
export function Stock() {
  return (
    <ListPage<StockLot>
      title="Stock on hand"
      path="/stock"
      searchPlaceholder="SKU, product or batch"
      emptyDescription="Nothing in store. Stock appears here the moment a GRN is approved — before it is put away, with no location against it."
      columns={[
        {
          title: 'Product',
          render: (_, row) => (
            <Space direction="vertical" size={0}>
              <strong>{row.productName}</strong>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {row.sku}
                {row.batchNo ? ` · batch ${row.batchNo}` : ''}
                {row.serialNo ? ` · ${row.serialNo}` : ''}
              </Typography.Text>
            </Space>
          ),
        },
        { title: 'Customer', dataIndex: 'customerName', render: (v) => v ?? '—' },
        { title: 'Warehouse', dataIndex: 'warehouseCode', width: 110 },
        {
          title: 'Location',
          dataIndex: 'locationFullCode',
          width: 170,
          render: (code: string | null) =>
            code ? (
              <span style={{ fontFamily: 'monospace' }}>{code}</span>
            ) : (
              <Tag>unallocated</Tag>
            ),
        },
        { title: 'Expiry', dataIndex: 'expiryDate', width: 120, render: (v) => date(v) },
        {
          title: 'Physical',
          dataIndex: 'physicalQty',
          align: 'right',
          width: 110,
          render: (v) => <strong>{quantity(v)}</strong>,
        },
        { title: 'Reserved', dataIndex: 'reservedQty', align: 'right', width: 110, render: (v) => quantity(v) },
        {
          title: 'Available',
          dataIndex: 'availableQty',
          align: 'right',
          width: 110,
          render: (v) => quantity(v),
        },
      ]}
    />
  );
}

/**
 * The ledger: every movement, with the balance it left behind.
 *
 * `balancePhysicalQty` is the figure the database actually held after the
 * row was written, recorded at posting time rather than recomputed now —
 * so this reads as an audit trail rather than as a reconstruction that
 * might disagree with one.
 */
export function StockLedger() {
  return (
    <ListPage<LedgerRow>
      title="Stock ledger"
      path="/stock/ledger"
      searchPlaceholder="SKU or product"
      emptyDescription="No movements yet."
      columns={[
        { title: 'When', dataIndex: 'txnAt', width: 180, render: (v) => dateTime(v) },
        {
          title: 'Movement',
          dataIndex: 'txnType',
          width: 130,
          render: (type: string) => <Tag color={TXN_COLOR[type] ?? 'default'}>{type}</Tag>,
        },
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
        {
          title: 'Location',
          dataIndex: 'locationFullCode',
          width: 160,
          render: (code: string | null) => (code ? <span style={{ fontFamily: 'monospace' }}>{code}</span> : '—'),
        },
        {
          title: 'In',
          dataIndex: 'qtyIn',
          align: 'right',
          width: 90,
          render: (v: string) => (Number(v) > 0 ? quantity(v) : '—'),
        },
        {
          title: 'Out',
          dataIndex: 'qtyOut',
          align: 'right',
          width: 90,
          render: (v: string) => (Number(v) > 0 ? quantity(v) : '—'),
        },
        {
          title: 'Reserved ±',
          dataIndex: 'reservedDelta',
          align: 'right',
          width: 110,
          render: (v: string) => (Number(v) === 0 ? '—' : quantity(v)),
        },
        {
          title: 'Balance after',
          dataIndex: 'balancePhysicalQty',
          align: 'right',
          width: 130,
          render: (v) => <strong>{quantity(v)}</strong>,
        },
        { title: 'From', dataIndex: 'sourceType', width: 130, render: (v) => humanise(v) },
        {
          title: '',
          dataIndex: 'reversalOfId',
          width: 100,
          render: (v: string | null) => (v ? <Tag color="error">reversal</Tag> : null),
        },
      ]}
    />
  );
}

interface AgeingLine {
  customerId: string;
  customerName: string | null;
  warehouseCode: string;
  sku: string;
  productName: string;
  batchNo: string | null;
  physicalQty: number;
  receivedAt: string | null;
  ageDays: number;
  bucket: string;
}

interface AgeingResponse {
  /** The configured bucket labels, in order. */
  buckets: string[];
  /** Quantity per bucket. */
  summary: Record<string, number>;
  lines: AgeingLine[];
}

/**
 * Ageing, bucketed from the batch's `first_received_at` — the date it
 * first arrived, set once and never updated. Not "days since this lot last
 * moved": a pallet shuffled between bins has not become fresher.
 *
 * The bucket edges come from the tenant's own
 * `stock.ageing_buckets` setting when it has one, so the columns here are
 * whatever that workspace decided, not a fixed five.
 */
export function Ageing() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['/reports/ageing'],
    queryFn: () => api<AgeingResponse>('/reports/ageing'),
  });

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      {error && <Alert type="error" showIcon message={(error as Error).message} />}
      <Card
        loading={isLoading}
        title={<Typography.Title level={4} style={{ margin: 0 }}>Stock ageing</Typography.Title>}
      >
        <Row gutter={[16, 16]}>
          {(data?.buckets ?? []).map((bucket) => (
            <Col key={bucket} xs={12} md={Math.max(4, Math.floor(24 / Math.max(1, data?.buckets.length ?? 1)))}>
              <Card size="small">
                <Statistic title={`${bucket} days`} value={quantity(data?.summary[bucket] ?? 0)} />
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      <Card title="By lot">
        <Table<AgeingLine>
          size="small"
          rowKey={(row) => `${row.sku}-${row.batchNo ?? ''}-${row.warehouseCode}-${row.customerId}`}
          loading={isLoading}
          dataSource={data?.lines ?? []}
          pagination={{ pageSize: 25, showSizeChanger: true }}
          locale={{ emptyText: 'Nothing in store to age.' }}
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
            { title: 'Customer', dataIndex: 'customerName', render: (v) => v ?? '—' },
            { title: 'Warehouse', dataIndex: 'warehouseCode', width: 110 },
            { title: 'First received', dataIndex: 'receivedAt', width: 150, render: (v) => date(v) },
            { title: 'Age', dataIndex: 'ageDays', align: 'right', width: 100, render: (v) => `${v} days` },
            { title: 'Bucket', dataIndex: 'bucket', width: 120, render: (v) => <Tag>{v}</Tag> },
            {
              title: 'Quantity',
              dataIndex: 'physicalQty',
              align: 'right',
              width: 120,
              render: (v) => <strong>{quantity(v)}</strong>,
            },
          ]}
        />
      </Card>
    </Space>
  );
}
