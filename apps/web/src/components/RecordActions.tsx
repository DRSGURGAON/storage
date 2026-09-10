import { useState } from 'react';
import { App, Button, Input, Space } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';

export interface RecordAction {
  label: string;
  /** Appended to the record path, e.g. `submit` → POST /grns/:id/submit. */
  action: string;
  permission?: string;
  /** Statuses this action is offered from. Omit to always offer it. */
  from?: string[];
  danger?: boolean;
  primary?: boolean;
  /** Prompts for a reason and sends it as `{ reason }`. */
  needsReason?: boolean;
  /** Extra confirmation before firing. */
  confirm?: string;
}

interface RecordActionsProps {
  basePath: string;
  id: string;
  status: string | undefined;
  actions: RecordAction[];
  /** Cache keys to refresh after a successful action. */
  invalidate: string[];
}

/**
 * `workflow-and-statuses.md` §2's smart actions: what a record offers is
 * computed from its current status, not from a fixed button row.
 *
 * Both filters here are courtesy. The status filter mirrors the service's
 * `transition(..., allowedFrom, ...)` and the permission filter mirrors
 * `@RequirePermission`; the API applies both again and its refusal is what
 * decides. Duplicating them buys the user a screen that does not offer
 * "Approve" on a draft, which is worth more than the duplication costs --
 * but the moment the two disagree, the server is right.
 */
export function RecordActions({ basePath, id, status, actions, invalidate }: RecordActionsProps) {
  const { can } = useSession();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (action: RecordAction, reason?: string) => {
    setBusy(action.action);
    try {
      await api(`${basePath}/${id}/${action.action}`, {
        method: 'POST',
        body: reason ? { reason } : {},
      });
      for (const key of invalidate) await queryClient.invalidateQueries({ queryKey: [key] });
      message.success(`${action.label} done`);
    } catch (error) {
      // The API's refusals are specific and worth reading in full: "A GRN
      // can only be approved from checked", "Only 30 of that product is
      // available". Truncating them into "Action failed" would be throwing
      // away the explanation.
      message.error(error instanceof ApiError ? error.message : `Could not ${action.label.toLowerCase()}`);
    } finally {
      setBusy(null);
    }
  };

  const start = (action: RecordAction) => {
    if (action.needsReason) {
      let reason = '';
      modal.confirm({
        title: action.label,
        content: (
          <ReasonInput
            onChange={(value) => {
              reason = value;
            }}
          />
        ),
        okText: action.label,
        okButtonProps: { danger: action.danger },
        onOk: async () => {
          if (!reason.trim()) {
            message.error('A reason is required');
            throw new Error('reason required');
          }
          await run(action, reason);
        },
      });
      return;
    }
    if (action.confirm) {
      modal.confirm({
        title: action.label,
        content: action.confirm,
        okText: action.label,
        okButtonProps: { danger: action.danger },
        onOk: () => run(action),
      });
      return;
    }
    void run(action);
  };

  const offered = actions.filter(
    (action) =>
      (!action.permission || can(action.permission)) && (!action.from || (status ? action.from.includes(status) : false)),
  );

  if (offered.length === 0) return null;

  return (
    <Space wrap>
      {offered.map((action) => (
        <Button
          key={action.action}
          type={action.primary ? 'primary' : 'default'}
          danger={action.danger}
          loading={busy === action.action}
          onClick={() => start(action)}
        >
          {action.label}
        </Button>
      ))}
    </Space>
  );
}

function ReasonInput({ onChange }: { onChange: (value: string) => void }) {
  return (
    <Input.TextArea
      rows={3}
      style={{ marginTop: 8 }}
      placeholder="Why?"
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
