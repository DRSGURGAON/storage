import { useState } from 'react';
import { Alert, Card, Descriptions, Form, Input, InputNumber, Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { CreateButton, ListPage } from '../../components/ListPage';
import { FormDrawer } from '../../components/FormDrawer';
import { Attachments } from '../../components/Attachments';
import { DocumentActions } from '../../components/DocumentActions';
import { api } from '../../lib/api';
import { date, dateTime, humanise, quantity } from '../../lib/format';

interface PodLine {
  id: string;
  sku: string;
  productName: string | null;
  batchNo: string | null;
  dispatchedQty: number;
  receivedQty: number;
  shortageQty: number;
  damagedQty: number;
  remarks: string | null;
}

interface Pod {
  id: string;
  number: string;
  dispatchId: string;
  dispatchNumber: string;
  deliveryDate: string | null;
  receiverName: string | null;
  receiverMobile: string | null;
  status: string;
  remarks: string | null;
  capturedAt: string | null;
  signatureAttachmentId: string | null;
  stampAttachmentId: string | null;
  lines: PodLine[];
}

const statusColor = (status?: string) =>
  status === 'delivered' ? 'success' : status === 'pending' ? 'default' : status === 'rejected' ? 'error' : 'warning';

export function Pods() {
  const navigate = useNavigate();
  return (
    <ListPage<Pod>
      title="Proof of delivery"
      path="/pods"
      searchPlaceholder="POD number"
      emptyDescription="A POD appears once a gate pass has been gated out; it is raised from the dispatch."
      onRowClick={(row) => navigate(`/pods/${row.id}`)}
      columns={[
        { title: 'Number', dataIndex: 'number', width: 180 },
        { title: 'Dispatch', dataIndex: 'dispatchNumber', width: 180 },
        { title: 'Delivered', dataIndex: 'deliveryDate', width: 130, render: (v) => date(v) },
        { title: 'Received by', dataIndex: 'receiverName', render: (v) => v ?? '—' },
        {
          title: 'Status',
          dataIndex: 'status',
          width: 130,
          render: (v: string) => <Tag color={statusColor(v)}>{humanise(v)}</Tag>,
        },
      ]}
    />
  );
}

/**
 * Blueprint §36. The screen a delivery is actually closed on, and the one
 * place in this application where a signature is taken rather than typed:
 * the receiver signs on the phone in front of the driver, and that image
 * becomes `pods.signature_attachment_id` — the column the POD document
 * prints from.
 */
export function PodDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [capturing, setCapturing] = useState(false);
  const { data, isLoading, refetch } = useQuery({ queryKey: ['/pods', id], queryFn: () => api<Pod>(`/pods/${id}`) });

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
            <DocumentActions
              basePath={`/pods/${id}`}
              permission="capture_pod"
              disabledReason={data?.status === 'pending' ? 'Capture the delivery first' : undefined}
            />
            {data?.status === 'pending' && (
              <CreateButton label="Record the delivery" onClick={() => setCapturing(true)} />
            )}
          </Space>
        }
      >
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
          <Descriptions.Item label="Dispatch">
            <a onClick={() => navigate(`/dispatches/${data?.dispatchId}`)}>{data?.dispatchNumber}</a>
          </Descriptions.Item>
          <Descriptions.Item label="Delivered on">{date(data?.deliveryDate)}</Descriptions.Item>
          <Descriptions.Item label="Captured">{data?.capturedAt ? dateTime(data.capturedAt) : 'Not yet'}</Descriptions.Item>
          <Descriptions.Item label="Received by">{data?.receiverName ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Mobile">{data?.receiverMobile ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Signature">
            {data?.signatureAttachmentId ? 'Captured' : 'Not captured'}
          </Descriptions.Item>
          <Descriptions.Item label="Remarks" span={3}>
            {data?.remarks ?? '—'}
          </Descriptions.Item>
        </Descriptions>

        {data && data.status !== 'pending' && data.status !== 'delivered' && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 16 }}
            message={`This delivery was ${humanise(data.status).toLowerCase()}`}
            description="A Discrepancy Report can be raised against a POD that came back short, damaged or rejected — that is what turns it into a claim."
          />
        )}
      </Card>

      <Card title="Lines">
        <Table<PodLine>
          size="small"
          rowKey="id"
          pagination={false}
          scroll={{ x: 'max-content' }}
          dataSource={data?.lines ?? []}
          columns={[
            {
              title: 'Product',
              render: (_, row) => (
                <Space direction="vertical" size={0}>
                  <strong>{row.productName ?? 'Unnamed product'}</strong>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {row.sku}
                    {row.batchNo ? ` · batch ${row.batchNo}` : ''}
                  </Typography.Text>
                </Space>
              ),
            },
            { title: 'Dispatched', dataIndex: 'dispatchedQty', align: 'right', render: (v) => quantity(v) },
            { title: 'Received', dataIndex: 'receivedQty', align: 'right', render: (v) => <strong>{quantity(v)}</strong> },
            {
              title: 'Short',
              dataIndex: 'shortageQty',
              align: 'right',
              render: (v: number) => (Number(v) > 0 ? <Typography.Text type="danger">{quantity(v)}</Typography.Text> : '—'),
            },
            {
              title: 'Damaged',
              dataIndex: 'damagedQty',
              align: 'right',
              render: (v: number) => (Number(v) > 0 ? <Typography.Text type="warning">{quantity(v)}</Typography.Text> : '—'),
            },
          ]}
        />
      </Card>

      <Attachments
        ownerType="pod"
        ownerId={id}
        title="Signature and photos"
        categories={['signature', 'stamp', 'photo', 'other']}
        writePermission="capture_pod"
        allowSignature
        onChanged={() => refetch()}
        emptyText="Nothing captured yet. The receiver signs here, and anything that arrived damaged is worth a photograph."
      />

      <FormDrawer
        open={capturing}
        title="Record the delivery"
        path={`/pods/${id}/capture`}
        invalidate={['/pods', '/dispatches']}
        initialValues={{
          lines: (data?.lines ?? []).map((line) => ({ lineId: line.id, receivedQty: line.dispatchedQty, damagedQty: 0 })),
        }}
        onClose={() => {
          setCapturing(false);
          refetch();
        }}
      >
        {() => (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="Lines left blank are taken as received in full"
              description="Fill in a received quantity only where less arrived than was sent, or where something arrived damaged."
            />
            <Form.Item name="deliveryDate" label="Delivered on">
              <Input type="date" />
            </Form.Item>
            <Form.Item name="receiverName" label="Received by">
              <Input />
            </Form.Item>
            <Form.Item name="receiverMobile" label="Mobile">
              <Input />
            </Form.Item>
            {/* Every line, pre-filled with what was sent -- the common case
                is "all of it arrived", and typing a line id by hand is not
                something anyone standing at a tailgate should be asked to do. */}
            <Typography.Text strong>What actually arrived</Typography.Text>
            <Form.List name="lines">
              {(fields) => (
                <>
                  {fields.map((field, index) => {
                    const line = data?.lines[index];
                    return (
                      <div key={field.key} style={{ marginTop: 12 }}>
                        <Form.Item {...field} name={[field.name, 'lineId']} hidden>
                          <Input />
                        </Form.Item>
                        <Typography.Text>
                          {line?.productName ?? line?.sku}
                          {line?.batchNo ? ` · batch ${line.batchNo}` : ''}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                          {quantity(line?.dispatchedQty ?? 0)} dispatched
                        </Typography.Text>
                        <Space wrap style={{ marginTop: 4 }}>
                          <Form.Item {...field} name={[field.name, 'receivedQty']} label="Received" style={{ marginBottom: 0 }}>
                            <InputNumber min={0} max={line?.dispatchedQty} />
                          </Form.Item>
                          <Form.Item {...field} name={[field.name, 'damagedQty']} label="Damaged" style={{ marginBottom: 0 }}>
                            <InputNumber min={0} />
                          </Form.Item>
                        </Space>
                      </div>
                    );
                  })}
                </>
              )}
            </Form.List>
            <Form.Item name="remarks" label="Remarks" style={{ marginTop: 16 }}>
              <Input.TextArea rows={2} />
            </Form.Item>
          </>
        )}
      </FormDrawer>
    </Space>
  );
}
