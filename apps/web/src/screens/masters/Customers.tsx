import { useState } from 'react';
import { Col, Form, Input, InputNumber, Row, Select, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { CreateButton, ListPage } from '../../components/ListPage';
import { FormDrawer } from '../../components/FormDrawer';
import { useSession } from '../../lib/session';
import { humanise } from '../../lib/format';

export interface Customer {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  gstin: string | null;
  mobile: string | null;
  placeOfSupply: string | null;
  creditDays: number | null;
  kycStatus: string | null;
  isActive: boolean;
}

/** GST state codes, as they appear on a GSTIN's first two digits. */
export const STATE_CODES: { value: string; label: string }[] = [
  ['01', 'Jammu & Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'],
  ['05', 'Uttarakhand'], ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'],
  ['10', 'Bihar'], ['11', 'Sikkim'], ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'],
  ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'],
  ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'], ['24', 'Gujarat'],
  ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'], ['32', 'Kerala'], ['33', 'Tamil Nadu'],
  ['34', 'Puducherry'], ['36', 'Telangana'], ['37', 'Andhra Pradesh'],
].map(([value, label]) => ({ value, label: `${value} — ${label}` }));

export function Customers() {
  const [creating, setCreating] = useState(false);
  const { can } = useSession();
  const navigate = useNavigate();

  return (
    <>
      <ListPage<Customer>
        title="Customers"
        path="/customers"
        searchPlaceholder="Name, code, GSTIN or mobile"
        onRowClick={(row) => navigate(`/customers/${row.id}`)}
        emptyDescription="No customers yet. Add the first one to start receiving goods against it."
        actions={can('create_customer') && <CreateButton label="New customer" onClick={() => setCreating(true)} />}
        columns={[
          { title: 'Code', dataIndex: 'code', width: 110 },
          { title: 'Name', dataIndex: 'name', render: (name, row) => <strong>{row.legalName ?? name}</strong> },
          { title: 'GSTIN', dataIndex: 'gstin', render: (v) => v ?? '—' },
          { title: 'Mobile', dataIndex: 'mobile', render: (v) => v ?? '—' },
          { title: 'Place of supply', dataIndex: 'placeOfSupply', width: 130, render: (v) => v ?? '—' },
          { title: 'Credit', dataIndex: 'creditDays', width: 90, render: (v) => (v == null ? '—' : `${v} days`) },
          {
            title: 'KYC',
            dataIndex: 'kycStatus',
            width: 110,
            render: (v) => <Tag color={v === 'verified' ? 'success' : 'default'}>{humanise(v)}</Tag>,
          },
          {
            title: '',
            dataIndex: 'isActive',
            width: 90,
            render: (active: boolean) => (active ? null : <Tag>Inactive</Tag>),
          },
        ]}
      />
      <FormDrawer
        open={creating}
        title="New customer"
        path="/customers"
        invalidate={['/customers']}
        onClose={() => setCreating(false)}
      >
        {() => <CustomerFields />}
      </FormDrawer>
    </>
  );
}

/**
 * Shared by the create drawer and the edit drawer on the detail page. The
 * validation here mirrors the API's own (`create-customer.dto.ts`) so a
 * malformed GSTIN is caught before a round trip -- but the API validates
 * again regardless, and its message is what the user sees if the two ever
 * disagree.
 */
export function CustomerFields() {
  return (
    <>
      <Form.Item name="name" label="Name" rules={[{ required: true, min: 2 }]}>
        <Input placeholder="Acme Consumer Goods" />
      </Form.Item>
      <Form.Item name="legalName" label="Legal name" tooltip="Printed on invoices and warehouse receipts">
        <Input placeholder="Acme Consumer Goods Pvt Ltd" />
      </Form.Item>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name="customerType" label="Type">
            <Select
              allowClear
              options={['company', 'proprietor', 'partnership', 'individual', 'government'].map((value) => ({
                value,
                label: humanise(value),
              }))}
            />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="billingCycle" label="Billing cycle">
            <Select
              allowClear
              options={['monthly', 'fortnightly', 'weekly', 'on_dispatch'].map((value) => ({
                value,
                label: humanise(value),
              }))}
            />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name="contactPerson" label="Contact person">
            <Input />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="mobile" label="Mobile">
            <Input />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name="email" label="Email" rules={[{ type: 'email' }]}>
        <Input />
      </Form.Item>
      <Row gutter={12}>
        <Col span={14}>
          <Form.Item
            name="gstin"
            label="GSTIN"
            rules={[{ pattern: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, message: '15-character GSTIN' }]}
          >
            <Input placeholder="06AABCU9603R1ZM" />
          </Form.Item>
        </Col>
        <Col span={10}>
          <Form.Item name="pan" label="PAN" rules={[{ pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/, message: '10-character PAN' }]}>
            <Input placeholder="AABCU9603R" />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item
            name="placeOfSupply"
            label="Place of supply"
            tooltip="Decides CGST+SGST versus IGST on every invoice, and is frozen onto the invoice when it is raised"
          >
            <Select allowClear showSearch optionFilterProp="label" options={STATE_CODES} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="creditDays" label="Credit days">
            <InputNumber min={0} max={365} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name="paymentTerms" label="Payment terms">
        <Input placeholder="Net 15 from invoice date" />
      </Form.Item>
      <Form.Item name="notes" label="Notes">
        <Input.TextArea rows={3} />
      </Form.Item>
    </>
  );
}
