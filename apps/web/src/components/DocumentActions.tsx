import { useState } from 'react';
import { App, Button, Space, Tooltip } from 'antd';
import { FilePdfOutlined, LinkOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, getToken } from '../lib/api';
import { useSession } from '../lib/session';
import { usePaywall } from './Paywall';

interface DocumentActionsProps {
  /** The source record's own path, e.g. `/grns/7f3…`. */
  basePath: string;
  /** The permission the source's own controller requires to generate. */
  permission: string;
  /** Disabled with a reason when the record is not far enough along. */
  disabledReason?: string;
}

interface CommittedDocument {
  id: string;
  documentNumber: string;
  versionNo: number;
  /** What this generation spent, when it spent anything (ux-system.md §12). */
  entitlement: {
    featureName: string;
    planName: string | null;
    limit: number | null;
    used: number;
    remaining: number | null;
  } | null;
}

/**
 * Generate a record's document, then open it.
 *
 * Opening goes through a **signed link** rather than the authenticated
 * download: a new tab carries no Authorization header, so fetching the PDF
 * as a blob and revoking an object URL would be the alternative -- and that
 * loses the filename, the browser's own PDF viewer, and the ability to
 * forward what you are looking at. The link expires in minutes and names
 * one document (`tenancy-and-security.md` §5).
 *
 * A 402 is not an error here. It is the entitlement paywall
 * (`ux-system.md` §11): `usePaywall` raises the upgrade prompt, which is
 * built from the 402's own body -- which feature ran out, on which plan,
 * and what a larger plan would allow.
 *
 * A success can be worth saying something about too. §12 allows a nudge
 * at exactly two moments -- after the first use of a lifetime-limited
 * feature and at the limit -- and nowhere else, so a workspace on an
 * unmetered plan never sees one, and one on the free plan is told before
 * the block rather than by it.
 */
/**
 * §12 again, in one function: a nudge on the first unit spent and on the
 * last one, and silence in between. "3 of 12 used" every time is how a
 * usage figure becomes noise people stop reading -- which matters most on
 * the one occasion it is about to block them.
 */
function usageNudge(entitlement: CommittedDocument['entitlement']): string | null {
  if (!entitlement || entitlement.limit === null) return null;
  const { used, limit, featureName, planName } = entitlement;
  const plan = planName ? `${planName} plan` : 'plan';
  if (entitlement.remaining === 0) {
    return `${used} of ${limit} free ${featureName.toLowerCase()} copies used — that was the last one on the ${plan}.`;
  }
  if (used === 1) {
    return `1 of ${limit} free ${featureName.toLowerCase()} copies used on the ${plan}.`;
  }
  return null;
}

export function DocumentActions({ basePath, permission, disabledReason }: DocumentActionsProps) {
  const { can } = useSession();
  const { message } = App.useApp();
  const { showPaywall } = usePaywall();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  if (!can(permission)) return null;

  const open = async (documentId: string) => {
    const link = await api<{ url: string }>(`/documents/${documentId}/download-link`, { method: 'POST' });
    window.open(link.url, '_blank', 'noopener');
  };

  const generate = async () => {
    setBusy(true);
    try {
      const committed = await api<CommittedDocument>(`${basePath}/document`, { method: 'POST', body: {} });
      await queryClient.invalidateQueries({ queryKey: ['/documents'] });
      message.success(`${committed.documentNumber} ready`);
      const nudge = usageNudge(committed.entitlement);
      if (nudge) message.info(nudge, 6);
      await open(committed.id);
    } catch (error) {
      if (showPaywall(error)) return;
      message.error(error instanceof ApiError ? error.message : 'Could not generate the document');
    } finally {
      setBusy(false);
    }
  };

  const button = (
    <Button icon={<FilePdfOutlined />} loading={busy} disabled={Boolean(disabledReason)} onClick={generate}>
      Generate document
    </Button>
  );

  return <Space>{disabledReason ? <Tooltip title={disabledReason}>{button}</Tooltip> : button}</Space>;
}

/**
 * Opens an already-committed document through a fresh signed link.
 *
 * `portal` picks the portal's own minting route. It is not cosmetic: the
 * claims minted there carry this customer, so a link a customer forwards
 * to their accountant stays scoped to them even though the token itself
 * is a bearer credential.
 */
export function OpenDocumentButton({
  documentId,
  label = 'Open',
  portal,
}: {
  documentId: string;
  label?: string;
  portal?: boolean;
}) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="small"
      icon={<LinkOutlined />}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const path = portal
            ? `/portal/documents/${documentId}/download-link`
            : `/documents/${documentId}/download-link`;
          const link = await api<{ url: string }>(path, { method: 'POST' });
          window.open(link.url, '_blank', 'noopener');
        } catch (error) {
          message.error(error instanceof ApiError ? error.message : 'Could not open the document');
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}

/** True when a token exists at all -- used to avoid opening a link that will bounce. */
export function isSignedIn(): boolean {
  return Boolean(getToken());
}
