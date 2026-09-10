import { Alert, Card, Col, Empty, List, Row, Spin, Statistic, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { dateTime, humanise, money, quantity } from '../lib/format';

interface Dashboard {
  today: { inwardQty: number; outwardQty: number };
  /** Absent for a role that may not see stock -- the API omits it, rather than sending zeros. */
  stock?: { onHandQty: number; reservedQty: number; customersWithStock: number };
  pending: {
    grnApprovals: number;
    putaways: number;
    pods: number;
    openReleaseOrders: number;
    stockAdjustments: number;
  };
  recentDocuments: {
    id: string;
    documentType: string;
    documentNumber: string;
    customerName: string | null;
    generatedAt: string;
  }[];
  /** Absent for a role that may not see money. Same reason. */
  billing?: {
    outstanding: number;
    overdue: number;
    customersNotYetBilledThisMonth: number;
    invoicesThisMonth: number;
  };
}

/** Each queue is a count and the screen that clears it (`ux-system.md` §3). */
const QUEUES: { key: keyof Dashboard['pending']; label: string; path: string }[] = [
  { key: 'grnApprovals', label: 'GRNs waiting for approval', path: '/grns?status=submitted' },
  { key: 'putaways', label: 'Put-aways not finished', path: '/putaways' },
  { key: 'openReleaseOrders', label: 'Release orders in flight', path: '/release-orders' },
  { key: 'pods', label: 'Dispatched, no proof of delivery', path: '/dispatches' },
  { key: 'stockAdjustments', label: 'Stock adjustments awaiting approval', path: '/stock-verifications' },
];

/**
 * `ux-system.md` §3. Every tile comes from the API's own dashboard
 * endpoint, which composes it from the same services the list screens read
 * -- so a number here and the list it links to cannot disagree.
 *
 * The role decides the shape of the response, not this component: a
 * Warehouse Operator's payload has no `billing`, and one without stock
 * access has no `stock`. Rendering "what came back" rather than "what I
 * expected minus what I'm allowed" means a new role needs no change here.
 */
export function Dashboard() {
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard') });

  if (isLoading) return <Spin size="large" />;
  if (error) return <Alert type="error" showIcon message={(error as Error).message} />;
  if (!data) return <Empty />;

  const queues = QUEUES.filter((queue) => data.pending[queue.key] > 0);

  return (
    <>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Today
      </Typography.Title>
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}>
          <Card size="small">
            <Statistic title="Received today" value={quantity(data.today.inwardQty)} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card size="small">
            <Statistic title="Shipped today" value={quantity(data.today.outwardQty)} />
          </Card>
        </Col>
        {data.stock && (
          <>
            <Col xs={12} lg={6}>
              <Card size="small">
                <Statistic title="On hand" value={quantity(data.stock.onHandQty)} />
              </Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card size="small">
                <Statistic
                  title="Reserved"
                  value={quantity(data.stock.reservedQty)}
                  suffix={
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      of {quantity(data.stock.onHandQty)}
                    </Typography.Text>
                  }
                />
              </Card>
            </Col>
          </>
        )}
      </Row>

      {data.billing && (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={12} lg={6}>
            <Card size="small">
              <Statistic title="Outstanding" value={money(data.billing.outstanding)} />
            </Card>
          </Col>
          <Col xs={12} lg={6}>
            <Card size="small">
              <Statistic
                title="Overdue"
                value={money(data.billing.overdue)}
                valueStyle={data.billing.overdue > 0 ? { color: '#cf1322' } : undefined}
              />
            </Card>
          </Col>
          <Col xs={12} lg={6}>
            <Card size="small">
              <Statistic title="Invoices this month" value={data.billing.invoicesThisMonth} />
            </Card>
          </Col>
          <Col xs={12} lg={6}>
            <Card size="small">
              <Statistic
                title="Holding stock, not yet billed"
                value={data.billing.customersNotYetBilledThisMonth}
                suffix="customers"
              />
            </Card>
          </Col>
        </Row>
      )}

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={10}>
          <Card size="small" title="Waiting on someone">
            {queues.length ? (
              <List
                size="small"
                dataSource={queues}
                renderItem={(queue) => (
                  <List.Item>
                    <Link to={queue.path}>{queue.label}</Link>
                    <Tag>{data.pending[queue.key]}</Tag>
                  </List.Item>
                )}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing waiting" />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card size="small" title="Recently issued documents">
            {data.recentDocuments.length ? (
              <List
                size="small"
                dataSource={data.recentDocuments}
                renderItem={(row) => (
                  <List.Item>
                    <span>
                      <Tag>{humanise(row.documentType)}</Tag> {row.documentNumber}
                      {row.customerName && (
                        <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                          {row.customerName}
                        </Typography.Text>
                      )}
                    </span>
                    <Typography.Text type="secondary">{dateTime(row.generatedAt)}</Typography.Text>
                  </List.Item>
                )}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No documents generated yet" />
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
}
