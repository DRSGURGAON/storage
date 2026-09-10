import { useState } from 'react';
import { Col, Form, Input, InputNumber, Row, Select, Switch, Tag, Tooltip } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { CreateButton, ListPage } from '../../components/ListPage';
import { FormDrawer } from '../../components/FormDrawer';
import { api } from '../../lib/api';
import { RecordPicker } from '../../components/RecordPicker';
import { useSession } from '../../lib/session';
import { quantity } from '../../lib/format';

interface Product {
  id: string;
  sku: string;
  name: string;
  uomCode: string;
  hsnCode: string | null;
  weightKg: string | null;
  batchTracked: boolean;
  serialTracked: boolean;
  expiryTracked: boolean;
  customerId: string | null;
  isActive: boolean;
}

interface Uom {
  code: string;
  name: string;
}

export function Products() {
  const [creating, setCreating] = useState(false);
  const { can } = useSession();
  const uoms = useQuery({ queryKey: ['/uoms'], queryFn: () => api<Uom[]>('/uoms') });

  return (
    <>
      <ListPage<Product>
        title="Products"
        path="/products"
        searchPlaceholder="SKU, name or barcode"
        emptyDescription="No products yet. A GRN line needs one, so this is usually the second master you fill in."
        actions={can('create_product') && <CreateButton label="New product" onClick={() => setCreating(true)} />}
        columns={[
          { title: 'SKU', dataIndex: 'sku', width: 150, render: (sku) => <span style={{ fontFamily: 'monospace' }}>{sku}</span> },
          { title: 'Name', dataIndex: 'name', render: (name) => <strong>{name}</strong> },
          { title: 'UOM', dataIndex: 'uomCode', width: 80 },
          { title: 'HSN', dataIndex: 'hsnCode', width: 110, render: (v) => v ?? '—' },
          { title: 'Weight', dataIndex: 'weightKg', width: 110, render: (v) => (v ? `${quantity(v)} kg` : '—') },
          {
            title: 'Tracking',
            width: 200,
            render: (_, row) => (
              <>
                {row.batchTracked && (
                  <Tooltip title="Each receipt resolves to a batch, and balances are kept per batch">
                    <Tag color="blue">batch</Tag>
                  </Tooltip>
                )}
                {row.serialTracked && (
                  <Tooltip title="One stock lot per unit; every accepted unit needs its serial recorded">
                    <Tag color="purple">serial</Tag>
                  </Tooltip>
                )}
                {row.expiryTracked && <Tag color="orange">expiry</Tag>}
                {!row.batchTracked && !row.serialTracked && !row.expiryTracked && '—'}
              </>
            ),
          },
          {
            title: 'Scope',
            dataIndex: 'customerId',
            width: 130,
            render: (customerId: string | null) =>
              customerId ? <Tag>customer-owned</Tag> : <Tag color="default">shared</Tag>,
          },
          { title: '', dataIndex: 'isActive', width: 90, render: (active: boolean) => (active ? null : <Tag>Inactive</Tag>) },
        ]}
      />
      <FormDrawer open={creating} title="New product" path="/products" invalidate={['/products']} onClose={() => setCreating(false)}>
        {() => (
          <>
            <Row gutter={12}>
              <Col span={10}>
                <Form.Item name="sku" label="SKU" rules={[{ required: true }]}>
                  <Input placeholder="RICE-25" />
                </Form.Item>
              </Col>
              <Col span={14}>
                <Form.Item name="name" label="Name" rules={[{ required: true, min: 2 }]}>
                  <Input placeholder="Basmati Rice 25kg" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="uomCode" label="Unit" rules={[{ required: true }]}>
                  <Select
                    showSearch
                    optionFilterProp="label"
                    loading={uoms.isLoading}
                    options={(uoms.data ?? []).map((uom) => ({ value: uom.code, label: `${uom.code} — ${uom.name}` }))}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="hsnCode" label="HSN">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="barcode" label="Barcode">
                  <Input />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={6}>
                <Form.Item name="weightKg" label="Weight (kg)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="lengthCm" label="L (cm)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="widthCm" label="W (cm)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="heightCm" label="H (cm)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name="customerId"
              label="Owned by"
              tooltip="Leave blank for a SKU any customer can store. A customer-owned SKU is only ever theirs."
            >
              <RecordPicker<{ id: string; code: string; name: string }>
                path="/customers"
                label={(row) => `${row.code} — ${row.name}`}
                placeholder="Shared across customers"
              />
            </Form.Item>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item
                  name="batchTracked"
                  label="Batch tracked"
                  valuePropName="checked"
                  tooltip="Balances are kept per batch, and two batches in one bin never merge"
                >
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name="serialTracked"
                  label="Serial tracked"
                  valuePropName="checked"
                  tooltip="One lot per unit. Every accepted unit needs its serial number recorded at GRN."
                >
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="expiryTracked" label="Expiry tracked" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
            </Row>
          </>
        )}
      </FormDrawer>
    </>
  );
}
