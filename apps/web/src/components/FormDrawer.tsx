import { useState, type ReactNode } from 'react';
import { App, Button, Drawer, Form, Space } from 'antd';
import type { FormInstance } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';

interface FormDrawerProps<T> {
  open: boolean;
  title: string;
  /** Where to POST (create) or PATCH (edit). */
  path: string;
  method?: 'POST' | 'PATCH';
  initialValues?: Record<string, unknown>;
  /** Cache keys to invalidate on success; the list path is usually enough. */
  invalidate: string[];
  width?: number;
  onClose: () => void;
  onSaved?: (saved: T) => void;
  children: (form: FormInstance) => ReactNode;
  /** Last chance to shape the payload -- strip blanks, coerce numbers. */
  transform?: (values: Record<string, unknown>) => unknown;
}

/**
 * Create and edit, in one drawer.
 *
 * Two things it does that are easy to get wrong. It **shows the API's own
 * error** rather than a generic one -- the server's message is the thing
 * worth reading. And it strips `undefined`/`''` before sending, because
 * the API's DTOs use `forbidNonWhitelisted` with optional fields: an empty
 * string sent for an untouched optional GSTIN is a validation failure, not
 * an omission.
 */
export function FormDrawer<T>({
  open,
  title,
  path,
  method = 'POST',
  initialValues,
  invalidate,
  width = 520,
  onClose,
  onSaved,
  children,
  transform,
}: FormDrawerProps<T>) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const { message } = App.useApp();


  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const body = transform ? transform(values) : prune(values);
      const saved = await api<T>(path, { method, body });
      for (const key of invalidate) await queryClient.invalidateQueries({ queryKey: [key] });
      message.success('Saved');
      onSaved?.(saved);
      onClose();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      title={title}
      width={width}
      onClose={onClose}
      destroyOnClose
      // Fields are set once the drawer's contents have actually mounted.
      // Setting them from an effect on `open` runs a tick too early --
      // `destroyOnClose` means the Form does not exist yet, and antd warns
      // that the useForm instance is connected to nothing.
      afterOpenChange={(opened) => {
        if (opened) form.setFieldsValue(initialValues ?? {});
        else form.resetFields();
      }}
      extra={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={saving} onClick={submit}>
            Save
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" onFinish={submit}>
        {children(form)}
      </Form>
    </Drawer>
  );
}

/** Drops what the user never filled in, so an optional field stays optional. */
export function prune(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== '' && value !== null),
  );
}
