import { useState } from 'react';
import { Alert, Card, Col, Descriptions, Form, Input, InputNumber, Row, Space, Table, Tag, Typography } from 'antd';
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

interface PickListLine {
  id: string;
  sku?: string;
  productName?: string;
  locationCode: string | null;
  batchNo: string | null;
  requiredQty: number;
  pickQty: number;
}

interface PickList {
  id: string;
  number: string;
  status: string;
  releaseOrderId: string;
  allocationPolicy: string;
  lines?: PickListLine[];
}

interface DispatchLine {
  id: string;
  sku?: string;
  productName?: string;
  quantity: number;
}

interface Dispatch {
  id: string;
  number: string;
  status: string;
  dispatchDate: string;
  releaseOrderId: string;
  consigneeName: string | null;
  lrNumber: string | null;
  vehicleNumber: string | null;
  lines?: DispatchLine[];
}

export function PickLists() {
  const [params] = useSearchParams();
  const releaseOrderId = params.get('releaseOrderId') ?? undefined;
  const [creating, setCreating] = useState(Boolean(releaseOrderId));
  const { can } = useSession();
  const navigate = useNavigate();

  return (
    <>
      <ListPage<PickList>
        title="Pick lists"
        path="/pick-lists"
        searchPlaceholder="Number"
        onRowClick={(row) => navigate(`/pick-lists/${row.id}`)}
        emptyDescription="No pick lists yet. One is generated from a release order's reservations — it never chooses stock of its own."
        actions={can('create_pick_list') && <CreateButton label="New pick list" onClick={() => setCreating(true)} />}
        columns={[
          { title: 'Number', dataIndex: 'number', width: 180 },
          { title: 'Policy', dataIndex: 'allocationPolicy', width: 110, render: (v) => <Tag>{String(v).toUpperCase()}</Tag> },
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
        title="New pick list"
        path="/pick-lists"
        invalidate={['/pick-lists']}
        initialValues={releaseOrderId ? { releaseOrderId } : undefined}
        onClose={() => setCreating(false)}
        onSaved={(saved: PickList) => navigate(`/pick-lists/${saved.id}`)}
      >
        {() => (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="Built from what is already reserved"
              description="The lines, their bins and their quantities all come from the reservation rows the release order posted. Deciding here instead would mean the goods a customer was promised could be given away in between."
            />
            <Form.Item name="releaseOrderId" label="Release order" rules={[{ required: true }]}>
              <RecordPicker<{ id: string; number: string }>
                path="/release-orders"
                filters={{ status: 'reserved' }}
                label={(row) => row.number}
              />
            </Form.Item>
          </>
        )}
      </FormDrawer>
    </>
  );
}

export function PickListDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['/pick-lists', id], queryFn: () => api<PickList>(`/pick-lists/${id}`) });
  const { can } = useSession();

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
            <Tag>{String(data?.allocationPolicy ?? '').toUpperCase()}</Tag>
          </Space>
        }
        extra={
          <Space wrap>
            <DocumentActions basePath={`/pick-lists/${id}`} permission="create_pick_list" />
            {can('confirm_pick') && data?.status !== 'completed' && (
              <CreateButton label="Confirm picks" onClick={() => setConfirming(true)} />
            )}
            <RecordActions
              basePath="/pick-lists"
              id={id}
              status={data?.status}
              invalidate={['/pick-lists', '/release-orders']}
              actions={[
                { label: 'Complete', action: 'complete', permission: 'confirm_pick', from: ['in_progress', 'pending'], primary: true },
              ]}
            />
          </Space>
        }
      >
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="Release order">
            <a onClick={() => navigate(`/release-orders/${data?.releaseOrderId}`)}>Open</a>
          </Descriptions.Item>
          <Descriptions.Item label="Policy">{String(data?.allocationPolicy ?? '').toUpperCase()}</Descriptions.Item>
          <Descriptions.Item label="Status">{humanise(data?.status)}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="Pick these">
        <Table<PickListLine>
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
                    {row.sku}
                    {row.batchNo ? ` · batch ${row.batchNo}` : ''}
                  </Typography.Text>
                </Space>
              ),
            },
            {
              title: 'From',
              dataIndex: 'locationCode',
              width: 180,
              render: (code: string | null) =>
                code ? <span style={{ fontFamily: 'monospace' }}>{code}</span> : <Tag>unallocated</Tag>,
            },
            { title: 'Required', dataIndex: 'requiredQty', align: 'right', width: 120, render: (v) => quantity(v) },
            {
              title: 'Picked',
              dataIndex: 'pickQty',
              align: 'right',
              width: 120,
              render: (v) => <strong>{quantity(v)}</strong>,
            },
          ]}
        />
      </Card>

      <FormDrawer
        open={confirming}
        title="Confirm what was picked"
        path={`/pick-lists/${id}/confirm`}
        width={620}
        invalidate={['/pick-lists', '/release-orders']}
        onClose={() => setConfirming(false)}
        transform={(values) => ({
          lines: ((values.lines as { lineId: string; pickQty: number }[]) ?? []).filter((line) => line.pickQty > 0),
        })}
        initialValues={{
          lines: (data?.lines ?? []).map((line) => ({ lineId: line.id, pickQty: line.requiredQty })),
        }}
      >
        {() => (
          <Form.List name="lines">
            {(fields) => (
              <>
                {fields.map((field, index) => {
                  const line = data?.lines?.[index];
                  return (
                    <Row key={field.key} gutter={12} align="middle" style={{ marginBottom: 8 }}>
                      <Col span={16}>
                        <Space direction="vertical" size={0}>
                          <strong>{line?.productName}</strong>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {line?.locationCode} · {quantity(line?.requiredQty)} required
                          </Typography.Text>
                        </Space>
                        <Form.Item {...field} name={[field.name, 'lineId']} hidden>
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item {...field} name={[field.name, 'pickQty']} label="Picked">
                          <InputNumber min={0} max={line?.requiredQty} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                    </Row>
                  );
                })}
              </>
            )}
          </Form.List>
        )}
      </FormDrawer>
    </Space>
  );
}

export function Dispatches() {
  const [params] = useSearchParams();
  const releaseOrderId = params.get('releaseOrderId') ?? undefined;
  const [creating, setCreating] = useState(Boolean(releaseOrderId));
  const { can } = useSession();
  const navigate = useNavigate();

  return (
    <>
      <ListPage<Dispatch>
        title="Dispatches"
        path="/dispatches"
        searchPlaceholder="Number or LR"
        onRowClick={(row) => navigate(`/dispatches/${row.id}`)}
        emptyDescription="No dispatches yet. Stock leaves the books at gate-out, not here."
        actions={can('create_dispatch') && <CreateButton label="New dispatch" onClick={() => setCreating(true)} />}
        columns={[
          { title: 'Number', dataIndex: 'number', width: 180 },
          { title: 'Date', dataIndex: 'dispatchDate', width: 130, render: (v) => date(v) },
          { title: 'Consignee', dataIndex: 'consigneeName', render: (v) => v ?? '—' },
          { title: 'LR', dataIndex: 'lrNumber', render: (v) => v ?? '—' },
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
        title="New dispatch"
        path="/dispatches"
        invalidate={['/dispatches']}
        initialValues={releaseOrderId ? { releaseOrderId } : undefined}
        onClose={() => setCreating(false)}
        onSaved={(saved: Dispatch) => navigate(`/dispatches/${saved.id}`)}
      >
        {() => (
          <>
            <Form.Item name="releaseOrderId" label="Release order" rules={[{ required: true }]}>
              <RecordPicker<{ id: string; number: string }>
                path="/release-orders"
                label={(row) => row.number}
              />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="lrNumber" label="LR number">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="vehicleId" label="Vehicle">
                  <RecordPicker<{ id: string; vehicleNumber: string }>
                    path="/vehicles"
                    label={(row) => row.vehicleNumber}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="consigneeName" label="Consignee">
              <Input />
            </Form.Item>
            <Form.Item name="ewayBillNumber" label="E-way bill">
              <Input />
            </Form.Item>
          </>
        )}
      </FormDrawer>
    </>
  );
}

export function DispatchDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ['/dispatches', id], queryFn: () => api<Dispatch>(`/dispatches/${id}`) });
  const gatePasses = useQuery({
    queryKey: ['/gate-passes', { dispatchId: id }],
    queryFn: () => api<{ items: { id: string; number: string; status: string }[] }>(`/gate-passes?dispatchId=${id}`),
  });
  const pods = useQuery({
    queryKey: ['/pods', { dispatchId: id }],
    queryFn: () => api<{ items: { id: string; number: string; status: string }[] }>(`/pods?dispatchId=${id}`),
  });

  const pass = gatePasses.data?.items?.[0];
  const pod = pods.data?.items?.[0];

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
          <Space wrap>
            <DocumentActions basePath={`/dispatches/${id}`} permission="create_dispatch" />
            <RecordActions
              basePath="/dispatches"
              id={id}
              status={data?.status}
              invalidate={['/dispatches', '/stock']}
              actions={[
                { label: 'Confirm', action: 'confirm', permission: 'create_dispatch', from: ['draft'], primary: true },
                { label: 'Cancel', action: 'cancel', permission: 'create_dispatch', from: ['draft'], danger: true, needsReason: true },
              ]}
            />
          </Space>
        }
      >
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="Date">{date(data?.dispatchDate)}</Descriptions.Item>
          <Descriptions.Item label="Consignee">{data?.consigneeName ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="LR">{data?.lrNumber ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Release order">
            <a onClick={() => navigate(`/release-orders/${data?.releaseOrderId}`)}>Open</a>
          </Descriptions.Item>
          <Descriptions.Item label="Gate pass">
            {pass ? `${pass.number} · ${humanise(pass.status)}` : 'Not raised'}
          </Descriptions.Item>
          <Descriptions.Item label="Proof of delivery">
            {pod ? `${pod.number} · ${humanise(pod.status)}` : 'Not captured'}
          </Descriptions.Item>
        </Descriptions>

        <Alert
          type="info"
          showIcon
          style={{ marginTop: 16 }}
          message="Stock leaves at gate-out"
          description="Physical stock is unchanged until the gate pass is gated out — that is the single OUTWARD posting, and it releases the reservation at the same moment."
        />

        <Space style={{ marginTop: 16 }} wrap>
          {!pass && can('create_gate_pass') && (
            <GatePassButton dispatchId={id} onDone={() => gatePasses.refetch()} />
          )}
          {pass && pass.status !== 'gate_out' && can('confirm_gate_out') && (
            <RecordActions
              basePath="/gate-passes"
              id={pass.id}
              status={pass.status}
              invalidate={['/gate-passes', '/dispatches', '/stock']}
              actions={[
                {
                  label: 'Gate out',
                  action: 'gate-out',
                  permission: 'confirm_gate_out',
                  primary: true,
                  confirm: 'This posts the OUTWARD movement — the goods leave the books now.',
                },
              ]}
            />
          )}
          {pass?.status === 'gate_out' && !pod && can('capture_pod') && (
            <PodButton dispatchId={id} onDone={() => pods.refetch()} />
          )}
          {pod && <CreateButton label="Open the POD" onClick={() => navigate(`/pods/${pod.id}`)} />}
        </Space>
      </Card>

      <Card title="Lines">
        <Table<DispatchLine>
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
                    {row.sku}
                  </Typography.Text>
                </Space>
              ),
            },
            { title: 'Quantity', dataIndex: 'quantity', align: 'right', render: (v) => quantity(v) },
          ]}
        />
      </Card>
    </Space>
  );
}

function GatePassButton({ dispatchId, onDone }: { dispatchId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <CreateButton label="Raise the gate pass" onClick={() => setOpen(true)} />
      <FormDrawer
        open={open}
        title="Raise a gate pass"
        path="/gate-passes"
        invalidate={['/gate-passes', '/dispatches']}
        initialValues={{ dispatchId }}
        onClose={() => {
          setOpen(false);
          onDone();
        }}
      >
        {() => (
          <>
            <Form.Item name="dispatchId" hidden>
              <Input />
            </Form.Item>
            <Form.Item name="sealNumber" label="Seal number">
              <Input />
            </Form.Item>
            <Form.Item name="remarks" label="Remarks">
              <Input.TextArea rows={2} />
            </Form.Item>
          </>
        )}
      </FormDrawer>
    </>
  );
}

function PodButton({ dispatchId, onDone }: { dispatchId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <CreateButton label="Capture proof of delivery" onClick={() => setOpen(true)} />
      <FormDrawer
        open={open}
        title="Capture proof of delivery"
        path="/pods"
        invalidate={['/pods', '/dispatches']}
        initialValues={{ dispatchId }}
        onClose={() => {
          setOpen(false);
          onDone();
        }}
      >
        {() => (
          <Form.Item name="dispatchId" hidden>
            <Input />
          </Form.Item>
        )}
      </FormDrawer>
    </>
  );
}
