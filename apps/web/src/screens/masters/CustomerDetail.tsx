import { useState } from 'react';
import { Card, Descriptions, Form, Input, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { CreateButton } from '../../components/ListPage';
import { FormDrawer } from '../../components/FormDrawer';
import { Attachments } from '../../components/Attachments';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { humanise } from '../../lib/format';
import { CustomerFields, type Customer } from './Customers';

interface Address {
  id: string;
  kind: string;
  line1: string;
  line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  isDefault: boolean;
}

interface Contact {
  id: string;
  name: string;
  designation: string | null;
  mobile: string | null;
  email: string | null;
  isPrimary: boolean;
}

/**
 * One customer: the master record, its addresses and its contacts.
 *
 * The addresses matter more than they look. A release order snapshots the
 * delivery address at creation, and an invoice snapshots the billing one --
 * so what is recorded here is what gets frozen onto paperwork later, and
 * editing it afterwards changes nothing already issued.
 */
export function CustomerDetail() {
  const { id = '' } = useParams();
  const [editing, setEditing] = useState(false);
  const [addingAddress, setAddingAddress] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const { can } = useSession();

  const customer = useQuery({ queryKey: ['/customers', id], queryFn: () => api<Customer>(`/customers/${id}`) });
  const addresses = useQuery({ queryKey: ['/customers', id, 'addresses'], queryFn: () => api<Address[]>(`/customers/${id}/addresses`) });
  const contacts = useQuery({ queryKey: ['/customers', id, 'contacts'], queryFn: () => api<Contact[]>(`/customers/${id}/contacts`) });

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Card
        loading={customer.isLoading}
        title={
          <Space>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {customer.data?.legalName ?? customer.data?.name}
            </Typography.Title>
            <Tag>{customer.data?.code}</Tag>
          </Space>
        }
        extra={can('edit_customer') && <CreateButton label="Edit" onClick={() => setEditing(true)} />}
      >
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
          <Descriptions.Item label="GSTIN">{customer.data?.gstin ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Place of supply">{customer.data?.placeOfSupply ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Credit days">{customer.data?.creditDays ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Mobile">{customer.data?.mobile ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="KYC">{humanise(customer.data?.kycStatus)}</Descriptions.Item>
          <Descriptions.Item label="Active">{customer.data?.isActive ? 'Yes' : 'No'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card
        title="Addresses"
        extra={can('edit_customer') && <CreateButton label="Add address" onClick={() => setAddingAddress(true)} />}
      >
        <Table<Address>
          scroll={{ x: 'max-content' }}
          size="small"
          rowKey="id"
          loading={addresses.isLoading}
          pagination={false}
          dataSource={addresses.data ?? []}
          locale={{ emptyText: 'No addresses recorded. An invoice needs a billing address to print.' }}
          columns={[
            { title: 'Kind', dataIndex: 'kind', width: 130, render: (v) => <Tag>{humanise(v)}</Tag> },
            {
              title: 'Address',
              render: (_, row) => [row.line1, row.line2, row.city, row.state, row.pincode].filter(Boolean).join(', '),
            },
            {
              title: '',
              dataIndex: 'isDefault',
              width: 100,
              render: (isDefault: boolean) => (isDefault ? <Tag color="blue">default</Tag> : null),
            },
          ]}
        />
      </Card>

      <Card
        title="Contacts"
        extra={can('edit_customer') && <CreateButton label="Add contact" onClick={() => setAddingContact(true)} />}
      >
        <Table<Contact>
          scroll={{ x: 'max-content' }}
          size="small"
          rowKey="id"
          loading={contacts.isLoading}
          pagination={false}
          dataSource={contacts.data ?? []}
          locale={{ emptyText: 'No contacts recorded.' }}
          columns={[
            { title: 'Name', dataIndex: 'name', render: (name) => <strong>{name}</strong> },
            { title: 'Designation', dataIndex: 'designation', render: (v) => v ?? '—' },
            { title: 'Mobile', dataIndex: 'mobile', render: (v) => v ?? '—' },
            { title: 'Email', dataIndex: 'email', render: (v) => v ?? '—' },
            {
              title: '',
              dataIndex: 'isPrimary',
              width: 100,
              render: (isPrimary: boolean) => (isPrimary ? <Tag color="blue">primary</Tag> : null),
            },
          ]}
        />
      </Card>

      <FormDrawer
        open={editing}
        title="Edit customer"
        path={`/customers/${id}`}
        method="PATCH"
        initialValues={customer.data as unknown as Record<string, unknown>}
        invalidate={['/customers']}
        onClose={() => setEditing(false)}
      >
        {() => <CustomerFields />}
      </FormDrawer>

      <FormDrawer
        open={addingAddress}
        title="Add an address"
        path={`/customers/${id}/addresses`}
        invalidate={['/customers']}
        onClose={() => setAddingAddress(false)}
      >
        {() => (
          <>
            <Form.Item name="kind" label="Kind" rules={[{ required: true }]} initialValue="billing">
              <Select options={['billing', 'shipping', 'registered'].map((value) => ({ value, label: humanise(value) }))} />
            </Form.Item>
            <Form.Item name="line1" label="Address line 1" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="line2" label="Address line 2">
              <Input />
            </Form.Item>
            <Form.Item name="city" label="City">
              <Input />
            </Form.Item>
            <Form.Item name="state" label="State">
              <Input />
            </Form.Item>
            <Form.Item name="pincode" label="Pincode">
              <Input />
            </Form.Item>
            <Form.Item
              name="isDefault"
              label="Default for this kind"
              valuePropName="checked"
              tooltip="Only one address per kind can be the default; setting this moves it"
            >
              <Switch />
            </Form.Item>
          </>
        )}
      </FormDrawer>

      {/* Blueprint §9's KYC pack: the GST certificate, PAN and signed
          agreement that make a customer real, kept on the customer rather
          than in somebody's mailbox. */}
      <Attachments
        ownerType="customer"
        ownerId={id}
        title="KYC and paperwork"
        categories={['gst_certificate', 'pan', 'kyc', 'agreement', 'other']}
        writePermission="edit_customer"
        emptyText="No documents yet. GST certificate, PAN and the signed agreement live here."
      />

      <FormDrawer
        open={addingContact}
        title="Add a contact"
        path={`/customers/${id}/contacts`}
        invalidate={['/customers']}
        onClose={() => setAddingContact(false)}
      >
        {() => (
          <>
            <Form.Item name="name" label="Name" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="designation" label="Designation">
              <Input />
            </Form.Item>
            <Form.Item name="mobile" label="Mobile">
              <Input />
            </Form.Item>
            <Form.Item name="email" label="Email" rules={[{ type: 'email' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="isPrimary" label="Primary contact" valuePropName="checked">
              <Switch />
            </Form.Item>
          </>
        )}
      </FormDrawer>
    </Space>
  );
}
