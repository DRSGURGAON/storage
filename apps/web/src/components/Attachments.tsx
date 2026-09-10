import { useEffect, useRef, useState } from 'react';
import { App, Button, Card, Empty, Image, Modal, Popconfirm, Select, Space, Tag, Typography, Upload } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, fileUrl, upload } from '../lib/api';
import { useSession } from '../lib/session';
import { dateTime, humanise } from '../lib/format';

export interface Attachment {
  id: string;
  ownerType: string;
  ownerId: string;
  category: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string | null;
  /** True for the file the record itself points at (a POD's signature, the company logo). */
  isLinked?: boolean;
}

interface AttachmentsProps {
  ownerType: string;
  ownerId: string;
  title?: string;
  /** Which categories this record's files can be filed under; the first is the default. */
  categories: string[];
  /** The permission the API will demand to attach or remove one. */
  writePermission: string;
  /** Offer the signature pad (PODs, driver acknowledgements). */
  allowSignature?: boolean;
  emptyText?: string;
  /**
   * Called after a file is attached or removed. Records whose own row
   * points at an attachment (a POD's signature, the company logo) need
   * their own query refreshed too, or the screen goes on saying "not
   * captured" next to the thing it is showing.
   */
  onChanged?: () => void;
}

const isImage = (contentType: string) => contentType.startsWith('image/');

const readableSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Blueprint §21's damage photos, §36's POD signature and §9's customer KYC
 * documents, over `POST /attachments`.
 *
 * Two details that matter on a warehouse floor. The upload input carries
 * `capture="environment"`, which on a phone opens the **camera** rather
 * than a file browser — the operator standing in front of the damaged
 * pallet photographs it there. And a thumbnail cannot be a plain
 * `<img src>`: the bytes need the bearer token, so each one is fetched
 * into a blob URL (`lib/api.ts`'s `fileUrl`) and revoked on unmount.
 */
export function Attachments({
  ownerType,
  ownerId,
  title = 'Files',
  categories,
  writePermission,
  allowSignature,
  emptyText = 'Nothing attached yet.',
  onChanged,
}: AttachmentsProps) {
  const { can } = useSession();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState(categories[0]);
  const [signing, setSigning] = useState(false);
  const canWrite = can(writePermission);
  const key = ['/attachments', ownerType, ownerId];

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api<Attachment[]>(`/attachments?ownerType=${ownerType}&ownerId=${ownerId}`),
  });

  const send = useMutation({
    mutationFn: ({ file, as, fileName }: { file: Blob; as: string; fileName: string }) => {
      const form = new FormData();
      form.append('ownerType', ownerType);
      form.append('ownerId', ownerId);
      form.append('category', as);
      form.append('file', file, fileName);
      return upload<Attachment>('/attachments', form);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      onChanged?.();
      message.success('Attached');
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Could not attach that'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      onChanged?.();
      message.success('Removed');
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Could not remove that'),
  });

  return (
    <Card
      loading={isLoading}
      title={title}
      extra={
        canWrite && (
          <Space wrap>
            {categories.length > 1 && (
              <Select
                size="small"
                value={category}
                style={{ minWidth: 150 }}
                onChange={setCategory}
                options={categories.map((c) => ({ value: c, label: humanise(c) }))}
              />
            )}
            <Upload
              accept="image/*,application/pdf"
              showUploadList={false}
              // On a phone this opens the camera rather than the gallery.
              capture="environment"
              beforeUpload={(file) => {
                send.mutate({ file, as: category, fileName: file.name });
                return Upload.LIST_IGNORE;
              }}
            >
              <Button size="small" type="primary" loading={send.isPending}>
                Add a photo or file
              </Button>
            </Upload>
            {allowSignature && (
              <Button size="small" onClick={() => setSigning(true)}>
                Capture a signature
              </Button>
            )}
          </Space>
        )
      }
    >
      {(data ?? []).length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
      ) : (
        <Space wrap size={16} align="start">
          {(data ?? []).map((attachment) => (
            <AttachmentTile
              key={attachment.id}
              attachment={attachment}
              canWrite={canWrite}
              onRemove={() => remove.mutate(attachment.id)}
            />
          ))}
        </Space>
      )}

      <SignaturePad
        open={Boolean(signing)}
        onClose={() => setSigning(false)}
        onSave={(blob) => {
          send.mutate({ file: blob, as: 'signature', fileName: 'signature.png' });
          setSigning(false);
        }}
      />
    </Card>
  );
}

function AttachmentTile({
  attachment,
  canWrite,
  onRemove,
}: {
  attachment: Attachment;
  canWrite: boolean;
  onRemove: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    fileUrl(`/attachments/${attachment.id}/file`)
      .then((objectUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        revoked = objectUrl;
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [attachment.id]);

  return (
    <Space direction="vertical" size={4} style={{ width: 160 }}>
      <div
        style={{
          width: 160,
          height: 120,
          border: '1px solid #f0f0f0',
          borderRadius: 6,
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
          background: '#fafafa',
        }}
      >
        {isImage(attachment.contentType) && url ? (
          <Image src={url} alt={attachment.fileName} style={{ maxHeight: 120, objectFit: 'contain' }} />
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12, padding: 8, textAlign: 'center' }}>
            {attachment.contentType === 'application/pdf' ? 'PDF' : humanise(attachment.contentType)}
          </Typography.Text>
        )}
      </div>
      <Space size={4} wrap>
        <Tag>{humanise(attachment.category)}</Tag>
        {attachment.isLinked && (
          <Tag color="blue" title="This is the one the record uses — a newer upload of the same kind replaces it">
            In use
          </Tag>
        )}
      </Space>
      <Typography.Text ellipsis style={{ fontSize: 12 }} title={attachment.fileName}>
        {attachment.fileName}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        {readableSize(attachment.sizeBytes)} · {attachment.uploadedBy ?? 'Unknown'} · {dateTime(attachment.uploadedAt)}
      </Typography.Text>
      <Space size={4}>
        {url && (
          <Button size="small" href={url} download={attachment.fileName}>
            Download
          </Button>
        )}
        {canWrite && (
          <Popconfirm title="Remove this file?" onConfirm={onRemove} okText="Remove" okButtonProps={{ danger: true }}>
            <Button size="small" danger>
              Remove
            </Button>
          </Popconfirm>
        )}
      </Space>
    </Space>
  );
}

/**
 * A finger or a stylus on a canvas, saved as a PNG. Pointer events rather
 * than mouse events, because the whole point is that this works on the
 * phone the delivery is being signed on.
 */
export function SignaturePad({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (blob: Blob) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [drawn, setDrawn] = useState(false);

  const context = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
    return ctx;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setDrawn(false);
  };

  // A blank canvas is transparent, which prints as nothing on a white
  // page and as black on a dark one -- so it is painted white on open.
  useEffect(() => {
    if (open) window.setTimeout(clear, 0);
  }, [open]);

  const at = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * event.currentTarget.width,
      y: ((event.clientY - rect.top) / rect.height) * event.currentTarget.height,
    };
  };

  return (
    <Modal
      open={open}
      title="Signature"
      onCancel={onClose}
      okText="Save the signature"
      okButtonProps={{ disabled: !drawn }}
      onOk={() =>
        canvasRef.current?.toBlob((blob) => {
          if (blob) onSave(blob);
        }, 'image/png')
      }
      footer={(_, { OkBtn, CancelBtn }) => (
        <Space>
          <Button onClick={clear}>Clear</Button>
          <CancelBtn />
          <OkBtn />
        </Space>
      )}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        Sign inside the box with a finger or a stylus.
      </Typography.Paragraph>
      <canvas
        ref={canvasRef}
        width={600}
        height={220}
        style={{ width: '100%', height: 220, border: '1px dashed #d9d9d9', borderRadius: 6, touchAction: 'none' }}
        onPointerDown={(event) => {
          const ctx = context();
          if (!ctx) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = true;
          setDrawn(true);
          const { x, y } = at(event);
          ctx.beginPath();
          ctx.moveTo(x, y);
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const ctx = context();
          if (!ctx) return;
          const { x, y } = at(event);
          ctx.lineTo(x, y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
        onPointerLeave={() => {
          drawing.current = false;
        }}
      />
    </Modal>
  );
}
