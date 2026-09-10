import { useState } from 'react';
import { App, Button, Space, Tooltip } from 'antd';
import { FilePdfOutlined, LinkOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, getToken } from '../lib/api';
import { useSession } from '../lib/session';

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
 * (`ux-system.md` §11), and it says which feature ran out; passing the
 * API's message straight through says "You have used both free GRN copies"
 * rather than "Request failed".
 */
export function DocumentActions({ basePath, permission, disabledReason }: DocumentActionsProps) {
  const { can } = useSession();
  const { message, modal } = App.useApp();
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
      await open(committed.id);
    } catch (error) {
      if (error instanceof ApiError && error.isPaywall) {
        modal.info({
          title: 'Free copies used up',
          content: error.message,
          okText: 'See plans',
        });
      } else {
        message.error(error instanceof ApiError ? error.message : 'Could not generate the document');
      }
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

/** Opens an already-committed document through a fresh signed link. */
export function OpenDocumentButton({ documentId, label = 'Open' }: { documentId: string; label?: string }) {
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
          const link = await api<{ url: string }>(`/documents/${documentId}/download-link`, { method: 'POST' });
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
