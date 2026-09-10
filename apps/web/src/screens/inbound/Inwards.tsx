import { useState } from 'react';
import { Alert, Card, Col, Descriptions, Form, Input, Row, Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CreateButton, ListPage } from '../../components/ListPage';
import { FormDrawer } from '../../components/FormDrawer';
import { RecordPicker } from '../../components/RecordPicker';
import { RecordActions } from '../../components/RecordActions';
import { DocumentActions } from '../../components/DocumentActions';
import { ItemLines } from '../../components/ItemLines';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { dateTime, humanise, quantity, statusColor } from '../../lib/format';

interface InwardItem {
  id: string;
  productId: string;
  /** Frozen at receipt, the same way the GRN's lines are. */
  productSnapshot: { sku?: string; name?: string; uom?: string } | null;
  batchNo: string | null;
  expectedQty: number;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
}

interface Inward {
  id: string;
  number: string;
  status: string;
  inwardAt: string;
  customerId: string | null;
  warehouseId: string;
  gateEntryId: string | null;
  vehicleNumber: string | null;
  lrNumber: string | null;
  invoiceNumber: string | null;
  remarks: string | null;
  items?: InwardItem[];
}

export function Inwards() {
  const [params] = useSearchParams();
  const gateEntryId = params.get('gateEntryId') ?? undefined;
  const [creating, setCreating] = useState(Boolean(gateEntryId));
  const { can } = useSession();
  const navigate = useNavigate();

  return (
    <>
      <ListPage<Inward>
        title="Inwards"
        path="/inwards"
        searchPlaceholder="Number or LR number"
        onRowClick={(row) => navigate(`/inwards/${row.id}`)}
        emptyDescription="No inwards yet. An inward is what came off the vehicle; the GRN is what the warehouse accepts."
        actions={can('create_inward') && <CreateButton label="New inward" onClick={() => setCreating(true)} />}
        columns={[
          { title: 'Number', dataIndex: 'number', width: 170 },
          { title: 'Received', dataIndex: 'inwardAt', width: 180, render: (v) => dateTime(v) },
          { title: 'Vehicle', dataIndex: 'vehicleNumber', render: (v) => v ?? '—' },
          { title: 'LR', dataIndex: 'lrNumber', render: (v) => v ?? '—' },
          { title: 'Supplier invoice', dataIndex: 'invoiceNumber', render: (v) => v ?? '—' },
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
        title="New inward"
        path="/inwards"
        width={720}
        invalidate={['/inwards']}
        initialValues={gateEntryId ? { gateEntryId } : undefined}
        onClose={() => setCreating(false)}
        onSaved={(saved: Inward) => navigate(`/inwards/${saved.id}`)}
      >
        {() => (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="Linking a gate entry fills in the rest"
              description="Warehouse, customer, vehicle, driver and transporter are all copied from it server-side — you do not have to retype what the security desk already recorded, and an inward cannot end up against a warehouse the vehicle never entered."
            />
            <Form.Item name="gateEntryId" label="Gate entry">
              <RecordPicker<{ id: string; number: string; vehicleNumber: string | null }>
                path="/gate-entries"
                filters={{ status: 'open' }}
                label={(row) => `${row.number}${row.vehicleNumber ? ` · ${row.vehicleNumber}` : ''}`}
              />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item
                  name="warehouseId"
                  label="Warehouse"
                  tooltip="Required unless a gate entry supplies it — the gate entry already says where the vehicle went"
                >
                  <RecordPicker<{ id: string; code: string; name: string }>
                    path="/warehouses"
                    label={(row) => `${row.code} — ${row.name}`}
                    placeholder="From the gate entry"
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="customerId"
                  label="Customer"
                  tooltip="Required unless a gate entry supplies it"
                >
                  <RecordPicker<{ id: string; code: string; name: string }>
                    path="/customers"
                    label={(row) => `${row.code} — ${row.name}`}
                    placeholder="From the gate entry"
                  />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="lrNumber" label="LR number">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="invoiceNumber" label="Supplier invoice">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="poNumber" label="PO number">
                  <Input />
                </Form.Item>
              </Col>
            </Row>
            <Typography.Title level={5}>What arrived</Typography.Title>
            <ItemLines
              name="items"
              withBatch
              quantities={[
                { name: 'expectedQty', label: 'Expected' },
                { name: 'receivedQty', label: 'Received' },
                { name: 'acceptedQty', label: 'Accepted' },
                { name: 'rejectedQty', label: 'Rejected' },
              ]}
            />
            <Form.Item name="remarks" label="Remarks" style={{ marginTop: 12 }}>
              <Input.TextArea rows={2} />
            </Form.Item>
          </>
        )}
      </FormDrawer>
    </>
  );
}

export function InwardDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ['/inwards', id], queryFn: () => api<Inward>(`/inwards/${id}`) });

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
            <DocumentActions basePath={`/inwards/${id}`} permission="create_inward" />
            <RecordActions
              basePath="/inwards"
              id={id}
              status={data?.status}
              invalidate={['/inwards']}
              actions={[
                { label: 'Mark received', action: 'receive', permission: 'create_inward', from: ['draft'], primary: true },
                { label: 'Cancel', action: 'cancel', permission: 'create_inward', from: ['draft', 'received'], danger: true, needsReason: true },
              ]}
            />
          </Space>
        }
      >
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="Received">{dateTime(data?.inwardAt)}</Descriptions.Item>
          <Descriptions.Item label="Vehicle">{data?.vehicleNumber ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="LR">{data?.lrNumber ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Supplier invoice">{data?.invoiceNumber ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Gate entry">
            {data?.gateEntryId ? (
              <a onClick={() => navigate(`/gate-entries/${data.gateEntryId}`)}>Open</a>
            ) : (
              'Not linked'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Remarks">{data?.remarks ?? '—'}</Descriptions.Item>
        </Descriptions>

        {data?.status === 'received' && can('create_grn') && (
          <Space style={{ marginTop: 16 }}>
            <Typography.Text type="secondary">Next:</Typography.Text>
            <CreateButton label="Raise the GRN" onClick={() => navigate(`/grns?inwardId=${id}`)} />
          </Space>
        )}
        {data?.status === 'draft' && (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 16 }}
            message="A GRN comes from a received inward"
            description="Mark this received once the unloading is done and the quantities above are what actually came off the vehicle."
          />
        )}
      </Card>

      <Card title="Lines">
        <Table<InwardItem>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={data?.items ?? []}
          columns={[
            {
              title: 'Product',
              render: (_, row) => (
                <Space direction="vertical" size={0}>
                  <strong>{row.productSnapshot?.name ?? 'Unnamed product'}</strong>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {row.productSnapshot?.sku}
                    {row.batchNo ? ` · batch ${row.batchNo}` : ''}
                  </Typography.Text>
                </Space>
              ),
            },
            { title: 'Expected', dataIndex: 'expectedQty', align: 'right', render: (v) => quantity(v) },
            { title: 'Received', dataIndex: 'receivedQty', align: 'right', render: (v) => quantity(v) },
            {
              title: 'Accepted',
              dataIndex: 'acceptedQty',
              align: 'right',
              render: (v) => <strong>{quantity(v)}</strong>,
            },
            { title: 'Rejected', dataIndex: 'rejectedQty', align: 'right', render: (v) => quantity(v) },
          ]}
        />
      </Card>
    </Space>
  );
}
