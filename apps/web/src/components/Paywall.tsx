import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Alert, Button, List, Modal, Progress, Space, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, type PaywallBody } from '../lib/api';
import { useSession } from '../lib/session';

const { Paragraph, Text } = Typography;

interface UpgradeOption {
  code: string;
  name: string;
  description: string | null;
  trialDays: number;
  priceMonthly: number | null;
  priceYearly: number | null;
  currency: string;
  limitType: string;
  limit: number | null;
}

interface UpgradeOptions {
  feature: { code: string; name: string; module: string; limitKind: 'resource' | 'consumable' };
  current: {
    planCode: string | null;
    planName: string | null;
    limitType: string;
    limit: number | null;
    used: number;
    remaining: number | null;
  };
  options: UpgradeOption[];
}

interface PaywallApi {
  /**
   * Shows the upgrade prompt if this error is a 402, and says whether it
   * did -- so a caller's catch block is `if (showPaywall(error)) return;`
   * followed by its own ordinary error handling.
   */
  showPaywall: (error: unknown) => boolean;
}

const PaywallContext = createContext<PaywallApi>({ showPaywall: () => false });

export function usePaywall(): PaywallApi {
  return useContext(PaywallContext);
}

/**
 * `ux-system.md` §11's upgrade prompt, in one place because §11 says so:
 * "Never a bare 'Payment required' dialog. Fixed structure: a
 * value-forward headline, a short checklist of what unlocking buys, and
 * two actions."
 *
 * Every part of it is server data. The headline sentence is the 402's own
 * `message` (built from `feature_keys.name` and the tenant's plan); the
 * checklist is `GET /plan/upgrade/:featureCode`, which reads the same
 * `plan_feature_limits` rows the entitlement engine enforces. Nothing here
 * is hand-written copy about the product, because the screen that asks
 * someone to pay is the last place a promise should be able to drift from
 * what the code actually allows.
 */
export function PaywallProvider({ children }: { children: ReactNode }) {
  const [paywall, setPaywall] = useState<PaywallBody | null>(null);

  const showPaywall = useCallback((error: unknown) => {
    const body = error instanceof ApiError ? error.paywall : null;
    if (!body) return false;
    setPaywall(body);
    return true;
  }, []);

  const value = useMemo(() => ({ showPaywall }), [showPaywall]);

  return (
    <PaywallContext.Provider value={value}>
      {children}
      <PaywallModal paywall={paywall} onClose={() => setPaywall(null)} />
    </PaywallContext.Provider>
  );
}

function PaywallModal({ paywall, onClose }: { paywall: PaywallBody | null; onClose: () => void }) {
  const navigate = useNavigate();
  const { can } = useSession();
  // The person who runs into a limit is often not the person allowed to
  // see the plan -- an operator generating a GRN, an owner holding the
  // billing. Asking for the upgrade options as them would be a 403 in the
  // console and an empty list on screen, so it is not asked at all.
  const maySeePlan = can('view_plan_usage');
  const { data, isLoading } = useQuery({
    queryKey: ['/plan/upgrade', paywall?.featureCode],
    queryFn: () => api<UpgradeOptions>(`/plan/upgrade/${paywall!.featureCode}`),
    enabled: Boolean(paywall && maySeePlan),
  });

  if (!paywall) return null;
  const used = paywall.used;
  const limit = paywall.limit;
  const noun = paywall.featureName.toLowerCase();
  const heldNotSpent = paywall.limitKind === 'resource';

  return (
    <Modal
      open
      onCancel={onClose}
      title={
        heldNotSpent
          ? `${paywall.featureName} — plan limit reached`
          : `${paywall.featureName} — free copies used up`
      }
      width={520}
      // §64's phone pass: antd's `width` is a fixed pixel width, so a 520px
      // modal is 130px wider than the screen it is being read on. The cap
      // is on the modal itself, not the wrapper -- the wrapper is already
      // full-width and clamping it moves the overflow rather than removing it.
      style={{ maxWidth: 'calc(100vw - 32px)', top: 24 }}
      footer={[
        <Button key="dismiss" onClick={onClose}>
          Continue exploring
        </Button>,
        maySeePlan ? (
          <Button
            key="plans"
            type="primary"
            onClick={() => {
              onClose();
              navigate('/settings/plan');
            }}
          >
            {/*
              §11 names this action "View Plans", and it says that while
              assuming there are plans to view. There are four now, but a
              feature already unlimited on every one of them has no upgrade
              to offer, and a button promising otherwise would be answered
              by the page it opens.
            */}
            {data && data.options.length === 0 ? 'See plan & usage' : 'View plans'}
          </Button>
        ) : null,
      ]}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Paragraph style={{ marginBottom: 0 }}>{paywall.message}</Paragraph>
        {limit !== null && (
          <Progress
            percent={Math.min(100, Math.round((used / Math.max(limit, 1)) * 100))}
            format={() => `${used} of ${limit}`}
            status="exception"
          />
        )}
        {/*
          The reassurance has to be true of the thing that was blocked. A
          godown is not a copy that was spent: the way out of this limit
          without paying is to close one you no longer operate, and saying
          so is more useful than promising that nothing was lost.
        */}
        {heldNotSpent ? (
          <Alert
            type="info"
            showIcon
            message={`Closing a ${noun} frees its slot`}
            description={`Your plan counts the ${noun}s that are open. Close one you no longer operate and the slot comes back straight away — its stock history, receipts and documents stay exactly where they are.`}
          />
        ) : (
          <Alert
            type="info"
            showIcon
            message="Nothing you have already made is affected"
            description="Documents you generated stay where they are, and you can open, re-open and re-print every one of them. This limit is only on generating a copy of something new."
          />
        )}
        {maySeePlan && !isLoading && data && <WhatUnlockingBuys data={data} />}
        {!maySeePlan && (
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            An Owner or Admin of this workspace can see the plan and what it allows.
          </Paragraph>
        )}
      </Space>
    </Modal>
  );
}

/**
 * §11's "short checklist of what unlocking buys" -- or, when there is
 * honestly nothing to sell yet, the truth instead.
 *
 * Four plans ship (Free, Starter, Growth, Scale), but a feature can still
 * have nothing above it -- everything except godowns is unlimited from
 * Starter up, so a workspace already on Scale has no larger allowance to
 * be sold. Upgrades are arranged with the vendor rather than bought in-app
 * (`v1-scope-specification.md` §12, `DECISIONS.md` §13: no gateway is
 * chosen), and a prompt that invented a tier above the real ones would be
 * the one lie in the product a customer is guaranteed to test.
 */
function WhatUnlockingBuys({ data }: { data: UpgradeOptions }) {
  if (data.options.length === 0) {
    return (
      <Alert
        type="warning"
        showIcon
        message="There is no self-serve upgrade yet"
        description={`${data.current.planName ?? 'This workspace'} already allows as much of this as any plan we publish. If you need more, ask us directly — nothing is charged from inside the app.`}
      />
    );
  }
  return (
    <List
      size="small"
      header={<Text strong>What a larger plan gives you</Text>}
      dataSource={data.options}
      renderItem={(option) => (
        <List.Item>
          <List.Item.Meta
            title={
              <Space wrap>
                <Text strong>{option.name}</Text>
                {option.priceMonthly !== null && (
                  <Text type="secondary">
                    {option.currency} {option.priceMonthly.toLocaleString()}/month
                  </Text>
                )}
                {option.trialDays > 0 && <Tag color="green">{option.trialDays}-day trial</Tag>}
              </Space>
            }
            description={
              option.limitType === 'unlimited'
                ? `Unlimited ${data.feature.name.toLowerCase()}`
                : data.feature.limitKind === 'resource'
                  ? `${option.limit} ${data.feature.name.toLowerCase()}s instead of ${data.current.limit ?? 0}`
                  : `${option.limit} copies instead of ${data.current.limit ?? 0}`
            }
          />
        </List.Item>
      )}
    />
  );
}
