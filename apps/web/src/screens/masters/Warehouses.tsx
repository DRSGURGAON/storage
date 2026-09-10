import { useState } from 'react';
import { Alert, Card, Col, Form, Input, InputNumber, Row, Select, Space, Tag, Tree, Typography } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { CreateButton, ListPage } from '../../components/ListPage';
import { FormDrawer } from '../../components/FormDrawer';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { STATE_CODES } from './Customers';

interface Warehouse {
  id: string;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  managerName: string | null;
  isActive: boolean;
}

interface Location {
  id: string;
  level: string;
  segment: string;
  fullCode: string;
  name: string | null;
  parentId: string | null;
  isPickable: boolean;
}

export function Warehouses() {
  const [creating, setCreating] = useState(false);
  const { can } = useSession();
  const navigate = useNavigate();

  return (
    <>
      <ListPage<Warehouse>
        title="Warehouses"
        path="/warehouses"
        searchPlaceholder="Code or name"
        onRowClick={(row) => navigate(`/warehouses/${row.id}`)}
        emptyDescription="No warehouses yet. A warehouse needs at least one bin before stock can be shelved in it."
        actions={can('create_warehouse') && <CreateButton label="New warehouse" onClick={() => setCreating(true)} />}
        columns={[
          { title: 'Code', dataIndex: 'code', width: 120 },
          { title: 'Name', dataIndex: 'name', render: (name) => <strong>{name}</strong> },
          { title: 'City', dataIndex: 'city', render: (v) => v ?? '—' },
          { title: 'State', dataIndex: 'state', render: (v) => v ?? '—' },
          { title: 'Manager', dataIndex: 'managerName', render: (v) => v ?? '—' },
          { title: '', dataIndex: 'isActive', width: 90, render: (active: boolean) => (active ? null : <Tag>Inactive</Tag>) },
        ]}
      />
      <FormDrawer open={creating} title="New warehouse" path="/warehouses" invalidate={['/warehouses']} onClose={() => setCreating(false)}>
        {() => (
          <>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="code" label="Code" rules={[{ required: true }]}>
                  <Input placeholder="WH01" />
                </Form.Item>
              </Col>
              <Col span={16}>
                <Form.Item name="name" label="Name" rules={[{ required: true, min: 2 }]}>
                  <Input placeholder="Gurugram Central" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="addressLine1" label="Address">
              <Input />
            </Form.Item>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="city" label="City">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="state" label="State">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="stateCode" label="State code">
                  <Select allowClear showSearch optionFilterProp="label" options={STATE_CODES} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="managerName" label="Manager">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="contactPhone" label="Phone">
                  <Input />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="areaSqft" label="Area (sq ft)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="workingHours" label="Working hours">
                  <Input placeholder="09:00–18:00, Mon–Sat" />
                </Form.Item>
              </Col>
            </Row>
          </>
        )}
      </FormDrawer>
    </>
  );
}

/**
 * The location hierarchy, as a tree rather than a flat list.
 *
 * `warehouses.md`'s structure is Zone → Rack → Row → Level → Bin, and the
 * API stores each node's `full_code` materialised. Showing it flat would
 * make a 400-bin warehouse unreadable and hide the one thing that matters
 * when you are creating a bin: what it is going under.
 */
export function WarehouseDetail() {
  const { id = '' } = useParams();
  const [creating, setCreating] = useState<{ parentId?: string; level: string } | null>(null);
  const { can } = useSession();

  const warehouse = useQuery({ queryKey: ['/warehouses', id], queryFn: () => api<Warehouse>(`/warehouses/${id}`) });
  // A bare array, not a page: the location list is a whole tree and is
  // never paginated -- a warehouse's hierarchy is read all at once or not
  // at all.
  const locations = useQuery({
    queryKey: ['/warehouses', id, 'locations'],
    queryFn: () => api<Location[]>(`/warehouses/${id}/locations`),
  });

  const nodes = locations.data ?? [];
  const children = (parentId: string | null): DataNode[] =>
    nodes
      .filter((node) => node.parentId === parentId)
      .map((node) => ({
        key: node.id,
        title: (
          <Space size={6}>
            <span style={{ fontFamily: 'monospace' }}>{node.fullCode}</span>
            <Typography.Text type="secondary">{node.name ?? node.level}</Typography.Text>
            {node.isPickable && <Tag color="blue">pickable</Tag>}
          </Space>
        ),
        children: children(node.id),
      }));

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Card
        loading={warehouse.isLoading}
        title={
          <Space>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {warehouse.data?.name}
            </Typography.Title>
            <Tag>{warehouse.data?.code}</Tag>
          </Space>
        }
      >
        <Typography.Text type="secondary">
          {[warehouse.data?.city, warehouse.data?.state].filter(Boolean).join(', ') || 'No address recorded'}
        </Typography.Text>
      </Card>

      <Card
        title="Locations"
        extra={can('edit_warehouse') && <CreateButton label="New location" onClick={() => setCreating({ level: 'zone' })} />}
      >
        {nodes.length === 0 ? (
          <Alert
            type="info"
            showIcon
            message="No locations yet"
            description="Stock received here will sit unallocated until there is a bin to put it away into. Start with a zone, then a rack, then a bin."
          />
        ) : (
          <Tree treeData={children(null)} defaultExpandAll selectable={false} />
        )}
      </Card>

      <FormDrawer
        open={creating !== null}
        title="New location"
        path={`/warehouses/${id}/locations`}
        invalidate={['/warehouses']}
        initialValues={{ level: creating?.level }}
        onClose={() => setCreating(null)}
      >
        {() => (
          <>
            <Form.Item name="level" label="Level" rules={[{ required: true }]}>
              <Select
                options={['zone', 'rack', 'row', 'level', 'bin'].map((value) => ({ value, label: value }))}
              />
            </Form.Item>
            <Form.Item
              name="parentId"
              label="Inside"
              tooltip="A zone sits at the top; everything else needs a parent one level up"
            >
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                options={nodes.map((node) => ({ value: node.id, label: `${node.fullCode} (${node.level})` }))}
              />
            </Form.Item>
            <Form.Item name="segment" label="Segment" rules={[{ required: true }]} tooltip="The part of the code this node contributes, e.g. A or R01 or B03">
              <Input placeholder="B01" />
            </Form.Item>
            <Form.Item name="name" label="Name">
              <Input placeholder="Optional, e.g. Cold room" />
            </Form.Item>
          </>
        )}
      </FormDrawer>
    </Space>
  );
}
