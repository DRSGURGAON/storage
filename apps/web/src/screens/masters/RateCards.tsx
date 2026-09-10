import { useState } from 'react';
import { Alert, Card, Col, DatePicker, Descriptions, Form, Input, InputNumber, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { CreateButton, ListPage } from '../../components/ListPage';
import { FormDrawer, prune } from '../../components/FormDrawer';
import { api } from '../../lib/api';
import { RecordPicker } from '../../components/RecordPicker';
import { useSession } from '../../lib/session';
import { date, humanise, money, statusColor } from '../../lib/format';

interface RateCard {
  id: string;
  code: string;
  name: string;
  scope: string;
  customerId: string | null;
  warehouseId: string | null;
  validFrom: string;
  validTo: string | null;
  status: string;
}

interface RateCardLine {
  id: string;
  chargeTypeId: string;
  chargeTypeCode?: string;
  chargeTypeName?: string;
  basis: string;
  rate: string | number;
  uomCode: string | null;
  freeDays: number | null;
  minimumCharge: string | number | null;
  sacCode: string | null;
  productId: string | null;
}

interface ChargeType {
  id: string;
  code: string;
  name: string;
  defaultBasis: string | null;
}

const BASES = ['per_unit', 'per_weight', 'per_volume', 'per_pallet', 'unit_day', 'weight_day', 'pallet_day', 'flat', 'per_hour', 'percentage'];

export function RateCards() {
  const [creating, setCreating] = useState(false);
  const { can } = useSession();
  const navigate = useNavigate();
  return (
    <>
      <ListPage<RateCard>
        title="Rate cards"
        path="/rate-cards"
        searchPlaceholder="Code or name"
        onRowClick={(row) => navigate(`/rate-cards/${row.id}`)}
        emptyDescription="No rate cards yet. A billing run refuses to invoice stock it cannot price, so this is what makes billing possible."
        actions={can('create_rate_card') && <CreateButton label="New rate card" onClick={() => setCreating(true)} />}
        columns={[
          { title: 'Code', dataIndex: 'code', width: 120 },
          { title: 'Name', dataIndex: 'name', render: (name) => <strong>{name}</strong> },
          {
            title: 'Scope',
            dataIndex: 'scope',
            width: 140,
            render: (scope: string) => <Tag>{humanise(scope)}</Tag>,
          },
          { title: 'From', dataIndex: 'validFrom', width: 130, render: (v) => date(v) },
          { title: 'To', dataIndex: 'validTo', width: 130, render: (v) => date(v) },
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
        title="New rate card"
        path="/rate-cards"
        invalidate={['/rate-cards']}
        onClose={() => setCreating(false)}
        transform={(values) => ({
          ...prune(values),
          validFrom: (values.validFrom as dayjs.Dayjs).format('YYYY-MM-DD'),
          validTo: values.validTo ? (values.validTo as dayjs.Dayjs).format('YYYY-MM-DD') : undefined,
        })}
      >
        {(form) => (
          <>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="code" label="Code" rules={[{ required: true }]}>
                  <Input placeholder="STD" />
                </Form.Item>
              </Col>
              <Col span={16}>
                <Form.Item name="name" label="Name" rules={[{ required: true, min: 2 }]}>
                  <Input placeholder="Standard warehousing" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name="scope"
              label="Scope"
              rules={[{ required: true }]}
              initialValue="company"
              tooltip="Resolution runs customer → warehouse → company, so a customer card beats a company one"
            >
              <Select options={['company', 'warehouse', 'customer'].map((value) => ({ value, label: humanise(value) }))} />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(prev, next) => prev.scope !== next.scope}>
              {() =>
                form.getFieldValue('scope') === 'customer' ? (
                  <Form.Item name="customerId" label="Customer" rules={[{ required: true }]}>
                    <RecordPicker<{ id: string; code: string; name: string }>
                      path="/customers"
                      label={(row) => `${row.code} — ${row.name}`}
                    />
                  </Form.Item>
                ) : form.getFieldValue('scope') === 'warehouse' ? (
                  <Form.Item name="warehouseId" label="Warehouse" rules={[{ required: true }]}>
                    <RecordPicker<{ id: string; code: string; name: string }>
                      path="/warehouses"
                      label={(row) => `${row.code} — ${row.name}`}
                    />
                  </Form.Item>
                ) : null
              }
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="validFrom" label="Valid from" rules={[{ required: true }]} initialValue={dayjs()}>
                  <DatePicker style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="validTo" label="Valid to">
                  <DatePicker style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name="status"
              label="Status"
              initialValue="draft"
              tooltip="Only an active card is used when a billing run resolves a rate"
            >
              <Select options={['draft', 'active'].map((value) => ({ value, label: humanise(value) }))} />
            </Form.Item>
          </>
        )}
      </FormDrawer>
    </>
  );
}

/** The card and its priced lines: what a billing run actually reads. */
export function RateCardDetail() {
  const { id = '' } = useParams();
  const [adding, setAdding] = useState(false);
  const { can } = useSession();

  const card = useQuery({ queryKey: ['/rate-cards', id], queryFn: () => api<RateCard>(`/rate-cards/${id}`) });
  const lines = useQuery({ queryKey: ['/rate-cards', id, 'lines'], queryFn: () => api<RateCardLine[]>(`/rate-cards/${id}/lines`) });
  const chargeTypes = useQuery({ queryKey: ['/charge-types'], queryFn: () => api<ChargeType[]>('/charge-types') });

  const chargeName = (chargeTypeId: string) => {
    const found = chargeTypes.data?.find((c) => c.id === chargeTypeId);
    return found ? `${found.code} — ${found.name}` : chargeTypeId;
  };

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Card loading={card.isLoading} title={<Typography.Title level={4} style={{ margin: 0 }}>{card.data?.name}</Typography.Title>}>
        <Descriptions size="small" column={4}>
          <Descriptions.Item label="Code">{card.data?.code}</Descriptions.Item>
          <Descriptions.Item label="Scope">{humanise(card.data?.scope)}</Descriptions.Item>
          <Descriptions.Item label="Valid">
            {date(card.data?.validFrom)} → {card.data?.validTo ? date(card.data.validTo) : 'open'}
          </Descriptions.Item>
          <Descriptions.Item label="Status">
            <Tag color={statusColor(card.data?.status)}>{humanise(card.data?.status)}</Tag>
          </Descriptions.Item>
        </Descriptions>
        {card.data?.status === 'draft' && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12 }}
            message="This card is a draft"
            description="Rate resolution only reads active cards, so a billing run will not price anything against it yet."
          />
        )}
      </Card>

      <Card
        title="Priced lines"
        extra={can('edit_rate_card') && <CreateButton label="Add line" onClick={() => setAdding(true)} />}
      >
        <Table<RateCardLine>
          size="small"
          rowKey="id"
          loading={lines.isLoading}
          dataSource={lines.data ?? []}
          pagination={false}
          columns={[
            { title: 'Charge', dataIndex: 'chargeTypeId', render: (v: string) => chargeName(v) },
            { title: 'Basis', dataIndex: 'basis', render: (v) => humanise(v) },
            { title: 'Rate', dataIndex: 'rate', align: 'right', render: (v) => money(v) },
            { title: 'Free days', dataIndex: 'freeDays', align: 'right', render: (v) => v ?? '—' },
            { title: 'Minimum', dataIndex: 'minimumCharge', align: 'right', render: (v) => (v == null ? '—' : money(v)) },
            { title: 'SAC', dataIndex: 'sacCode', render: (v) => v ?? '—' },
          ]}
        />
      </Card>

      <FormDrawer
        open={adding}
        title="Add a priced line"
        path={`/rate-cards/${id}/lines`}
        invalidate={['/rate-cards']}
        onClose={() => setAdding(false)}
      >
        {() => (
          <>
            <Form.Item name="chargeTypeId" label="Charge type" rules={[{ required: true }]}>
              <Select
                showSearch
                optionFilterProp="label"
                loading={chargeTypes.isLoading}
                options={(chargeTypes.data ?? []).map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))}
              />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item
                  name="basis"
                  label="Basis"
                  rules={[{ required: true }]}
                  tooltip="A per-day basis accrues; everything else is charged once, on the event"
                >
                  <Select options={BASES.map((value) => ({ value, label: humanise(value) }))} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="rate" label="Rate" rules={[{ required: true }]}>
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="freeDays" label="Free days" tooltip="Counted from the first inward of each key">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="minimumCharge" label="Minimum">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="sacCode" label="SAC code">
                  <Input placeholder="996729" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="description" label="Description">
              <Input />
            </Form.Item>
          </>
        )}
      </FormDrawer>
    </Space>
  );
}
