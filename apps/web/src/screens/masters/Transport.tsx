import { useState } from 'react';
import { Card, Col, Form, Input, InputNumber, Row, Tabs, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { CreateButton, ListPage } from '../../components/ListPage';
import { FormDrawer } from '../../components/FormDrawer';
import { api, type Page } from '../../lib/api';
import { RecordPicker } from '../../components/RecordPicker';
import { useSession } from '../../lib/session';
import { date } from '../../lib/format';

interface Transporter {
  id: string;
  name: string;
  gstin: string | null;
  contactName: string | null;
  contactPhone: string | null;
  isActive: boolean;
}

interface Vehicle {
  id: string;
  vehicleNumber: string;
  vehicleType: string | null;
  capacityValue: string | null;
  capacityUom: string | null;
  transporterId: string | null;
  transporterName?: string | null;
  isActive: boolean;
}

interface Driver {
  id: string;
  name: string;
  mobile: string | null;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  transporterId: string | null;
  isActive: boolean;
}

/**
 * Transporters, vehicles and drivers on one screen with three tabs. They
 * are one thing in practice -- you add a transporter because a lorry
 * turned up, and the gate entry that needs the vehicle needs the driver
 * too -- and splitting them across three nav items would mean three
 * navigations to record one arrival.
 */
export function Transport() {
  const [creating, setCreating] = useState<'transporter' | 'vehicle' | 'driver' | null>(null);
  const { can } = useSession();
  // Loaded once for the *labels* in the tables below (a row carries only a
  // transporter id). The pickers search server-side instead.
  const transporters = useQuery({
    queryKey: ['/transporters', 'labels'],
    queryFn: () => api<Page<Transporter>>('/transporters?limit=100'),
  });
  const transporterOptions = (transporters.data?.items ?? []).map((t) => ({ value: t.id, label: t.name }));
  const mayEdit = can('create_transport_master');

  return (
    <Card styles={{ body: { paddingTop: 0 } }}>
      <Tabs
        items={[
          {
            key: 'transporters',
            label: 'Transporters',
            children: (
              <ListPage<Transporter>
                title="Transporters"
                path="/transporters"
                searchPlaceholder="Name"
                emptyDescription="No transporters yet. A vehicle can exist without one — that is an owned fleet."
                actions={mayEdit && <CreateButton label="New transporter" onClick={() => setCreating('transporter')} />}
                columns={[
                  { title: 'Name', dataIndex: 'name', render: (name) => <strong>{name}</strong> },
                  { title: 'GSTIN', dataIndex: 'gstin', render: (v) => v ?? '—' },
                  { title: 'Contact', dataIndex: 'contactName', render: (v) => v ?? '—' },
                  { title: 'Phone', dataIndex: 'contactPhone', render: (v) => v ?? '—' },
                  { title: '', dataIndex: 'isActive', width: 90, render: (a: boolean) => (a ? null : <Tag>Inactive</Tag>) },
                ]}
              />
            ),
          },
          {
            key: 'vehicles',
            label: 'Vehicles',
            children: (
              <ListPage<Vehicle>
                title="Vehicles"
                path="/vehicles"
                searchPlaceholder="Registration number"
                emptyDescription="No vehicles yet. Selecting one on a gate entry fills in its transporter automatically."
                actions={mayEdit && <CreateButton label="New vehicle" onClick={() => setCreating('vehicle')} />}
                columns={[
                  {
                    title: 'Number',
                    dataIndex: 'vehicleNumber',
                    render: (v) => <span style={{ fontFamily: 'monospace' }}>{v}</span>,
                  },
                  { title: 'Type', dataIndex: 'vehicleType', render: (v) => v ?? '—' },
                  {
                    title: 'Capacity',
                    render: (_, row) => (row.capacityValue ? `${row.capacityValue} ${row.capacityUom ?? ''}` : '—'),
                  },
                  {
                    title: 'Transporter',
                    dataIndex: 'transporterId',
                    render: (id: string | null) =>
                      id ? (transporterOptions.find((t) => t.value === id)?.label ?? '—') : <Tag>own fleet</Tag>,
                  },
                  { title: '', dataIndex: 'isActive', width: 90, render: (a: boolean) => (a ? null : <Tag>Inactive</Tag>) },
                ]}
              />
            ),
          },
          {
            key: 'drivers',
            label: 'Drivers',
            children: (
              <ListPage<Driver>
                title="Drivers"
                path="/drivers"
                searchPlaceholder="Name or mobile"
                emptyDescription="No drivers yet."
                actions={mayEdit && <CreateButton label="New driver" onClick={() => setCreating('driver')} />}
                columns={[
                  { title: 'Name', dataIndex: 'name', render: (name) => <strong>{name}</strong> },
                  { title: 'Mobile', dataIndex: 'mobile', render: (v) => v ?? '—' },
                  { title: 'Licence', dataIndex: 'licenseNumber', render: (v) => v ?? '—' },
                  { title: 'Expires', dataIndex: 'licenseExpiry', render: (v) => date(v) },
                  {
                    title: 'Transporter',
                    dataIndex: 'transporterId',
                    render: (id: string | null) => (id ? (transporterOptions.find((t) => t.value === id)?.label ?? '—') : '—'),
                  },
                  { title: '', dataIndex: 'isActive', width: 90, render: (a: boolean) => (a ? null : <Tag>Inactive</Tag>) },
                ]}
              />
            ),
          },
        ]}
      />

      <FormDrawer
        open={creating === 'transporter'}
        title="New transporter"
        path="/transporters"
        invalidate={['/transporters']}
        onClose={() => setCreating(null)}
      >
        {() => (
          <>
            <Form.Item name="name" label="Name" rules={[{ required: true, min: 2 }]}>
              <Input />
            </Form.Item>
            <Form.Item name="gstin" label="GSTIN">
              <Input />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="contactName" label="Contact">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="contactPhone" label="Phone">
                  <Input />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="email" label="Email" rules={[{ type: 'email' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="address" label="Address">
              <Input.TextArea rows={2} />
            </Form.Item>
          </>
        )}
      </FormDrawer>

      <FormDrawer
        open={creating === 'vehicle'}
        title="New vehicle"
        path="/vehicles"
        invalidate={['/vehicles']}
        onClose={() => setCreating(null)}
      >
        {() => (
          <>
            <Form.Item
              name="vehicleNumber"
              label="Registration number"
              rules={[{ required: true }]}
              tooltip="Stored normalised — spaces and case are ignored when checking for duplicates"
            >
              <Input placeholder="HR 26 DK 1234" />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="vehicleType" label="Type">
                  <Input placeholder="32 ft container" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="capacityValue" label="Capacity">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="capacityUom" label="Unit">
                  <Input placeholder="MT" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="transporterId" label="Transporter" tooltip="Leave blank for an owned vehicle">
              <RecordPicker<Transporter> path="/transporters" label={(row) => row.name} placeholder="Own fleet" />
            </Form.Item>
          </>
        )}
      </FormDrawer>

      <FormDrawer
        open={creating === 'driver'}
        title="New driver"
        path="/drivers"
        invalidate={['/drivers']}
        onClose={() => setCreating(null)}
      >
        {() => (
          <>
            <Form.Item name="name" label="Name" rules={[{ required: true, min: 2 }]}>
              <Input />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="mobile" label="Mobile">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="licenseNumber" label="Licence number">
                  <Input />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="transporterId" label="Transporter">
              <RecordPicker<Transporter> path="/transporters" label={(row) => row.name} />
            </Form.Item>
          </>
        )}
      </FormDrawer>
    </Card>
  );
}
