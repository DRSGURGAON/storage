import { Alert, Button, Card, List, Space, Tag, Typography } from 'antd';
import { CheckCircleFilled, RightOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

type StepKey = 'company' | 'warehouse' | 'customer' | 'products' | 'rateCard';

interface OnboardingStatus {
  steps: Record<StepKey, { done: boolean; count: number }>;
  isComplete: boolean;
  nextStep: StepKey | 'ready';
}

const STEPS: { key: StepKey; label: string; why: string; path: string }[] = [
  {
    key: 'company',
    label: 'Complete the company profile',
    why: 'Until the GSTIN and address are filled in, every document renders with a blank letterhead.',
    path: '/settings/company',
  },
  {
    key: 'warehouse',
    label: 'Add a warehouse',
    why: 'And at least one bin inside it — stock stays unallocated until there is somewhere to put it away.',
    path: '/warehouses',
  },
  {
    key: 'customer',
    label: 'Add a customer',
    why: 'Goods are always received on behalf of someone; a GRN cannot be raised without one.',
    path: '/customers',
  },
  {
    key: 'products',
    label: 'Add a product',
    why: 'Every GRN line names a SKU.',
    path: '/products',
  },
  {
    key: 'rateCard',
    label: 'Price a rate card',
    why: 'A billing run refuses to invoice stock it cannot price, so a card with no priced line is not finished.',
    path: '/rate-cards',
  },
];

/**
 * `ux-system.md` §1's guided setup. There is no onboarding-specific API and
 * deliberately so: each step is satisfied by the ordinary master endpoint,
 * and the status is *derived* from whether those records exist. Nothing to
 * get out of sync, and nothing to reset if a workspace is set up out of
 * order or skips the wizard entirely — §1 calls it guidance, not a gate.
 */
export function Onboarding() {
  const { data, isLoading } = useQuery({ queryKey: ['/onboarding'], queryFn: () => api<OnboardingStatus>('/onboarding/status') });

  return (
    <Card loading={isLoading} title={<Typography.Title level={4} style={{ margin: 0 }}>Getting set up</Typography.Title>}>
      {data?.isComplete ? (
        <Alert
          type="success"
          showIcon
          message="Setup is complete"
          description="This workspace can receive, shelve, ship and bill. Nothing here is a gate — it is only a checklist."
        />
      ) : (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="A few things left"
          description="You can use everything now; these are the records the rest of the system leans on."
        />
      )}
      <List
        itemLayout="horizontal"
        dataSource={STEPS}
        renderItem={(step) => {
          const state = data?.steps[step.key];
          const isNext = data?.nextStep === step.key;
          return (
            <List.Item
              actions={[
                <Link key="go" to={step.path}>
                  <Button type={isNext ? 'primary' : 'link'} icon={<RightOutlined />}>
                    {state?.done ? 'Review' : 'Set up'}
                  </Button>
                </Link>,
              ]}
            >
              <List.Item.Meta
                avatar={
                  state?.done ? (
                    <CheckCircleFilled style={{ color: '#52c41a', fontSize: 20 }} />
                  ) : (
                    <span style={{ display: 'inline-block', width: 20, height: 20, borderRadius: 10, border: '2px solid #d9d9d9' }} />
                  )
                }
                title={
                  <Space>
                    {step.label}
                    {state?.done && state.count > 0 && <Tag>{state.count}</Tag>}
                  </Space>
                }
                description={step.why}
              />
            </List.Item>
          );
        }}
      />
    </Card>
  );
}
