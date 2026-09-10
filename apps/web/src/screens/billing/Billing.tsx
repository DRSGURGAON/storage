import { useState } from 'react';
import {
  Alert,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Divider,
  Form,
  Input,
  InputNumber,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { CreateButton, ListPage } from '../../components/ListPage';
import { FormDrawer, prune } from '../../components/FormDrawer';
import { RecordPicker } from '../../components/RecordPicker';
import { RecordActions } from '../../components/RecordActions';
import { DocumentActions } from '../../components/DocumentActions';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { date, humanise, money, quantity, statusColor } from '../../lib/format';

interface BillingRunLine {
  id: string;
  chargeTypeCode: string;
  description: string;
  basis: string;
  quantity: number | null;
  rate: number;
  amount: number;
}

interface BillingRun {
  id: string;
  customerId: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  subtotal: number;
  invoiceId: string | null;
  invoiceNumber: string | null;
  hasErrors: boolean;
  calculation: {
    errors: string[];
    unpriced: string[];
    alreadyBilled: string[];
    storage?: { chargeTypeCode: string; sku: string; days: number; amount: number }[];
  };
  lines?: BillingRunLine[];
}

interface Invoice {
  id: string;
  number: string;
  invoiceDate: string;
  dueDate: string | null;
  status: string;
  taxTreatment: string;
  subtotal: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  roundOff: number;
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;
  customerSnapshot: { legal_name?: string; gstin?: string } | null;
  lines?: { id: string; description: string; quantity: number | null; rate: number; amount: number; sacCode: string | null }[];
}

export function BillingRuns() {
  const [creating, setCreating] = useState(false);
  const { can } = useSession();
  const navigate = useNavigate();

  return (
    <>
      <ListPage<BillingRun>
        title="Billing runs"
        path="/billing-runs"
        searchPlaceholder="Customer"
        rowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/billing-runs/${row.id}`)}
        emptyDescription="No billing runs yet. A run is a preview — it computes what a period would be invoiced, and changes nothing until an invoice is raised from it."
        actions={can('generate_billing_run') && <CreateButton label="New billing run" onClick={() => setCreating(true)} />}
        columns={[
          { title: 'Period', render: (_, row) => `${date(row.periodStart)} → ${date(row.periodEnd)}`, width: 250 },
          { title: 'Subtotal', dataIndex: 'subtotal', align: 'right', width: 150, render: (v) => money(v) },
          {
            title: 'Invoice',
            dataIndex: 'invoiceNumber',
            render: (number: string | null) => number ?? <Typography.Text type="secondary">not invoiced</Typography.Text>,
          },
          {
            title: '',
            dataIndex: 'hasErrors',
            width: 130,
            render: (hasErrors: boolean) => (hasErrors ? <Tag color="error">unpriced stock</Tag> : null),
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
        title="New billing run"
        path="/billing-runs"
        invalidate={['/billing-runs']}
        onClose={() => setCreating(false)}
        onSaved={(saved: BillingRun) => navigate(`/billing-runs/${saved.id}`)}
        transform={(values) => ({
          ...prune(values),
          periodStart: (values.periodStart as dayjs.Dayjs).format('YYYY-MM-DD'),
          periodEnd: (values.periodEnd as dayjs.Dayjs).format('YYYY-MM-DD'),
        })}
      >
        {() => (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="A run computes, it does not commit"
              description="Storage is rebuilt day by day from the ledger and handling is taken from the operational events that completed in the period. Re-running replaces the previous preview rather than stacking a second one."
            />
            <Form.Item name="customerId" label="Customer" rules={[{ required: true }]}>
              <RecordPicker<{ id: string; code: string; name: string }>
                path="/customers"
                label={(row) => `${row.code} — ${row.name}`}
              />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item
                  name="periodStart"
                  label="From"
                  rules={[{ required: true }]}
                  initialValue={dayjs().startOf('month')}
                >
                  <DatePicker style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="periodEnd" label="To" rules={[{ required: true }]} initialValue={dayjs()}>
                  <DatePicker style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          </>
        )}
      </FormDrawer>
    </>
  );
}

export function BillingRunDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useSession();
  const [invoicing, setInvoicing] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['/billing-runs', id], queryFn: () => api<BillingRun>(`/billing-runs/${id}`) });

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Card
        loading={isLoading}
        title={
          <Space>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {date(data?.periodStart)} → {date(data?.periodEnd)}
            </Typography.Title>
            <Tag color={statusColor(data?.status)}>{humanise(data?.status)}</Tag>
          </Space>
        }
        extra={
          data?.invoiceId ? (
            <CreateButton label="Open the invoice" onClick={() => navigate(`/invoices/${data.invoiceId}`)} />
          ) : (
            can('create_invoice') && (
              <CreateButton
                label="Create the invoice"
                onClick={() => setInvoicing(true)}
                disabled={data?.hasErrors}
              />
            )
          )
        }
      >
        <Statistic title="Subtotal before tax" value={money(data?.subtotal)} />

        {data?.hasErrors && (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 16 }}
            message="This run cannot be invoiced yet"
            description={
              <>
                <p style={{ marginTop: 0 }}>
                  Stock sat in store with no rate to bill it at. Price it on a rate card and run this again — invoicing
                  around it would quietly undercharge the customer.
                </p>
                <ul style={{ marginBottom: 0 }}>
                  {data.calculation.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </>
            }
          />
        )}
        {(data?.calculation.unpriced?.length ?? 0) > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 16 }}
            message="Some events have no price anywhere"
            description={
              <ul style={{ marginBottom: 0 }}>
                {data!.calculation.unpriced.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            }
          />
        )}
        {(data?.calculation.alreadyBilled?.length ?? 0) > 0 && (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 16 }}
            message="Left out — already on an issued invoice"
            description={
              <ul style={{ marginBottom: 0 }}>
                {data!.calculation.alreadyBilled.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            }
          />
        )}
      </Card>

      <Card title="What would be charged">
        <Table<BillingRunLine>
          scroll={{ x: 'max-content' }}
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={data?.lines ?? []}
          columns={[
            { title: 'Charge', dataIndex: 'chargeTypeCode', width: 180, render: (v) => <Tag>{v}</Tag> },
            { title: 'Description', dataIndex: 'description' },
            { title: 'Basis', dataIndex: 'basis', width: 130, render: (v) => humanise(v) },
            { title: 'Quantity', dataIndex: 'quantity', align: 'right', width: 120, render: (v) => quantity(v) },
            { title: 'Rate', dataIndex: 'rate', align: 'right', width: 110, render: (v) => money(v) },
            {
              title: 'Amount',
              dataIndex: 'amount',
              align: 'right',
              width: 140,
              render: (v) => <strong>{money(v)}</strong>,
            },
          ]}
        />
      </Card>

      <FormDrawer
        open={invoicing}
        title="Create the invoice"
        path="/invoices"
        invalidate={['/invoices', '/billing-runs']}
        initialValues={{ billingRunId: id }}
        onClose={() => setInvoicing(false)}
        onSaved={(saved: Invoice) => navigate(`/invoices/${saved.id}`)}
      >
        {() => (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="The invoice freezes what the run computed"
              description="Both parties' details, the place of supply and the CGST/SGST-versus-IGST decision are snapshotted onto it. Editing a customer afterwards changes nothing on an invoice already raised."
            />
            <Form.Item name="billingRunId" hidden>
              <Input />
            </Form.Item>
          </>
        )}
      </FormDrawer>
    </Space>
  );
}

export function Invoices() {
  const navigate = useNavigate();
  return (
    <ListPage<Invoice>
      title="Invoices"
      path="/invoices"
      searchPlaceholder="Number"
      onRowClick={(row) => navigate(`/invoices/${row.id}`)}
      emptyDescription="No invoices yet. One is raised from a billing run, and only from a run that priced everything it found."
      columns={[
        { title: 'Number', dataIndex: 'number', width: 180 },
        { title: 'Date', dataIndex: 'invoiceDate', width: 130, render: (v) => date(v) },
        { title: 'Due', dataIndex: 'dueDate', width: 130, render: (v) => date(v) },
        {
          title: 'Tax',
          dataIndex: 'taxTreatment',
          width: 120,
          render: (v: string) => <Tag>{v === 'intra_state' ? 'CGST+SGST' : 'IGST'}</Tag>,
        },
        { title: 'Total', dataIndex: 'grandTotal', align: 'right', width: 140, render: (v) => money(v) },
        { title: 'Paid', dataIndex: 'amountPaid', align: 'right', width: 130, render: (v) => money(v) },
        {
          title: 'Outstanding',
          dataIndex: 'balanceDue',
          align: 'right',
          width: 140,
          render: (v: number) => (Number(v) > 0 ? <strong>{money(v)}</strong> : money(v)),
        },
        {
          title: 'Status',
          dataIndex: 'status',
          width: 150,
          render: (status: string) => <Tag color={statusColor(status)}>{humanise(status)}</Tag>,
        },
      ]}
    />
  );
}

export function InvoiceDetail() {
  const { id = '' } = useParams();
  const [paying, setPaying] = useState(false);
  const { can } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ['/invoices', id], queryFn: () => api<Invoice>(`/invoices/${id}`) });

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
              basePath={`/invoices/${id}`}
              permission="create_invoice"
              disabledReason={data?.status === 'draft' ? 'Issue the invoice first' : undefined}
            />
            {can('record_payment') && Number(data?.balanceDue ?? 0) > 0 && data?.status !== 'draft' && (
              <CreateButton label="Record a payment" onClick={() => setPaying(true)} />
            )}
            <RecordActions
              basePath="/invoices"
              id={id}
              status={data?.status}
              invalidate={['/invoices']}
              actions={[
                { label: 'Submit', action: 'submit', permission: 'create_invoice', from: ['draft'], primary: true },
                { label: 'Approve', action: 'approve', permission: 'approve_invoice', from: ['pending_approval'], primary: true },
                { label: 'Issue', action: 'issue', permission: 'approve_invoice', from: ['approved'], primary: true },
                { label: 'Cancel', action: 'cancel', permission: 'create_invoice', from: ['draft'], danger: true, needsReason: true },
              ]}
            />
          </Space>
        }
      >
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
          <Descriptions.Item label="Billed to" span={2}>
            {data?.customerSnapshot?.legal_name ?? '—'}
            {data?.customerSnapshot?.gstin ? ` · ${data.customerSnapshot.gstin}` : ''}
          </Descriptions.Item>
          <Descriptions.Item label="Due">{date(data?.dueDate)}</Descriptions.Item>
        </Descriptions>
        <Divider style={{ margin: '12px 0' }} />
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}>
            <Statistic title="Subtotal" value={money(data?.subtotal)} />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title={data?.taxTreatment === 'intra_state' ? 'CGST + SGST' : 'IGST'}
              value={money(
                data?.taxTreatment === 'intra_state'
                  ? Number(data?.cgstAmount ?? 0) + Number(data?.sgstAmount ?? 0)
                  : data?.igstAmount,
              )}
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title="Grand total" value={money(data?.grandTotal)} />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title="Outstanding"
              value={money(data?.balanceDue)}
              valueStyle={Number(data?.balanceDue ?? 0) > 0 ? { color: '#cf1322' } : undefined}
            />
          </Col>
        </Row>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          The tax split was decided once, from the two state codes as they were when this invoice was raised, and is
          frozen. Round-off: {money(data?.roundOff)}.
        </Typography.Paragraph>
      </Card>

      <Card title="Lines">
        <Table
          scroll={{ x: 'max-content' }}
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={data?.lines ?? []}
          columns={[
            { title: 'Description', dataIndex: 'description' },
            { title: 'SAC', dataIndex: 'sacCode', width: 110, render: (v) => v ?? '—' },
            { title: 'Quantity', dataIndex: 'quantity', align: 'right', width: 120, render: (v) => quantity(v) },
            { title: 'Rate', dataIndex: 'rate', align: 'right', width: 110, render: (v) => money(v) },
            {
              title: 'Amount',
              dataIndex: 'amount',
              align: 'right',
              width: 140,
              render: (v) => <strong>{money(v)}</strong>,
            },
          ]}
        />
      </Card>

      <FormDrawer
        open={paying}
        title="Record a payment"
        path="/payments"
        invalidate={['/invoices', '/payments']}
        onClose={() => setPaying(false)}
        transform={(values) => ({
          idempotencyKey: crypto.randomUUID(),
          customerId: values.customerId,
          amount: values.amount,
          paymentMode: values.paymentMode,
          referenceNo: values.referenceNo || undefined,
          allocations: [{ invoiceId: id, amount: values.amount }],
        })}
      >
        {() => (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="Clicking twice records one payment"
              description="Each attempt carries a token the database enforces, so a retried or double-clicked save cannot over-credit the customer."
            />
            <Form.Item name="customerId" label="Customer" rules={[{ required: true }]}>
              <RecordPicker<{ id: string; code: string; name: string }>
                path="/customers"
                label={(row) => `${row.code} — ${row.name}`}
              />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item
                  name="amount"
                  label="Amount"
                  rules={[{ required: true }]}
                  initialValue={data?.balanceDue}
                >
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="paymentMode" label="Mode" rules={[{ required: true }]} initialValue="neft">
                  <RecordPickerModes />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="referenceNo" label="Reference">
              <Input placeholder="UTR / cheque number" />
            </Form.Item>
          </>
        )}
      </FormDrawer>
    </Space>
  );
}

/** The payment modes the API accepts. A short fixed list, so it is a plain select. */
function RecordPickerModes(props: { value?: string; onChange?: (value: string) => void; id?: string }) {
  return (
    <select
      id={props.id}
      value={props.value}
      onChange={(event) => props.onChange?.(event.target.value)}
      style={{ width: '100%', height: 32, borderRadius: 6, border: '1px solid #d9d9d9', padding: '0 8px' }}
    >
      {['neft', 'rtgs', 'imps', 'upi', 'cheque', 'cash', 'adjustment'].map((mode) => (
        <option key={mode} value={mode}>
          {mode.toUpperCase()}
        </option>
      ))}
    </select>
  );
}

interface Payment {
  id: string;
  number: string;
  paymentDate: string;
  customerId: string;
  amount: number;
  paymentMode: string;
  referenceNo: string | null;
  unallocatedAmount: number;
}

export function Payments() {
  return (
    <ListPage<Payment>
      title="Payments"
      path="/payments"
      searchPlaceholder="Number or reference"
      emptyDescription="No payments recorded yet."
      columns={[
        { title: 'Number', dataIndex: 'number', width: 180 },
        { title: 'Date', dataIndex: 'paymentDate', width: 130, render: (v) => date(v) },
        { title: 'Mode', dataIndex: 'paymentMode', width: 110, render: (v) => <Tag>{String(v).toUpperCase()}</Tag> },
        { title: 'Reference', dataIndex: 'referenceNo', render: (v) => v ?? '—' },
        { title: 'Amount', dataIndex: 'amount', align: 'right', width: 140, render: (v) => money(v) },
        {
          title: 'Unallocated',
          dataIndex: 'unallocatedAmount',
          align: 'right',
          width: 140,
          render: (v: number) => (Number(v) > 0 ? <Typography.Text type="warning">{money(v)}</Typography.Text> : '—'),
        },
      ]}
    />
  );
}

interface StatementEntry {
  type: string;
  date: string;
  number: string;
  debit: number;
  credit: number;
  balance: number;
}

interface Statement {
  openingBalance: number;
  closingBalance: number;
  entries: StatementEntry[];
  ageing?: Record<string, number>;
}

/**
 * The customer account statement: invoices, notes and payments netted into
 * one running balance. The same projection the Customer Statement document
 * renders from, so the PDF and this screen cannot disagree.
 */
export function Statements() {
  const [params, setParams] = useSearchParams();
  const customerId = params.get('customerId') ?? undefined;
  const { data, isLoading, error } = useQuery({
    queryKey: ['/customer-statements', customerId],
    queryFn: () => api<Statement>(`/customer-statements/${customerId}`),
    enabled: Boolean(customerId),
  });

  return (
    <Card title={<Typography.Title level={4} style={{ margin: 0 }}>Customer statement</Typography.Title>}>
      <Space direction="vertical" size={16} style={{ display: 'flex' }}>
        <div style={{ maxWidth: 420 }}>
          <RecordPicker<{ id: string; code: string; name: string }>
            path="/customers"
            value={customerId}
            onChange={(value) => setParams(value ? { customerId: value } : {})}
            label={(row) => `${row.code} — ${row.name}`}
            placeholder="Pick a customer"
          />
        </div>

        {error && <Alert type="error" showIcon message={(error as Error).message} />}

        {customerId && (
          <>
            <Row gutter={16}>
              <Col span={8}>
                <Card size="small">
                  <Statistic title="Opening" value={money(data?.openingBalance)} />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic title="Closing" value={money(data?.closingBalance)} />
                </Card>
              </Col>
            </Row>
            <Table<StatementEntry>
              scroll={{ x: 'max-content' }}
              size="small"
              rowKey={(row) => `${row.type}-${row.number}`}
              loading={isLoading}
              pagination={false}
              dataSource={data?.entries ?? []}
              locale={{ emptyText: 'Nothing billed or paid in this period.' }}
              columns={[
                { title: 'Date', dataIndex: 'date', width: 130, render: (v) => date(v) },
                { title: 'Type', dataIndex: 'type', width: 130, render: (v) => <Tag>{humanise(v)}</Tag> },
                { title: 'Number', dataIndex: 'number' },
                {
                  title: 'Debit',
                  dataIndex: 'debit',
                  align: 'right',
                  width: 130,
                  render: (v: number) => (Number(v) ? money(v) : '—'),
                },
                {
                  title: 'Credit',
                  dataIndex: 'credit',
                  align: 'right',
                  width: 130,
                  render: (v: number) => (Number(v) ? money(v) : '—'),
                },
                {
                  title: 'Balance',
                  dataIndex: 'balance',
                  align: 'right',
                  width: 140,
                  render: (v) => <strong>{money(v)}</strong>,
                },
              ]}
            />
          </>
        )}
      </Space>
    </Card>
  );
}
