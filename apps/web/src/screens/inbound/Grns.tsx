import { useState } from 'react';
import { Alert, Card, Col, Descriptions, Form, Input, Row, Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CreateButton, ListPage } from '../../components/ListPage';
import { FormDrawer } from '../../components/FormDrawer';
import { RecordPicker } from '../../components/RecordPicker';
import { RecordActions } from '../../components/RecordActions';
import { Attachments } from '../../components/Attachments';
import { DocumentActions } from '../../components/DocumentActions';
import { ItemLines } from '../../components/ItemLines';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { date, humanise, quantity, statusColor } from '../../lib/format';

interface GrnItem {
  id: string;
  productId: string;
  /**
   * The SKU, name and UOM as they were when the goods were received --
   * frozen on the line, not looked up now. Renaming a product afterwards
   * must not silently rewrite what a receipt says was received, and the
   * PDF prints from this same snapshot.
   */
  productSnapshot: { sku?: string; name?: string; uom?: string } | null;
  batchNo: string | null;
  expectedQty: number;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  damagedQty: number;
  shortQty: number;
  excessQty: number;
}

interface Grn {
  id: string;
  number: string;
  status: string;
  grnDate: string;
  customerId: string | null;
  warehouseId: string;
  inwardId: string | null;
  returnInwardId: string | null;
  hasDiscrepancy: boolean;
  stockPostedAt: string | null;
  invoiceNumber: string | null;
  remarks: string | null;
  items?: GrnItem[];
}

/**
 * §50's Operator → Manager split, made visible. The Operator raises and
 * submits; `check` and `approve` need `approve_grn`, which the Operator
 * role does not hold — so those buttons are simply not there for them,
 * and the API refuses anyway if they try the URL.
 */
const GRN_ACTIONS = [
  { label: 'Submit', action: 'submit', permission: 'create_grn', from: ['draft'], primary: true },
  { label: 'Check', action: 'check', permission: 'approve_grn', from: ['submitted'], primary: true },
  { label: 'Approve', action: 'approve', permission: 'approve_grn', from: ['checked'], primary: true },
  { label: 'Reject', action: 'reject', permission: 'approve_grn', from: ['submitted', 'checked'], danger: true, needsReason: true },
  { label: 'Cancel', action: 'cancel', permission: 'create_grn', from: ['draft'], danger: true, needsReason: true },
  {
    label: 'Reverse',
    action: 'reverse',
    permission: 'approve_grn',
    from: ['approved'],
    danger: true,
    confirm:
      'This posts an offsetting ledger row for every row this GRN posted, taking the stock back out. It is refused if any of it has already moved.',
  },
];

export function Grns() {
  const [params] = useSearchParams();
  const inwardId = params.get('inwardId') ?? undefined;
  const [creating, setCreating] = useState(Boolean(inwardId));
  const { can } = useSession();
  const navigate = useNavigate();

  return (
    <>
      <ListPage<Grn>
        title="Goods receipt notes"
        path="/grns"
        searchPlaceholder="Number or supplier invoice"
        onRowClick={(row) => navigate(`/grns/${row.id}`)}
        emptyDescription="No GRNs yet. Approving one is what puts stock on the books."
        actions={can('create_grn') && <CreateButton label="New GRN" onClick={() => setCreating(true)} />}
        columns={[
          { title: 'Number', dataIndex: 'number', width: 180 },
          { title: 'Date', dataIndex: 'grnDate', width: 130, render: (v) => date(v) },
          { title: 'Supplier invoice', dataIndex: 'invoiceNumber', render: (v) => v ?? '—' },
          {
            title: 'Tally',
            dataIndex: 'hasDiscrepancy',
            width: 130,
            render: (has: boolean) => (has ? <Tag color="warning">discrepancy</Tag> : <Tag>clean</Tag>),
          },
          {
            title: 'Stock',
            dataIndex: 'stockPostedAt',
            width: 120,
            render: (posted: string | null) => (posted ? <Tag color="success">posted</Tag> : <Tag>not posted</Tag>),
          },
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
        title="New GRN"
        path="/grns"
        width={720}
        invalidate={['/grns']}
        initialValues={inwardId ? { inwardId } : undefined}
        onClose={() => setCreating(false)}
        onSaved={(saved: Grn) => navigate(`/grns/${saved.id}`)}
      >
        {(form) => (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="From an inward, or from scratch"
              description="Pick a received inward and the header and every line are copied from it, with short and excess quantities derived. Otherwise fill in the warehouse, customer and lines yourself."
            />
            <Form.Item name="inwardId" label="Inward">
              <RecordPicker<{ id: string; number: string }>
                path="/inwards"
                filters={{ status: 'received' }}
                label={(row) => row.number}
              />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="warehouseId" label="Warehouse">
                  <RecordPicker<{ id: string; code: string; name: string }>
                    path="/warehouses"
                    label={(row) => `${row.code} — ${row.name}`}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="customerId" label="Customer">
                  <RecordPicker<{ id: string; code: string; name: string }>
                    path="/customers"
                    label={(row) => `${row.code} — ${row.name}`}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="invoiceNumber" label="Supplier invoice">
              <Input />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(prev, next) => prev.inwardId !== next.inwardId}>
              {() =>
                form.getFieldValue('inwardId') ? (
                  // Lines are copied from the inward, down to the derived short
                  // and excess columns. Offering an empty line here would ask
                  // the user to retype what the API is about to copy -- and
                  // then quietly send it instead.
                  <Alert
                    type="success"
                    showIcon
                    message="Lines come from the inward"
                    description="Every line is copied across with its quantities; short and excess are worked out from expected versus received."
                  />
                ) : (
                  <>
                    <Typography.Title level={5}>Lines</Typography.Title>
                    <ItemLines
                      name="items"
                      withBatch
                      quantities={[
                        { name: 'expectedQty', label: 'Expected' },
                        { name: 'receivedQty', label: 'Received' },
                        { name: 'acceptedQty', label: 'Accepted' },
                        { name: 'damagedQty', label: 'Damaged' },
                      ]}
                    />
                  </>
                )
              }
            </Form.Item>
          </>
        )}
      </FormDrawer>
    </>
  );
}

export function GrnDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ['/grns', id], queryFn: () => api<Grn>(`/grns/${id}`) });

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
            {data?.hasDiscrepancy && <Tag color="warning">discrepancy</Tag>}
          </Space>
        }
        extra={
          <Space>
            <DocumentActions
              basePath={`/grns/${id}`}
              permission="create_grn"
              disabledReason={data?.status === 'draft' ? 'Submit the GRN first' : undefined}
            />
            <RecordActions basePath="/grns" id={id} status={data?.status} invalidate={['/grns', '/stock']} actions={GRN_ACTIONS} />
          </Space>
        }
      >
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
          <Descriptions.Item label="Date">{date(data?.grnDate)}</Descriptions.Item>
          <Descriptions.Item label="Supplier invoice">{data?.invoiceNumber ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Stock posted">
            {data?.stockPostedAt ? date(data.stockPostedAt) : 'Not yet — posting happens at approval'}
          </Descriptions.Item>
          <Descriptions.Item label="Inward">
            {data?.inwardId ? <a onClick={() => navigate(`/inwards/${data.inwardId}`)}>Open</a> : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Return" >
            {data?.returnInwardId ? 'Goods coming back' : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Remarks">{data?.remarks ?? '—'}</Descriptions.Item>
        </Descriptions>

        {data?.status === 'approved' && (
          <Space style={{ marginTop: 16 }} wrap>
            <Typography.Text type="secondary">Next:</Typography.Text>
            {can('create_putaway') && (
              <CreateButton label="Put it away" onClick={() => navigate(`/putaways?grnId=${id}`)} />
            )}
            {can('issue_warehouse_receipt') && (
              <CreateButton
                label="Issue warehouse receipt"
                onClick={() => navigate(`/warehouse-receipts?grnId=${id}`)}
              />
            )}
          </Space>
        )}
        {data?.hasDiscrepancy && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 16 }}
            message="This receipt does not tally"
            description="Received, accepted and rejected do not add up to what was expected. The GRN document prints the discrepancy on its face, and a Discrepancy Report can be raised against it."
          />
        )}
      </Card>

      <Card title="Lines">
        <Table<GrnItem>
          scroll={{ x: 'max-content' }}
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
            { title: 'Damaged', dataIndex: 'damagedQty', align: 'right', render: (v) => quantity(v) },
            {
              title: 'Short',
              dataIndex: 'shortQty',
              align: 'right',
              render: (v: number) => (Number(v) > 0 ? <Typography.Text type="danger">{quantity(v)}</Typography.Text> : '—'),
            },
            {
              title: 'Excess',
              dataIndex: 'excessQty',
              align: 'right',
              render: (v: number) => (Number(v) > 0 ? <Typography.Text type="warning">{quantity(v)}</Typography.Text> : '—'),
            },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          Only the accepted column posts to stock, and only once the GRN is approved.
        </Typography.Paragraph>
      </Card>

      {/* Blueprint §21: the photographs that make a damage claim arguable. */}
      <Attachments
        ownerType="grn"
        ownerId={id}
        title="Photos and paperwork"
        categories={['photo', 'invoice', 'lr', 'eway_bill', 'other']}
        writePermission="create_grn"
        emptyText="No photos yet. On a phone, the button opens the camera — photograph the damage where it is, not from memory."
      />
    </Space>
  );
}
