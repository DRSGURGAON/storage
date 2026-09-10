import { useEffect, useState } from 'react';
import { Alert, Card, Col, Descriptions, Form, Input, InputNumber, Row, Space, Spin, Table, Tag, Typography } from 'antd';
import type { FormInstance } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CreateButton, ListPage } from '../../components/ListPage';
import { FormDrawer } from '../../components/FormDrawer';
import { RecordPicker } from '../../components/RecordPicker';
import { RecordActions } from '../../components/RecordActions';
import { DocumentActions } from '../../components/DocumentActions';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { date, humanise, quantity, statusColor } from '../../lib/format';

interface PutawayLine {
  id: string;
  grnItemId: string;
  productSku?: string;
  productName?: string;
  quantity: number;
  toLocationId: string;
  toLocationCode?: string;
  confirmedAt: string | null;
}

interface Putaway {
  id: string;
  number: string;
  status: string;
  grnId: string;
  grnNumber?: string;
  warehouseId: string;
  createdAt: string;
  completedAt: string | null;
  lines?: PutawayLine[];
}

interface WarehouseReceipt {
  id: string;
  number: string;
  status: string;
  grnId: string;
  receiptDate: string;
  customerId: string;
}

export function Putaways() {
  const [params] = useSearchParams();
  const grnId = params.get('grnId') ?? undefined;
  const [creating, setCreating] = useState(Boolean(grnId));
  const { can } = useSession();
  const navigate = useNavigate();

  return (
    <>
      <ListPage<Putaway>
        title="Put-aways"
        path="/putaways"
        searchPlaceholder="Number"
        onRowClick={(row) => navigate(`/putaways/${row.id}`)}
        emptyDescription="No put-aways yet. Stock stays unallocated — on the books, but in no bin — until one is completed."
        actions={can('create_putaway') && <CreateButton label="New put-away" onClick={() => setCreating(true)} />}
        columns={[
          { title: 'Number', dataIndex: 'number', width: 180 },
          { title: 'GRN', dataIndex: 'grnNumber', render: (v) => v ?? '—' },
          { title: 'Raised', dataIndex: 'createdAt', width: 140, render: (v) => date(v) },
          { title: 'Completed', dataIndex: 'completedAt', width: 140, render: (v) => date(v) },
          {
            title: 'Status',
            dataIndex: 'status',
            width: 130,
            render: (status: string) => <Tag color={statusColor(status)}>{humanise(status)}</Tag>,
          },
        ]}
      />
      <FormDrawer
        open={creating}
        title="New put-away"
        path="/putaways"
        width={720}
        invalidate={['/putaways']}
        initialValues={grnId ? { grnId } : undefined}
        onClose={() => setCreating(false)}
        onSaved={(saved: Putaway) => navigate(`/putaways/${saved.id}`)}
      >
        {(form) => (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="Every line needs a bin"
              description="Completing the put-away moves stock out of unallocated and into these locations, so the destination is chosen here rather than confirmed later. One put-away exists per GRN."
            />
            <Form.Item name="grnId" label="GRN" rules={[{ required: true }]}>
              <RecordPicker<{ id: string; number: string }>
                path="/grns"
                filters={{ status: 'approved' }}
                label={(row) => row.number}
              />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(prev, next) => prev.grnId !== next.grnId}>
              {() => <PutawayLinesField grnId={form.getFieldValue('grnId')} form={form} />}
            </Form.Item>
          </>
        )}
      </FormDrawer>
    </>
  );
}

export function PutawayDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['/putaways', id], queryFn: () => api<Putaway>(`/putaways/${id}`) });

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Card
        loading={isLoading}
        title={
          <Space>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {data?.number}
            </Typography.Title>
            <Tag color={statusColor(data?.status)}>{humanise(data?.status)}</Tag>
          </Space>
        }
        extra={
          <Space>
            <DocumentActions basePath={`/putaways/${id}`} permission="create_putaway" />
            <RecordActions
              basePath="/putaways"
              id={id}
              status={data?.status}
              invalidate={['/putaways', '/stock']}
              actions={[
                {
                  label: 'Complete',
                  action: 'complete',
                  permission: 'complete_putaway',
                  from: ['pending', 'in_progress'],
                  primary: true,
                  confirm: 'This moves every line from unallocated into its bin. Each line needs a location first.',
                },
              ]}
            />
          </Space>
        }
      >
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="GRN">
            <a onClick={() => navigate(`/grns/${data?.grnId}`)}>{data?.grnNumber ?? 'Open'}</a>
          </Descriptions.Item>
          <Descriptions.Item label="Raised">{date(data?.createdAt)}</Descriptions.Item>
          <Descriptions.Item label="Completed">{data?.completedAt ? date(data.completedAt) : '—'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="Lines">
        <Table<PutawayLine>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={data?.lines ?? []}
          columns={[
            {
              title: 'Product',
              render: (_, row) => (
                <Space direction="vertical" size={0}>
                  <strong>{row.productName ?? '—'}</strong>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {row.productSku}
                  </Typography.Text>
                </Space>
              ),
            },
            { title: 'Quantity', dataIndex: 'quantity', align: 'right', render: (v) => quantity(v) },
            {
              title: 'Into',
              render: (_, row) =>
                row.toLocationCode ? <span style={{ fontFamily: 'monospace' }}>{row.toLocationCode}</span> : '—',
            },
            {
              title: 'Confirmed',
              dataIndex: 'confirmedAt',
              width: 140,
              render: (v: string | null) => (v ? <Tag color="success">yes</Tag> : <Tag>no</Tag>),
            },
          ]}
        />
      </Card>
    </Space>
  );
}

export function WarehouseReceipts() {
  const [params] = useSearchParams();
  const grnId = params.get('grnId') ?? undefined;
  const [creating, setCreating] = useState(Boolean(grnId));
  const { can } = useSession();
  const navigate = useNavigate();

  return (
    <>
      <ListPage<WarehouseReceipt>
        title="Warehouse receipts"
        path="/warehouse-receipts"
        searchPlaceholder="Number"
        onRowClick={(row) => navigate(`/warehouse-receipts/${row.id}`)}
        emptyDescription="No receipts issued yet. This is the customer's evidence that their goods are in store."
        actions={
          can('issue_warehouse_receipt') && <CreateButton label="Issue receipt" onClick={() => setCreating(true)} />
        }
        columns={[
          { title: 'Number', dataIndex: 'number', width: 180 },
          { title: 'Date', dataIndex: 'receiptDate', width: 140, render: (v) => date(v) },
          {
            title: 'Status',
            dataIndex: 'status',
            width: 130,
            render: (status: string) => <Tag color={statusColor(status)}>{humanise(status)}</Tag>,
          },
        ]}
      />
      <FormDrawer
        open={creating}
        title="Issue a warehouse receipt"
        path="/warehouse-receipts"
        invalidate={['/warehouse-receipts']}
        initialValues={grnId ? { grnId } : undefined}
        onClose={() => setCreating(false)}
        onSaved={(saved: WarehouseReceipt) => navigate(`/warehouse-receipts/${saved.id}`)}
      >
        {() => (
          <>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="Operational, not negotiable"
              description="This document is titled Warehouse Receipt (Operational) and states on its face that it is not a document of title and may not be pledged as security."
            />
            <Form.Item name="grnId" label="GRN" rules={[{ required: true }]}>
              <RecordPicker<{ id: string; number: string }>
                path="/grns"
                filters={{ status: 'approved' }}
                label={(row) => row.number}
              />
            </Form.Item>
          </>
        )}
      </FormDrawer>
    </>
  );
}

export function WarehouseReceiptDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['/warehouse-receipts', id],
    queryFn: () => api<WarehouseReceipt & { lines?: Record<string, unknown>[] }>(`/warehouse-receipts/${id}`),
  });

  return (
    <Card
      loading={isLoading}
      title={
        <Space>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {data?.number}
          </Typography.Title>
          <Tag color={statusColor(data?.status)}>{humanise(data?.status)}</Tag>
        </Space>
      }
      extra={
        <Space>
          <DocumentActions basePath={`/warehouse-receipts/${id}`} permission="issue_warehouse_receipt" />
          <RecordActions
            basePath="/warehouse-receipts"
            id={id}
            status={data?.status}
            invalidate={['/warehouse-receipts']}
            actions={[
              {
                label: 'Cancel',
                action: 'cancel',
                permission: 'issue_warehouse_receipt',
                from: ['issued'],
                danger: true,
                needsReason: true,
              },
            ]}
          />
        </Space>
      }
    >
      <Descriptions size="small" column={3}>
        <Descriptions.Item label="Date">{date(data?.receiptDate)}</Descriptions.Item>
        <Descriptions.Item label="GRN">
          <a onClick={() => navigate(`/grns/${data?.grnId}`)}>Open</a>
        </Descriptions.Item>
        <Descriptions.Item label="Status">{humanise(data?.status)}</Descriptions.Item>
      </Descriptions>
      <Alert
        type="info"
        showIcon
        style={{ marginTop: 16 }}
        message="The lines on this receipt are frozen"
        description="They were snapshotted when it was issued, along with the customer's details and the put-away locations. Editing the masters afterwards changes nothing here."
      />
    </Card>
  );
}

interface GrnForLines {
  id: string;
  warehouseId: string;
  items?: {
    id: string;
    productId: string;
    productSnapshot: { sku?: string; name?: string } | null;
    acceptedQty: number;
  }[];
}

/**
 * The GRN's accepted lines, each with a bin to put it into.
 *
 * It reads the GRN rather than asking the user to retype it: the
 * quantities are already known and the only decision left is *where*. A
 * line with nothing accepted is not offered at all — there is nothing to
 * shelve.
 */
function PutawayLinesField({ grnId, form }: { grnId?: string; form: FormInstance }) {
  const grn = useQuery({
    queryKey: ['/grns', grnId],
    queryFn: () => api<GrnForLines>(`/grns/${grnId}`),
    enabled: Boolean(grnId),
  });

  const items = (grn.data?.items ?? []).filter((item) => Number(item.acceptedQty) > 0);

  useEffect(() => {
    if (!grn.data) return;
    form.setFieldValue(
      'lines',
      items.map((item) => ({ grnItemId: item.id, quantity: Number(item.acceptedQty), toLocationId: undefined })),
    );
    // Re-seeded whenever a different GRN is chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grn.data?.id]);

  if (!grnId) return null;
  if (grn.isLoading) return <Spin />;
  if (items.length === 0) {
    return <Alert type="warning" showIcon message="This GRN accepted nothing, so there is nothing to put away" />;
  }

  return (
    <>
      <Typography.Title level={5}>Where each line goes</Typography.Title>
      <Form.List name="lines">
        {(fields) => (
          <>
            {fields.map((field, index) => {
              const item = items[index];
              return (
                <div key={field.key} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                  <Space direction="vertical" size={0} style={{ marginBottom: 8 }}>
                    <strong>{item?.productSnapshot?.name ?? 'Unnamed product'}</strong>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {item?.productSnapshot?.sku} · {quantity(item?.acceptedQty)} accepted
                    </Typography.Text>
                  </Space>
                  <Form.Item {...field} name={[field.name, 'grnItemId']} hidden>
                    <Input />
                  </Form.Item>
                  <Row gutter={12}>
                    <Col span={8}>
                      <Form.Item {...field} name={[field.name, 'quantity']} label="Quantity" rules={[{ required: true }]}>
                        <InputNumber min={0} max={Number(item?.acceptedQty ?? 0)} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={16}>
                      <Form.Item {...field} name={[field.name, 'toLocationId']} label="Bin" rules={[{ required: true }]}>
                        <RecordPicker<{ id: string; fullCode: string }>
                          path={`/warehouses/${grn.data?.warehouseId}/locations`}
                          unpaged
                          filters={{ level: 'bin' }}
                          label={(row) => row.fullCode}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </div>
              );
            })}
          </>
        )}
      </Form.List>
    </>
  );
}
