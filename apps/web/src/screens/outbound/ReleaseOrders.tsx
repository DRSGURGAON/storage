import { useState } from 'react';
import { Alert, Card, Col, Descriptions, Form, Input, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { CreateButton, ListPage } from '../../components/ListPage';
import { FormDrawer } from '../../components/FormDrawer';
import { RecordPicker } from '../../components/RecordPicker';
import { RecordActions } from '../../components/RecordActions';
import { DocumentActions } from '../../components/DocumentActions';
import { ItemLines } from '../../components/ItemLines';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { date, humanise, quantity, statusColor } from '../../lib/format';

interface ReleaseOrderLine {
  id: string;
  productId: string;
  sku?: string;
  productName?: string;
  requestedQty: number;
  reservedQty: number;
  pickedQty: number;
  dispatchedQty: number;
}

interface ReleaseOrder {
  id: string;
  number: string;
  status: string;
  orderDate: string;
  requestedDate: string | null;
  customerId: string;
  warehouseId: string;
  consigneeName: string | null;
  consigneeAddress: string | null;
  instructions: string | null;
  lines?: ReleaseOrderLine[];
}

export function ReleaseOrders() {
  const [creating, setCreating] = useState(false);
  const { can } = useSession();
  const navigate = useNavigate();

  return (
    <>
      <ListPage<ReleaseOrder>
        title="Release orders"
        path="/release-orders"
        searchPlaceholder="Number or consignee"
        onRowClick={(row) => navigate(`/release-orders/${row.id}`)}
        emptyDescription="No release orders yet. This is the customer's instruction to ship — reserving against it is what holds the goods."
        actions={
          can('create_release_order') && <CreateButton label="New release order" onClick={() => setCreating(true)} />
        }
        columns={[
          { title: 'Number', dataIndex: 'number', width: 180 },
          { title: 'Ordered', dataIndex: 'orderDate', width: 130, render: (v) => date(v) },
          { title: 'Wanted by', dataIndex: 'requestedDate', width: 130, render: (v) => date(v) },
          { title: 'Consignee', dataIndex: 'consigneeName', render: (v) => v ?? '—' },
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
        title="New release order"
        path="/release-orders"
        width={680}
        invalidate={['/release-orders']}
        onClose={() => setCreating(false)}
        onSaved={(saved: ReleaseOrder) => navigate(`/release-orders/${saved.id}`)}
      >
        {() => (
          <>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="customerId" label="Customer" rules={[{ required: true }]}>
                  <RecordPicker<{ id: string; code: string; name: string }>
                    path="/customers"
                    label={(row) => `${row.code} — ${row.name}`}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="warehouseId" label="Ship from" rules={[{ required: true }]}>
                  <RecordPicker<{ id: string; code: string; name: string }>
                    path="/warehouses"
                    label={(row) => `${row.code} — ${row.name}`}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name="consigneeName"
              label="Consignee"
              tooltip="Snapshotted onto the order, so later edits to the customer's address do not rewrite where this consignment was going"
            >
              <Input />
            </Form.Item>
            <Form.Item name="consigneeAddress" label="Delivery address">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Typography.Title level={5}>What to ship</Typography.Title>
            <ItemLines name="lines" quantities={[{ name: 'requestedQty', label: 'Quantity', required: true }]} />
            <Form.Item name="instructions" label="Instructions" style={{ marginTop: 12 }}>
              <Input.TextArea rows={2} />
            </Form.Item>
          </>
        )}
      </FormDrawer>
    </>
  );
}

export function ReleaseOrderDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useSession();
  const [reserving, setReserving] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['/release-orders', id],
    queryFn: () => api<ReleaseOrder>(`/release-orders/${id}`),
  });

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
            <DocumentActions basePath={`/release-orders/${id}`} permission="create_release_order" />
            {data?.status === 'approved' && can('reserve_stock') && (
              <CreateButton label="Reserve stock" onClick={() => setReserving(true)} />
            )}
            <RecordActions
              basePath="/release-orders"
              id={id}
              status={data?.status}
              invalidate={['/release-orders', '/stock']}
              actions={[
                { label: 'Approve', action: 'approve', permission: 'approve_release_order', from: ['draft'], primary: true },
                {
                  label: 'Cancel',
                  action: 'cancel',
                  permission: 'create_release_order',
                  from: ['draft', 'approved', 'reserved', 'partially_picked', 'picked'],
                  danger: true,
                  needsReason: true,
                  confirm: undefined,
                },
              ]}
            />
          </Space>
        }
      >
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="Ordered">{date(data?.orderDate)}</Descriptions.Item>
          <Descriptions.Item label="Wanted by">{date(data?.requestedDate)}</Descriptions.Item>
          <Descriptions.Item label="Consignee">{data?.consigneeName ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Delivery address" span={2}>
            {data?.consigneeAddress ?? '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Instructions">{data?.instructions ?? '—'}</Descriptions.Item>
        </Descriptions>

        {data?.status === 'reserved' && (
          <Space style={{ marginTop: 16 }} wrap>
            <Typography.Text type="secondary">Next:</Typography.Text>
            {can('create_pick_list') && (
              <CreateButton label="Raise the pick list" onClick={() => navigate(`/pick-lists?releaseOrderId=${id}`)} />
            )}
          </Space>
        )}
        {data?.status === 'picked' && can('create_dispatch') && (
          <Space style={{ marginTop: 16 }} wrap>
            <Typography.Text type="secondary">Next:</Typography.Text>
            <CreateButton label="Dispatch it" onClick={() => navigate(`/dispatches?releaseOrderId=${id}`)} />
          </Space>
        )}
      </Card>

      <Card title="Lines">
        <Table<ReleaseOrderLine>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={data?.lines ?? []}
          columns={[
            {
              title: 'Product',
              render: (_, row) => (
                <Space direction="vertical" size={0}>
                  <strong>{row.productName ?? row.productId}</strong>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {row.sku}
                  </Typography.Text>
                </Space>
              ),
            },
            { title: 'Requested', dataIndex: 'requestedQty', align: 'right', render: (v) => quantity(v) },
            { title: 'Reserved', dataIndex: 'reservedQty', align: 'right', render: (v) => quantity(v) },
            { title: 'Picked', dataIndex: 'pickedQty', align: 'right', render: (v) => quantity(v) },
            { title: 'Dispatched', dataIndex: 'dispatchedQty', align: 'right', render: (v) => quantity(v) },
          ]}
        />
      </Card>

      <FormDrawer
        open={reserving}
        title="Reserve stock"
        path={`/release-orders/${id}/reserve`}
        invalidate={['/release-orders', '/stock']}
        onClose={() => setReserving(false)}
      >
        {() => (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="All or nothing"
              description="Reservation draws only on stock that has been put away, and either covers every line in full or reserves nothing at all — with a message saying how much is still unallocated."
            />
            <Form.Item
              name="allocationPolicy"
              label="Policy"
              tooltip="Leave blank to use the workspace's own setting"
            >
              <Select
                allowClear
                placeholder="The workspace default"
                options={[
                  { value: 'fifo', label: 'FIFO — oldest stock first' },
                  { value: 'lifo', label: 'LIFO — newest stock first' },
                  { value: 'fefo', label: 'FEFO — soonest expiry first' },
                ]}
              />
            </Form.Item>
          </>
        )}
      </FormDrawer>
    </Space>
  );
}
