import { Alert, Button, Card, Col, Row, Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

const { Title, Paragraph, Text } = Typography;

interface PricingPlan {
  code: string;
  name: string;
  description: string | null;
  trialDays: number;
  priceMonthly: number | null;
  priceYearly: number | null;
  currency: string;
}

interface PricingFeature {
  featureCode: string;
  name: string;
  module: string;
  byPlan: { planCode: string; limitType: string; limit: number | null }[];
}

/**
 * `ux-system.md` §14's public pricing page — the one screen somebody reads
 * *before* they have an account, which is why it carries no session and no
 * navigation.
 *
 * Every number on it comes from `GET /pricing`, which pivots the same
 * `plan_feature_limits` rows the entitlement engine enforces. That is §14's
 * own requirement and it is worth restating: a pricing page written by hand
 * is a second description of the product, and the first thing a customer
 * holds you to is the one they read before paying.
 */
export function Pricing() {
  const { data, isLoading } = useQuery({
    queryKey: ['/pricing'],
    queryFn: () => api<{ plans: PricingPlan[]; features: PricingFeature[] }>('/pricing'),
  });

  const plans = data?.plans ?? [];
  const godowns = data?.features.find((f) => f.featureCode === 'WAREHOUSE');

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', padding: 16 }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <Space direction="vertical" size={24} style={{ display: 'flex' }}>
          <div style={{ textAlign: 'center', paddingTop: 24 }}>
            <Title level={2} style={{ marginBottom: 8 }}>
              Priced per godown, per month
            </Title>
            <Paragraph type="secondary" style={{ fontSize: 16, maxWidth: 640, margin: '0 auto' }}>
              Every document, every user and every customer login is unlimited on a paid plan. The
              only thing that changes is how many godowns you run — because that is the only thing
              that actually differs between one warehouse and ten.
            </Paragraph>
          </div>

          <Row gutter={[16, 16]}>
            {plans.map((plan) => {
              const allowance = godowns?.byPlan.find((b) => b.planCode === plan.code);
              const paid = (plan.priceMonthly ?? 0) > 0;
              return (
                <Col key={plan.code} xs={24} sm={12} lg={24 / Math.min(plans.length, 4)}>
                  <Card
                    loading={isLoading}
                    style={{ height: '100%' }}
                    // The middle plan is the one most people should be on,
                    // and saying so is not a trick -- it is the answer to
                    // the question every pricing page leaves unanswered.
                    title={
                      <Space>
                        <Text strong>{plan.name}</Text>
                        {plan.code === 'GROWTH' && <Tag color="blue">Most warehouses</Tag>}
                      </Space>
                    }
                  >
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <div>
                        <Title level={3} style={{ margin: 0 }}>
                          {paid ? `₹${(plan.priceMonthly ?? 0).toLocaleString('en-IN')}` : 'Free'}
                        </Title>
                        {paid && <Text type="secondary">per month</Text>}
                      </div>

                      {paid && plan.priceYearly !== null && (
                        <Text type="secondary">
                          or ₹{plan.priceYearly.toLocaleString('en-IN')} a year — two months free
                        </Text>
                      )}

                      <Paragraph type="secondary" style={{ marginBottom: 0, minHeight: 44 }}>
                        {plan.description}
                      </Paragraph>

                      <Text strong>
                        {allowance?.limitType === 'unlimited'
                          ? 'Unlimited godowns'
                          : `${allowance?.limit ?? 0} ${allowance?.limit === 1 ? 'godown' : 'godowns'}`}
                      </Text>

                      {/*
                        Only the paid cards say this. On Free the plan's own
                        description is already "2 free copies of every
                        document type, forever", and a card that says the
                        same thing twice reads as a page nobody proof-read.
                      */}
                      {paid && <Text type="secondary">Every document unlimited</Text>}

                      {plan.trialDays > 0 && <Tag color="green">{plan.trialDays}-day trial</Tag>}
                    </Space>
                  </Card>
                </Col>
              );
            })}
          </Row>

          <Card title="What each plan allows" loading={isLoading}>
            <PlanComparison plans={plans} features={data?.features ?? []} />
          </Card>

          <Alert
            type="info"
            showIcon
            message="No card, no lock-in"
            description="Start free and run a real godown end to end — gate entry to invoice — before deciding. When you are ready, ask to upgrade from inside the app and we will arrange payment. Nothing charges automatically."
          />

          <div style={{ textAlign: 'center', paddingBottom: 32 }}>
            <Space direction="vertical">
              <Link to="/login">
                <Button type="primary" size="large">
                  Start free
                </Button>
              </Link>
              <Text type="secondary">
                Already have a workspace? <Link to="/login">Sign in</Link>
              </Text>
            </Space>
          </div>
        </Space>
      </div>
    </div>
  );
}

/**
 * The comparison table, built by pivoting whatever the API returned rather
 * than from a written list — so a feature added to a plan appears here
 * without anyone remembering to update a page.
 */
function PlanComparison({ plans, features }: { plans: PricingPlan[]; features: PricingFeature[] }) {
  const say = (limitType: string, limit: number | null) => {
    if (limitType === 'unlimited') return <Text strong>Unlimited</Text>;
    if (limitType === 'disabled') return <Text type="secondary">—</Text>;
    return <Text>{limit}</Text>;
  };

  return (
    <Table
      size="small"
      pagination={false}
      // Twenty-eight rows of "unlimited / unlimited / unlimited" is not a
      // comparison, it is wallpaper: the table scrolls inside its card
      // rather than stretching the page.
      scroll={{ x: 'max-content', y: 420 }}
      rowKey={(row) => row.featureCode}
      dataSource={features}
      columns={[
        { title: 'Feature', dataIndex: 'name', width: 240, render: (name) => <Text>{name}</Text> },
        ...plans.map((plan) => ({
          title: plan.name,
          width: 130,
          render: (_: unknown, row: PricingFeature) => {
            const cell = row.byPlan.find((b) => b.planCode === plan.code);
            return say(cell?.limitType ?? 'disabled', cell?.limit ?? null);
          },
        })),
      ]}
    />
  );
}
