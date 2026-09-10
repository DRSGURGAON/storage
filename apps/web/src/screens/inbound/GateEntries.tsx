import { useState } from 'react';
import { Card, Col, Descriptions, Form, Input, Row, Select, Space, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { CreateButton, ListPage } from '../../components/ListPage';
import { FormDrawer } from '../../components/FormDrawer';
import { RecordPicker } from '../../components/RecordPicker';
import { RecordActions } from '../../components/RecordActions';
import { Attachments } from '../../components/Attachments';
import { DocumentActions } from '../../components/DocumentActions';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { dateTime, humanise, statusColor } from '../../lib/format';

interface GateEntry {
  id: string;
  number: string;
  direction: string;
  purpose: string;
  status: string;
  entryAt: string;
  exitAt: string | null;
  vehicleNumber: string | null;
  driverName: string | null;
  customerId: string | null;
  warehouseId: string;
  referenceNo: string | null;
  remarks: string | null;
}

export function GateEntries() {
  const [creating, setCreating] = useState(false);
  const { can } = useSession();
  const navigate = useNavigate();

  return (
    <>
      <ListPage<GateEntry>
        title="Gate entries"
        path="/gate-entries"
        searchPlaceholder="Number, vehicle or reference"
        onRowClick={(row) => navigate(`/gate-entries/${row.id}`)}
        emptyDescription="No gate entries yet. This is the first record of a vehicle arriving — everything inbound hangs off it."
        actions={can('create_gate_entry') && <CreateButton label="New gate entry" onClick={() => setCreating(true)} />}
        columns={[
          { title: 'Number', dataIndex: 'number', width: 170 },
          { title: 'In / out', dataIndex: 'direction', width: 90, render: (v) => <Tag>{humanise(v)}</Tag> },
          { title: 'Purpose', dataIndex: 'purpose', width: 120, render: (v) => humanise(v) },
          { title: 'Vehicle', dataIndex: 'vehicleNumber', render: (v) => v ?? '—' },
          { title: 'Driver', dataIndex: 'driverName', render: (v) => v ?? '—' },
          { title: 'Arrived', dataIndex: 'entryAt', width: 180, render: (v) => dateTime(v) },
          {
            title: 'Status',
            dataIndex: 'status',
            width: 110,
            render: (status: string) => <Tag color={statusColor(status)}>{humanise(status)}</Tag>,
          },
        ]}
      />
      <FormDrawer
        open={creating}
        title="New gate entry"
        path="/gate-entries"
        invalidate={['/gate-entries']}
        onClose={() => setCreating(false)}
        onSaved={(saved: GateEntry) => navigate(`/gate-entries/${saved.id}`)}
      >
        {() => <GateEntryFields />}
      </FormDrawer>
    </>
  );
}

function GateEntryFields() {
  return (
    <>
      <Form.Item name="warehouseId" label="Warehouse" rules={[{ required: true }]}>
        <RecordPicker<{ id: string; code: string; name: string }>
          path="/warehouses"
          label={(row) => `${row.code} — ${row.name}`}
        />
      </Form.Item>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name="direction" label="Direction" rules={[{ required: true }]} initialValue="in">
            <Select options={[{ value: 'in', label: 'Coming in' }, { value: 'out', label: 'Going out' }]} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="purpose" label="Purpose" rules={[{ required: true }]} initialValue="inward">
            <Select
              options={['inward', 'outward', 'return', 'transfer', 'visitor', 'other'].map((value) => ({
                value,
                label: humanise(value),
              }))}
            />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item
        name="customerId"
        label="Customer"
        tooltip="Carried onto the Inward raised from this entry, so it does not have to be typed twice"
      >
        <RecordPicker<{ id: string; code: string; name: string }>
          path="/customers"
          label={(row) => `${row.code} — ${row.name}`}
        />
      </Form.Item>
      <Form.Item
        name="vehicleId"
        label="Vehicle"
        tooltip="Picking a known vehicle also fills in its transporter"
      >
        <RecordPicker<{ id: string; vehicleNumber: string }> path="/vehicles" label={(row) => row.vehicleNumber} />
      </Form.Item>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name="vehicleNumber" label="…or a number" tooltip="For a vehicle not in the master">
            <Input placeholder="HR 26 DK 1234" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="driverName" label="Driver">
            <Input />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name="driverMobile" label="Driver mobile">
            <Input />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="referenceNo" label="Reference">
            <Input placeholder="DC / invoice number on the vehicle" />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name="remarks" label="Remarks">
        <Input.TextArea rows={2} />
      </Form.Item>
    </>
  );
}

export function GateEntryDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['/gate-entries', id],
    queryFn: () => api<GateEntry>(`/gate-entries/${id}`),
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
          <Space>
            <DocumentActions basePath={`/gate-entries/${id}`} permission="create_gate_entry" />
            <RecordActions
              basePath="/gate-entries"
              id={id}
              status={data?.status}
              invalidate={['/gate-entries']}
              actions={[
                { label: 'Close', action: 'close', permission: 'create_gate_entry', from: ['open'], primary: true },
                { label: 'Cancel', action: 'cancel', permission: 'create_gate_entry', from: ['open'], danger: true, needsReason: true },
              ]}
            />
          </Space>
        }
      >
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
          <Descriptions.Item label="Direction">{humanise(data?.direction)}</Descriptions.Item>
          <Descriptions.Item label="Purpose">{humanise(data?.purpose)}</Descriptions.Item>
          <Descriptions.Item label="Arrived">{dateTime(data?.entryAt)}</Descriptions.Item>
          <Descriptions.Item label="Vehicle">{data?.vehicleNumber ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Driver">{data?.driverName ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Reference">{data?.referenceNo ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Left">{data?.exitAt ? dateTime(data.exitAt) : 'Still inside'}</Descriptions.Item>
          <Descriptions.Item label="Remarks" span={2}>
            {data?.remarks ?? '—'}
          </Descriptions.Item>
        </Descriptions>

        {data?.status === 'open' && data.direction === 'in' && (
          <Space style={{ marginTop: 16 }}>
            <Typography.Text type="secondary">Next:</Typography.Text>
            <CreateButton
              label="Record the goods (Inward)"
              onClick={() => navigate(`/inwards?gateEntryId=${id}`)}
            />
          </Space>
        )}
      </Card>

      {/* The vehicle, the seal, the paperwork the driver handed over --
          photographed at the gate, where the only record otherwise is
          what somebody typed. */}
      <Attachments
        ownerType="gate_entry"
        ownerId={id}
        title="Photos at the gate"
        categories={['photo', 'lr', 'eway_bill', 'invoice', 'other']}
        writePermission="create_gate_entry"
        emptyText="No photos yet. The vehicle, its number plate and the seal are the three worth having."
      />
    </Space>
  );
}
