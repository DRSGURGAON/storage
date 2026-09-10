import { useState } from 'react';
import { Alert, Card, Col, Descriptions, Form, InputNumber, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { CreateButton, ListPage } from '../components/ListPage';
import { FormDrawer } from '../components/FormDrawer';
import { RecordPicker } from '../components/RecordPicker';
import { RecordActions } from '../components/RecordActions';
import { DocumentActions } from '../components/DocumentActions';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { date, humanise, money, quantity, statusColor } from '../lib/format';

/* ---------------------------------------------------------------- commercial */

interface Quotation {
  id: string;
  number: string;
  quotationDate: string;
  validUntil: string | null;
  status: string;
  subtotal: number;
  grandTotal: number;
}

export function Quotations() {
  const navigate = useNavigate();
  return (
    <ListPage<Quotation>
      title="Quotations"
      path="/quotations"
      searchPlaceholder="Number"
      onRowClick={(row) => navigate(`/quotations/${row.id}`)}
      emptyDescription="No quotations yet. A quotation is what an agreement is drawn from once the customer accepts it."
      columns={[
        { title: 'Number', dataIndex: 'number', width: 180 },
        { title: 'Date', dataIndex: 'quotationDate', width: 130, render: (v) => date(v) },
        { title: 'Valid until', dataIndex: 'validUntil', width: 130, render: (v) => date(v) },
        { title: 'Total', dataIndex: 'grandTotal', align: 'right', width: 150, render: (v) => money(v) },
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

export function QuotationDetail() {
  const { id = '' } = useParams();
  const { data, isLoading } = useQuery({ queryKey: ['/quotations', id], queryFn: () => api<Quotation & { lines?: { id: string; description: string; quantity: number; rate: number; amount: number }[] }>(`/quotations/${id}`) });

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Card
        loading={isLoading}
        title={
          <Space>
            <Typography.Title level={4} style={{ margin: 0 }}>{data?.number}</Typography.Title>
            <Tag color={statusColor(data?.status)}>{humanise(data?.status)}</Tag>
          </Space>
        }
        extra={
          <Space>
            <DocumentActions basePath={`/quotations/${id}`} permission="create_quotation" />
            <RecordActions
              basePath="/quotations"
              id={id}
              status={data?.status}
              invalidate={['/quotations']}
              actions={[
                { label: 'Send', action: 'send', permission: 'edit_quotation', from: ['draft'], primary: true },
                { label: 'Accept', action: 'accept', permission: 'edit_quotation', from: ['sent'], primary: true },
                { label: 'Reject', action: 'reject', permission: 'edit_quotation', from: ['sent'], danger: true, needsReason: true },
                { label: 'Cancel', action: 'cancel', permission: 'edit_quotation', from: ['draft'], danger: true, needsReason: true },
              ]}
            />
          </Space>
        }
      >
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="Date">{date(data?.quotationDate)}</Descriptions.Item>
          <Descriptions.Item label="Valid until">{date(data?.validUntil)}</Descriptions.Item>
          <Descriptions.Item label="Total">{money(data?.grandTotal)}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title="Lines">
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={data?.lines ?? []}
          columns={[
            { title: 'Description', dataIndex: 'description' },
            { title: 'Quantity', dataIndex: 'quantity', align: 'right', width: 120, render: (v) => quantity(v) },
            { title: 'Rate', dataIndex: 'rate', align: 'right', width: 120, render: (v) => money(v) },
            { title: 'Amount', dataIndex: 'amount', align: 'right', width: 140, render: (v) => <strong>{money(v)}</strong> },
          ]}
        />
      </Card>
    </Space>
  );
}

interface Agreement {
  id: string;
  number: string;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export function Agreements() {
  const navigate = useNavigate();
  return (
    <ListPage<Agreement>
      title="Agreements"
      path="/agreements"
      searchPlaceholder="Number"
      onRowClick={(row) => navigate(`/agreements/${row.id}`)}
      emptyDescription="No agreements yet. An agreement's clauses are resolved from the company and customer at the moment it is drawn."
      columns={[
        { title: 'Number', dataIndex: 'number', width: 180 },
        { title: 'From', dataIndex: 'effectiveFrom', width: 130, render: (v) => date(v) },
        { title: 'To', dataIndex: 'effectiveTo', width: 130, render: (v) => date(v) },
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

export function AgreementDetail() {
  const { id = '' } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ['/agreements', id],
    queryFn: () => api<Agreement & { clauses?: { id: string; title: string; renderedClause: string }[] }>(`/agreements/${id}`),
  });

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Card
        loading={isLoading}
        title={
          <Space>
            <Typography.Title level={4} style={{ margin: 0 }}>{data?.number}</Typography.Title>
            <Tag color={statusColor(data?.status)}>{humanise(data?.status)}</Tag>
          </Space>
        }
        extra={
          <Space>
            <DocumentActions basePath={`/agreements/${id}`} permission="create_agreement" />
            <RecordActions
              basePath="/agreements"
              id={id}
              status={data?.status}
              invalidate={['/agreements']}
              actions={[
                { label: 'Submit for approval', action: 'submit', permission: 'edit_agreement', from: ['draft'], primary: true },
                { label: 'Approve', action: 'approve', permission: 'approve_agreement', from: ['pending_approval'], primary: true },
                { label: 'Activate', action: 'activate', permission: 'approve_agreement', from: ['approved'], primary: true },
                { label: 'Terminate', action: 'terminate', permission: 'approve_agreement', from: ['active'], danger: true, needsReason: true },
              ]}
            />
          </Space>
        }
      >
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="Effective from">{date(data?.effectiveFrom)}</Descriptions.Item>
          <Descriptions.Item label="Until">{date(data?.effectiveTo)}</Descriptions.Item>
          <Descriptions.Item label="Status">{humanise(data?.status)}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title="Clauses">
        {(data?.clauses ?? []).map((clause) => (
          <div key={clause.id} style={{ marginBottom: 16 }}>
            <Typography.Title level={5} style={{ marginBottom: 4 }}>
              {clause.title}
            </Typography.Title>
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
              {clause.renderedClause}
            </Typography.Paragraph>
          </div>
        ))}
      </Card>
    </Space>
  );
}

/* -------------------------------------------------------------------- stock */

interface StockTransfer {
  id: string;
  number: string;
  status: string;
  transferDate: string;
  kind: string;
  fromWarehouseId: string;
  toWarehouseId: string;
}

export function StockTransfers() {
  const [creating, setCreating] = useState(false);
  const { can } = useSession();
  const navigate = useNavigate();

  return (
    <>
      <ListPage<StockTransfer>
        title="Stock transfers"
        path="/stock-transfers"
        searchPlaceholder="Number"
        onRowClick={(row) => navigate(`/stock-transfers/${row.id}`)}
        emptyDescription="No transfers yet. A bin-to-bin move posts in one step; a warehouse-to-warehouse move leaves the goods in neither warehouse while they are on the road."
        actions={can('create_stock_transfer') && <CreateButton label="New transfer" onClick={() => setCreating(true)} />}
        columns={[
          { title: 'Number', dataIndex: 'number', width: 180 },
          { title: 'Date', dataIndex: 'transferDate', width: 130, render: (v) => date(v) },
          { title: 'Kind', dataIndex: 'kind', width: 180, render: (v) => <Tag>{humanise(v)}</Tag> },
          {
            title: 'Status',
            dataIndex: 'status',
            width: 140,
            render: (status: string) => <Tag color={statusColor(status)}>{humanise(status)}</Tag>,
          },
        ]}
      />
      <FormDrawer
        open={creating}
        title="New stock transfer"
        path="/stock-transfers"
        width={640}
        invalidate={['/stock-transfers']}
        onClose={() => setCreating(false)}
        onSaved={(saved: StockTransfer) => navigate(`/stock-transfers/${saved.id}`)}
      >
        {(form) => (
          <>
            <Form.Item name="kind" label="Kind" rules={[{ required: true }]} initialValue="intra_warehouse">
              <Select
                options={[
                  { value: 'intra_warehouse', label: 'Between bins in one warehouse' },
                  { value: 'inter_warehouse', label: 'Between warehouses' },
                ]}
              />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="fromWarehouseId" label="From warehouse" rules={[{ required: true }]}>
                  <RecordPicker<{ id: string; code: string; name: string }>
                    path="/warehouses"
                    label={(row) => `${row.code} — ${row.name}`}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="toWarehouseId" label="To warehouse" rules={[{ required: true }]}>
                  <RecordPicker<{ id: string; code: string; name: string }>
                    path="/warehouses"
                    label={(row) => `${row.code} — ${row.name}`}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="customerId" label="Customer" rules={[{ required: true }]}>
              <RecordPicker<{ id: string; code: string; name: string }>
                path="/customers"
                label={(row) => `${row.code} — ${row.name}`}
              />
            </Form.Item>
            <Typography.Title level={5}>Lines</Typography.Title>
            <Form.List name="lines" initialValue={[{}]}>
              {(fields) => (
                <>
                  {fields.map((field) => (
                    <div key={field.key} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                      <Form.Item {...field} name={[field.name, 'productId']} label="Product" rules={[{ required: true }]}>
                        <RecordPicker<{ id: string; sku: string; name: string }>
                          path="/products"
                          label={(row) => `${row.sku} — ${row.name}`}
                        />
                      </Form.Item>
                      <Row gutter={12}>
                        <Col span={8}>
                          <Form.Item {...field} name={[field.name, 'quantity']} label="Quantity" rules={[{ required: true }]}>
                            <InputNumber min={0} style={{ width: '100%' }} />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item {...field} name={[field.name, 'fromLocationId']} label="From bin" rules={[{ required: true }]}>
                            <RecordPicker<{ id: string; fullCode: string }>
                              path={`/warehouses/${form.getFieldValue('fromWarehouseId')}/locations`}
                              unpaged
                              filters={{ level: 'bin' }}
                              label={(row) => row.fullCode}
                            />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item
                            {...field}
                            name={[field.name, 'toLocationId']}
                            label="To bin"
                            tooltip="Leave blank to land unallocated, like a receipt waiting for a put-away"
                          >
                            <RecordPicker<{ id: string; fullCode: string }>
                              path={`/warehouses/${form.getFieldValue('toWarehouseId')}/locations`}
                              unpaged
                              filters={{ level: 'bin' }}
                              label={(row) => row.fullCode}
                            />
                          </Form.Item>
                        </Col>
                      </Row>
                    </div>
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

export function StockTransferDetail() {
  const { id = '' } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ['/stock-transfers', id],
    queryFn: () => api<StockTransfer & { lines?: { id: string; productName?: string; sku?: string; quantity: number }[] }>(`/stock-transfers/${id}`),
  });

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Card
        loading={isLoading}
        title={
          <Space>
            <Typography.Title level={4} style={{ margin: 0 }}>{data?.number}</Typography.Title>
            <Tag color={statusColor(data?.status)}>{humanise(data?.status)}</Tag>
          </Space>
        }
        extra={
          <Space>
            <DocumentActions basePath={`/stock-transfers/${id}`} permission="create_stock_transfer" />
            <RecordActions
              basePath="/stock-transfers"
              id={id}
              status={data?.status}
              invalidate={['/stock-transfers', '/stock']}
              actions={[
                { label: 'Dispatch', action: 'dispatch', permission: 'create_stock_transfer', from: ['draft'], primary: true },
                { label: 'Receive', action: 'receive', permission: 'create_stock_transfer', from: ['in_transit'], primary: true },
                { label: 'Cancel', action: 'cancel', permission: 'create_stock_transfer', from: ['draft'], danger: true, needsReason: true },
              ]}
            />
          </Space>
        }
      >
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="Date">{date(data?.transferDate)}</Descriptions.Item>
          <Descriptions.Item label="Kind">{humanise(data?.kind)}</Descriptions.Item>
          <Descriptions.Item label="Status">{humanise(data?.status)}</Descriptions.Item>
        </Descriptions>
        {data?.status === 'in_transit' && (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 16 }}
            message="These goods are on the road"
            description="They have left the source warehouse and not yet arrived. They are in neither warehouse's balance until this transfer is received — which is the honest answer to where they are."
          />
        )}
      </Card>
      <Card title="Lines">
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={data?.lines ?? []}
          columns={[
            {
              title: 'Product',
              render: (_, row: { productName?: string; sku?: string }) => (
                <Space direction="vertical" size={0}>
                  <strong>{row.productName ?? '—'}</strong>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {row.sku}
                  </Typography.Text>
                </Space>
              ),
            },
            { title: 'Quantity', dataIndex: 'quantity', align: 'right', width: 140, render: (v) => quantity(v) },
          ]}
        />
      </Card>
    </Space>
  );
}

interface StockVerification {
  id: string;
  number: string;
  status: string;
  verificationDate: string;
  warehouseId: string;
}

export function StockVerifications() {
  const [creating, setCreating] = useState(false);
  const { can } = useSession();
  const navigate = useNavigate();

  return (
    <>
      <ListPage<StockVerification>
        title="Stock verifications"
        path="/stock-verifications"
        searchPlaceholder="Number"
        onRowClick={(row) => navigate(`/stock-verifications/${row.id}`)}
        emptyDescription="No counts yet. Counting moves nothing on its own — a count that disagrees raises an adjustment, and only the approved adjustment posts."
        actions={
          can('create_stock_verification') && <CreateButton label="New count" onClick={() => setCreating(true)} />
        }
        columns={[
          { title: 'Number', dataIndex: 'number', width: 180 },
          { title: 'Date', dataIndex: 'verificationDate', width: 130, render: (v) => date(v) },
          {
            title: 'Status',
            dataIndex: 'status',
            width: 150,
            render: (status: string) => <Tag color={statusColor(status)}>{humanise(status)}</Tag>,
          },
        ]}
      />
      <FormDrawer
        open={creating}
        title="New stock count"
        path="/stock-verifications"
        invalidate={['/stock-verifications']}
        onClose={() => setCreating(false)}
        onSaved={(saved: StockVerification) => navigate(`/stock-verifications/${saved.id}`)}
      >
        {() => (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="The count sheet builds itself"
              description="Every lot currently in the chosen warehouse comes across as a line to be counted. Stock the system has no lot for at all can be added during the count — that is a find, not a mismatch."
            />
            <Form.Item name="warehouseId" label="Warehouse" rules={[{ required: true }]}>
              <RecordPicker<{ id: string; code: string; name: string }>
                path="/warehouses"
                label={(row) => `${row.code} — ${row.name}`}
              />
            </Form.Item>
            <Form.Item name="customerId" label="Customer" tooltip="Leave blank to count everything in the warehouse">
              <RecordPicker<{ id: string; code: string; name: string }>
                path="/customers"
                label={(row) => `${row.code} — ${row.name}`}
              />
            </Form.Item>
          </>
        )}
      </FormDrawer>
    </>
  );
}

export function StockVerificationDetail() {
  const { id = '' } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ['/stock-verifications', id],
    queryFn: () =>
      api<
        StockVerification & {
          lines?: { id: string; sku?: string; productName?: string; systemQty: number; countedQty: number | null; varianceQty: number | null }[];
        }
      >(`/stock-verifications/${id}`),
  });

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Card
        loading={isLoading}
        title={
          <Space>
            <Typography.Title level={4} style={{ margin: 0 }}>{data?.number}</Typography.Title>
            <Tag color={statusColor(data?.status)}>{humanise(data?.status)}</Tag>
          </Space>
        }
        extra={
          <Space>
            <DocumentActions basePath={`/stock-verifications/${id}`} permission="create_stock_verification" />
            <RecordActions
              basePath="/stock-verifications"
              id={id}
              status={data?.status}
              invalidate={['/stock-verifications']}
              actions={[
                { label: 'Start counting', action: 'start', permission: 'create_stock_verification', from: ['draft'], primary: true },
                { label: 'Complete', action: 'complete', permission: 'create_stock_verification', from: ['in_progress'], primary: true },
                { label: 'Cancel', action: 'cancel', permission: 'create_stock_verification', from: ['draft', 'in_progress'], danger: true, needsReason: true },
              ]}
            />
          </Space>
        }
      >
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="Date">{date(data?.verificationDate)}</Descriptions.Item>
          <Descriptions.Item label="Status">{humanise(data?.status)}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title="Count sheet">
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={data?.lines ?? []}
          columns={[
            {
              title: 'Product',
              render: (_, row: { productName?: string; sku?: string }) => (
                <Space direction="vertical" size={0}>
                  <strong>{row.productName ?? '—'}</strong>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {row.sku}
                  </Typography.Text>
                </Space>
              ),
            },
            { title: 'System says', dataIndex: 'systemQty', align: 'right', width: 140, render: (v) => quantity(v) },
            { title: 'Counted', dataIndex: 'countedQty', align: 'right', width: 140, render: (v) => quantity(v) },
            {
              title: 'Variance',
              dataIndex: 'varianceQty',
              align: 'right',
              width: 140,
              render: (v: number | null) =>
                v === null || Number(v) === 0 ? (
                  '—'
                ) : (
                  <Typography.Text type={Number(v) < 0 ? 'danger' : 'warning'}>{quantity(v)}</Typography.Text>
                ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}

/* ------------------------------------------------------------------ returns */

interface ReturnRequest {
  id: string;
  number: string;
  status: string;
  requestDate: string;
  reason: string | null;
}

export function ReturnRequests() {
  const navigate = useNavigate();
  return (
    <ListPage<ReturnRequest>
      title="Return requests"
      path="/return-requests"
      searchPlaceholder="Number"
      onRowClick={(row) => navigate(`/return-requests/${row.id}`)}
      emptyDescription="No returns asked for. A request is held to what its dispatch actually carried, less anything an earlier request already claims."
      columns={[
        { title: 'Number', dataIndex: 'number', width: 180 },
        { title: 'Raised', dataIndex: 'requestDate', width: 130, render: (v) => date(v) },
        { title: 'Reason', dataIndex: 'reason', render: (v) => v ?? '—' },
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

export function ReturnRequestDetail() {
  const { id = '' } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ['/return-requests', id],
    queryFn: () =>
      api<ReturnRequest & { lines?: { id: string; sku?: string; productName?: string; quantity: number }[] }>(
        `/return-requests/${id}`,
      ),
  });

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Card
        loading={isLoading}
        title={
          <Space>
            <Typography.Title level={4} style={{ margin: 0 }}>{data?.number}</Typography.Title>
            <Tag color={statusColor(data?.status)}>{humanise(data?.status)}</Tag>
          </Space>
        }
        extra={
          <RecordActions
            basePath="/return-requests"
            id={id}
            status={data?.status}
            invalidate={['/return-requests']}
            actions={[
              { label: 'Approve', action: 'approve', permission: 'approve_grn', from: ['requested'], primary: true },
              { label: 'Reject', action: 'reject', permission: 'approve_grn', from: ['requested'], danger: true, needsReason: true },
              { label: 'Cancel', action: 'cancel', permission: 'create_return_request', from: ['requested'], danger: true, needsReason: true },
            ]}
          />
        }
      >
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="Raised">{date(data?.requestDate)}</Descriptions.Item>
          <Descriptions.Item label="Reason" span={2}>
            {data?.reason ?? '—'}
          </Descriptions.Item>
        </Descriptions>
        {data?.status === 'approved' && (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 16 }}
            message="Next: the goods have to arrive"
            description="An approved request is not stock. A Return Inward records the arrival and inspection, and the GRN raised from it is what posts the RETURN movement — the same path an ordinary receipt takes."
          />
        )}
      </Card>
      <Card title="What is coming back">
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={data?.lines ?? []}
          columns={[
            {
              title: 'Product',
              render: (_, row: { productName?: string; sku?: string }) => (
                <Space direction="vertical" size={0}>
                  <strong>{row.productName ?? '—'}</strong>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {row.sku}
                  </Typography.Text>
                </Space>
              ),
            },
            { title: 'Quantity', dataIndex: 'quantity', align: 'right', width: 140, render: (v) => quantity(v) },
          ]}
        />
      </Card>
    </Space>
  );
}
