import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreateButton, ListPage } from '../../components/ListPage';
import { FormDrawer } from '../../components/FormDrawer';
import { api, ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Attachments } from '../../components/Attachments';
import { STATE_CODES } from '../masters/Customers';
import { dateTime, humanise, money } from '../../lib/format';

interface Company {
  legalName: string;
  tradeName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  pincode: string | null;
  gstin: string | null;
  pan: string | null;
  phone: string | null;
  email: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
  signatoryName: string | null;
  signatoryDesignation: string | null;
  isDocumentReady: boolean;
  isDemo: boolean;
}

/**
 * The six staff roles `permissions-matrix.md` seeds, in the order it lists
 * them. `customer` is deliberately absent from both places this is used: a
 * portal login is not a member of staff, it cannot be invited from here,
 * and the notification emitter excludes it from every audience.
 */
const STAFF_ROLES = [
  { value: 'owner', label: 'Owner — everything, including the last-owner guard' },
  { value: 'admin', label: 'Admin — everything except owner-only approvals' },
  { value: 'warehouse_manager', label: 'Warehouse manager — checks and approves receipts' },
  { value: 'warehouse_operator', label: 'Warehouse operator — raises and submits, never approves' },
  { value: 'billing_executive', label: 'Billing executive — invoices and payments' },
  { value: 'accountant', label: 'Accountant — billing plus approvals' },
];

/**
 * The company profile behind every document. Until it carries a GSTIN and
 * an address, every PDF this workspace issues has a letterhead with a bare
 * name on it — which is why `isDocumentReady` is shown here rather than
 * left for someone to discover on a printed invoice.
 */
export function CompanySettings() {
  const [form] = Form.useForm();
  const { session } = useSession();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['/company'], queryFn: () => api<Company>('/company') });

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) => api<Company>('/company', { method: 'PATCH', body: values }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['/company'] });
      await queryClient.invalidateQueries({ queryKey: ['/onboarding'] });
      message.success('Saved');
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Could not save'),
  });

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Card
        loading={isLoading}
        title={<Typography.Title level={4} style={{ margin: 0 }}>Company</Typography.Title>}
        extra={
          <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
            Save
          </Button>
        }
      >
        {data && !data.isDocumentReady && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="Documents will print with an incomplete letterhead"
            description="A GSTIN, address line, city, state and pincode are what a letterhead needs. Until all five are here, every PDF this workspace issues shows a bare company name."
          />
        )}
        <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="legalName" label="Legal name" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="tradeName" label="Trade name" tooltip="Printed on the letterhead when set">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="addressLine1" label="Address">
            <Input />
          </Form.Item>
          <Form.Item name="addressLine2" label=" " colon={false}>
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
              <Form.Item name="pincode" label="Pincode">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item
                name="stateCode"
                label="State code"
                tooltip="Decides CGST+SGST versus IGST on every invoice this workspace raises"
              >
                <Select allowClear showSearch optionFilterProp="label" options={STATE_CODES} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="gstin" label="GSTIN">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="pan" label="PAN">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="phone" label="Phone">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="email" label="Email">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Typography.Title level={5}>Bank details</Typography.Title>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="bankName" label="Bank">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="bankAccountNo" label="Account number">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="bankIfsc" label="IFSC">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="signatoryName" label="Authorised signatory">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="signatoryDesignation" label="Designation">
                <Input />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      {/* The three images every generated document prints
          (document-engine.md §3). They are attachments on the workspace
          itself, so this is the same component the GRN and POD screens
          use -- ownerType 'company', the tenant as the owner id. */}
      <Attachments
        ownerType="company"
        ownerId={session?.tenant.id ?? ''}
        title="Letterhead"
        categories={['logo', 'signature', 'stamp']}
        writePermission="manage_company_settings"
        emptyText="No letterhead images yet. A logo prints in the header of every document; a signature and a seal print above the authorised-signatory line."
      />
    </Space>
  );
}

interface Member {
  id: string;
  email: string;
  fullName: string;
  roleCode: string;
  roleName: string;
  status: string;
  customerId: string | null;
}

export function UserSettings() {
  const [inviting, setInviting] = useState(false);
  const { session } = useSession();

  return (
    <>
      <ListPage<Member>
        title="Users"
        path="/users"
        unpaged
        emptyDescription="Just you so far."
        actions={<CreateButton label="Add a member" onClick={() => setInviting(true)} />}
        columns={[
          { title: 'Name', dataIndex: 'fullName', render: (name) => <strong>{name}</strong> },
          { title: 'Email', dataIndex: 'email' },
          { title: 'Role', dataIndex: 'roleName', width: 200, render: (name) => <Tag>{name}</Tag> },
          {
            title: 'Status',
            dataIndex: 'status',
            width: 130,
            render: (status: string, row) => (
              <Space>
                <Tag color={status === 'active' ? 'success' : 'default'}>{humanise(status)}</Tag>
                {row.email === session?.user.email && <Tag>you</Tag>}
              </Space>
            ),
          },
        ]}
      />
      <FormDrawer open={inviting} title="Add a member" path="/users" invalidate={['/users']} onClose={() => setInviting(false)}>
        {() => (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="You set the initial password"
              description="There is no email delivery for invitations yet, so a new account gets its first password from you. An address that already has an account elsewhere simply gains a membership here, with its own password untouched."
            />
            <Form.Item name="fullName" label="Name" rules={[{ required: true, min: 2 }]}>
              <Input />
            </Form.Item>
            <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="mobile" label="Mobile" tooltip="Where SMS and WhatsApp notifications would reach them">
              <Input />
            </Form.Item>
            <Form.Item name="password" label="Initial password" rules={[{ required: true, min: 8 }]}>
              <Input.Password />
            </Form.Item>
            <Form.Item name="roleCode" label="Role" rules={[{ required: true }]}>
              <Select
                options={STAFF_ROLES}
              />
            </Form.Item>
          </>
        )}
      </FormDrawer>
    </>
  );
}

interface PlanUsage {
  plan: { code: string; name: string; description: string | null; priceMonthly: number | null; currency: string };
  subscription: { status: string; trialEndsAt: string | null; currentPeriodEnd: string | null };
  features: {
    featureCode: string;
    name: string;
    module: string;
    limitType: string;
    limit: number | null;
    used: number;
    remaining: number | null;
    allowed: boolean;
    upgradeRequired: boolean;
  }[];
}

/**
 * `ux-system.md` §13. Every number here comes from the same
 * `checkEntitlement` call a paywall makes, so the figure on this page and
 * the one that blocks a click cannot disagree.
 */
export function PlanSettings() {
  const { data, isLoading, error } = useQuery({ queryKey: ['/plan/usage'], queryFn: () => api<PlanUsage>('/plan/usage') });

  if (isLoading) return <Spin size="large" />;
  if (error) return <Card><Alert type="error" showIcon message={(error as Error).message} /></Card>;

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Card title={<Typography.Title level={4} style={{ margin: 0 }}>Plan</Typography.Title>}>
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
          <Descriptions.Item label="Plan">
            <Space>
              <strong>{data?.plan.name}</strong>
              <Tag>{data?.plan.code}</Tag>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="Status">
            <Tag color={data?.subscription.status === 'active' ? 'success' : 'warning'}>
              {humanise(data?.subscription.status)}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Price">
            {data?.plan.priceMonthly === null ? 'Free' : `${money(data?.plan.priceMonthly)} / month`}
          </Descriptions.Item>
        </Descriptions>
        {data?.plan.description && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            {data.plan.description}
          </Typography.Paragraph>
        )}
      </Card>

      <Card title="Usage">
        <Table
          scroll={{ x: 'max-content' }}
          size="small"
          rowKey="featureCode"
          pagination={false}
          dataSource={data?.features ?? []}
          columns={[
            { title: 'Feature', dataIndex: 'name', render: (name) => <strong>{name}</strong> },
            { title: 'Module', dataIndex: 'module', width: 140, render: (v) => <Tag>{humanise(v)}</Tag> },
            {
              title: 'Used',
              width: 260,
              render: (_, row: PlanUsage['features'][number]) =>
                row.limit === null ? (
                  <Typography.Text type="secondary">{row.used} used · unlimited</Typography.Text>
                ) : (
                  <Space direction="vertical" size={0} style={{ width: '100%' }}>
                    <Progress
                      percent={Math.min(100, Math.round((row.used / Math.max(1, row.limit)) * 100))}
                      size="small"
                      status={row.allowed ? 'normal' : 'exception'}
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {row.used} of {row.limit} · {row.remaining} left
                    </Typography.Text>
                  </Space>
                ),
            },
            {
              title: '',
              width: 150,
              render: (_, row: PlanUsage['features'][number]) =>
                row.allowed ? null : <Tag color="error">limit reached</Tag>,
            },
          ]}
        />
      </Card>
    </Space>
  );
}

interface AuditRow {
  id: string;
  occurredAt: string;
  action: string;
  entityType: string;
  entityId: string;
  userName: string | null;
  userRoleCode: string | null;
  ipAddress: string | null;
}

/** `ux-system.md` §12's audit viewer, over the rows every service writes inside its own transaction. */
export function AuditSettings() {
  return (
    <ListPage<AuditRow>
      title="Audit log"
      path="/audit-logs"
      searchPlaceholder="(filter by entity below)"
      emptyDescription="Nothing recorded yet."
      columns={[
        { title: 'When', dataIndex: 'occurredAt', width: 190, render: (v) => dateTime(v) },
        { title: 'Action', dataIndex: 'action', width: 160, render: (v) => <Tag>{humanise(v)}</Tag> },
        { title: 'Record', dataIndex: 'entityType', width: 170, render: (v) => humanise(v) },
        { title: 'Who', dataIndex: 'userName', render: (v) => v ?? 'System' },
        { title: 'Role', dataIndex: 'userRoleCode', width: 170, render: (v) => (v ? humanise(v) : '—') },
        { title: 'From', dataIndex: 'ipAddress', width: 140, render: (v) => v ?? '—' },
      ]}
    />
  );
}

interface Notification {
  id: string;
  ruleCode: string;
  title: string;
  body: string | null;
  severity: string;
  readAt: string | null;
  createdAt: string;
}

export function Notifications() {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const markAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['/notifications'] });
      message.success('All marked read');
    },
  });

  return (
    <ListPage<Notification>
      title="Notifications"
      path="/notifications"
      searchPlaceholder=""
      emptyDescription="Nothing to tell you. Notifications fire on the events §56 lists — a GRN waiting for approval, stock going overdue, a customer asking for a return."
      actions={
        <Button loading={markAll.isPending} onClick={() => markAll.mutate()}>
          Mark all read
        </Button>
      }
      columns={[
        {
          title: '',
          width: 40,
          render: (_, row) => (row.readAt ? null : <span style={{ color: '#1f6feb' }}>●</span>),
        },
        {
          title: 'What happened',
          render: (_, row) => (
            <Space direction="vertical" size={0}>
              <strong>{row.title}</strong>
              {row.body && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {row.body}
                </Typography.Text>
              )}
            </Space>
          ),
        },
        {
          title: 'Severity',
          dataIndex: 'severity',
          width: 120,
          render: (severity: string) => (
            <Tag color={severity === 'critical' ? 'error' : severity === 'warning' ? 'warning' : 'default'}>
              {humanise(severity)}
            </Tag>
          ),
        },
        { title: 'When', dataIndex: 'createdAt', width: 190, render: (v) => dateTime(v) },
      ]}
    />
  );
}

interface NotificationRule {
  code: string;
  channels: string[];
  audienceRoleCodes: string[];
  isActive: boolean;
  isCustomised: boolean;
  isEmitted: boolean;
}

/**
 * Written out rather than derived from the code, because `humanise` turns
 * `grn_pending_approval` into "Grn pending approval" and `pod_pending`
 * into "Pod pending" -- two acronyms a warehouse reads every day.
 */
const RULE_TITLES: Record<string, string> = {
  grn_pending_approval: 'GRN waiting for approval',
  stock_discrepancy: 'Stock discrepancy',
  stock_adjustment_pending: 'Stock adjustment waiting for approval',
  pod_pending: 'POD not returned',
  customer_request_pending: 'Customer request',
  payment_overdue: 'Payment overdue',
  payment_due: 'Payment due',
  agreement_expiring: 'Agreement expiring',
};

/** What each of §56's event codes actually means, in the words of the thing that raises it. */
const RULE_DESCRIPTIONS: Record<string, string> = {
  grn_pending_approval: 'A GRN was submitted and is waiting for someone to approve it.',
  stock_discrepancy: 'A GRN recorded a shortage, excess or damage against what was declared.',
  stock_adjustment_pending: 'A stock adjustment was raised and needs approval before it posts.',
  pod_pending: 'A gate pass left the yard and the proof of delivery has not come back.',
  customer_request_pending: 'A customer raised a request from the portal.',
  payment_overdue: 'An invoice passed its due date without being paid in full.',
  payment_due: 'An invoice is approaching its due date.',
  agreement_expiring: 'An agreement is approaching its end date.',
};

const CHANNEL_OPTIONS = [
  { value: 'in_app', label: 'In app' },
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'sms', label: 'SMS' },
];

/**
 * Blueprint §56's rules, which were always data and are now editable.
 *
 * A workspace's row *replaces* the shipped default for that event rather
 * than adding to it, so the audience box is the whole audience — clearing
 * it means every staff role, which is also what the shipped rules with no
 * audience mean. Saving a row is what the emitter reads on the very next
 * event; there is nothing to deploy.
 */
export function NotificationRuleSettings() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['/notification-rules'],
    queryFn: () => api<NotificationRule[]>('/notification-rules'),
  });
  const [drafts, setDrafts] = useState<Record<string, NotificationRule>>({});

  const edit = (rule: NotificationRule, patch: Partial<NotificationRule>) =>
    setDrafts((current) => ({ ...current, [rule.code]: { ...rule, ...current[rule.code], ...patch } }));

  const save = useMutation({
    mutationFn: (rule: NotificationRule) =>
      api<NotificationRule>(`/notification-rules/${rule.code}`, {
        method: 'PUT',
        body: { channels: rule.channels, audienceRoleCodes: rule.audienceRoleCodes, isActive: rule.isActive },
      }),
    onSuccess: async (_saved, rule) => {
      setDrafts((current) => {
        const next = { ...current };
        delete next[rule.code];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ['/notification-rules'] });
      message.success('Saved — the next event uses it');
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Could not save'),
  });

  const rows = (data ?? []).map((rule) => drafts[rule.code] ?? rule);
  const isDirty = (rule: NotificationRule) => Boolean(drafts[rule.code]);

  return (
    <Card
      loading={isLoading}
      title={<Typography.Title level={4} style={{ margin: 0 }}>Notifications</Typography.Title>}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="In-app delivery always works; the other three need the server configured"
        description="An in-app notification is the row itself, so it is delivered the moment the event happens. Email, WhatsApp and SMS are handed to the delivery worker, which can only send them once SMTP_URL or the WhatsApp/SMS webhook is set on the server — until then those notifications sit pending and visible rather than being marked sent."
      />
      <Table<NotificationRule>
        rowKey="code"
        dataSource={rows}
        pagination={false}
        size="small"
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: 'Event',
            dataIndex: 'code',
            render: (code: string, rule) => (
              <Space direction="vertical" size={0}>
                <Space size={6} wrap>
                  <strong>{RULE_TITLES[code] ?? humanise(code)}</strong>
                  {rule.isCustomised && <Tag color="blue">Yours</Tag>}
                  {!rule.isEmitted && (
                    <Tag color="default" title="Seeded for §56, but no part of the system raises it yet">
                      Not raised yet
                    </Tag>
                  )}
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {RULE_DESCRIPTIONS[code] ?? 'No description.'}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: 'Channels',
            width: 260,
            render: (_, rule) => (
              <Select
                mode="multiple"
                style={{ width: '100%' }}
                value={rule.channels}
                options={CHANNEL_OPTIONS}
                onChange={(channels) => edit(rule, { channels })}
              />
            ),
          },
          {
            title: 'Who hears about it',
            width: 280,
            render: (_, rule) => (
              <Select
                mode="multiple"
                allowClear
                style={{ width: '100%' }}
                placeholder="Everyone"
                value={rule.audienceRoleCodes}
                options={STAFF_ROLES.map((role) => ({ value: role.value, label: humanise(role.value) }))}
                onChange={(audienceRoleCodes) => edit(rule, { audienceRoleCodes })}
              />
            ),
          },
          {
            title: 'On',
            width: 70,
            render: (_, rule) => <Switch checked={rule.isActive} onChange={(isActive) => edit(rule, { isActive })} />,
          },
          {
            title: '',
            width: 90,
            render: (_, rule) => (
              <Button
                type="primary"
                size="small"
                disabled={!isDirty(rule) || rule.channels.length === 0}
                loading={save.isPending && save.variables?.code === rule.code}
                onClick={() => save.mutate(rule)}
              >
                Save
              </Button>
            ),
          },
        ]}
      />
    </Card>
  );
}
