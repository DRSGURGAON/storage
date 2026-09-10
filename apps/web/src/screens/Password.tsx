import { useState } from 'react';
import { Alert, App, Button, Card, Divider, Form, Input, Modal, Result, Space, Typography } from 'antd';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';

/** The card the two anonymous password screens share with the login screen. */
function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f5f5f5', padding: 16 }}>
      <Card style={{ width: '100%', maxWidth: 440, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          {title}
        </Typography.Title>
        {children}
      </Card>
    </div>
  );
}

/**
 * "I have forgotten my password."
 *
 * The screen says the same thing whether or not the address has an
 * account, because the API does: anything else turns this page into a way
 * to find out who is registered. Which means the confirmation has to be
 * written carefully -- "if that email has an account" is not hedging, it
 * is the only honest sentence available.
 */
export function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent) {
    return (
      <AuthCard title="Check your email">
        <Result
          status="success"
          title="If that email has an account, a reset link is on its way"
          subTitle="The link works once and expires in an hour. If nothing arrives, an Owner of your workspace can set a new password for you from Settings → Users."
          extra={<Link to="/login">Back to sign in</Link>}
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password">
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Form
        layout="vertical"
        disabled={busy}
        onFinish={async (values: { email: string }) => {
          setBusy(true);
          setError(null);
          try {
            await api('/auth/forgot-password', { method: 'POST', body: values });
            setSent(true);
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not reach the server');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
          <Input autoComplete="username" placeholder="you@company.com" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={busy}>
          Send the link
        </Button>
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <Link to="/login">Back to sign in</Link>
        </div>
      </Form>
    </AuthCard>
  );
}

/** The other end of the emailed link. */
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <AuthCard title="Reset your password">
        <Result
          status="warning"
          title="This link is incomplete"
          subTitle="Open the link from the email exactly as it was sent, or ask for a new one."
          extra={<Link to="/forgot-password">Ask for a new link</Link>}
        />
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard title="Password changed">
        <Result
          status="success"
          title="You can sign in with the new password"
          // Said out loud because it is surprising on any other device the
          // person was using: changing a password ends every session it had.
          subTitle="Anywhere this account was already signed in has been signed out."
          extra={
            <Button type="primary" onClick={() => navigate('/login')}>
              Sign in
            </Button>
          }
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password">
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Form
        layout="vertical"
        disabled={busy}
        onFinish={async (values: { newPassword: string }) => {
          setBusy(true);
          setError(null);
          try {
            await api('/auth/reset-password', { method: 'POST', body: { token, newPassword: values.newPassword } });
            setDone(true);
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not reach the server');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Form.Item
          name="newPassword"
          label="New password"
          rules={[{ required: true, min: 8, message: 'At least 8 characters' }]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="New password again"
          dependencies={['newPassword']}
          rules={[
            { required: true },
            // Typed twice because there is no way back from a typo here:
            // the link is single-use, so a mistyped password means asking
            // for another email.
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                !value || value === getFieldValue('newPassword')
                  ? Promise.resolve()
                  : Promise.reject(new Error('The two passwords do not match')),
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={busy}>
          Set the password
        </Button>
      </Form>
    </AuthCard>
  );
}

/**
 * Settings → Your account. The only screen here that is about the person
 * rather than the workspace, which is why it is its own page rather than a
 * card on Company.
 */
export function AccountSettings() {
  const { session, signOut } = useSession();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);

  return (
    <Card title="Your account" style={{ maxWidth: 560 }}>
      <Typography.Paragraph type="secondary">
        Signed in as <strong>{session?.user.email}</strong> ({session?.role.name}).
      </Typography.Paragraph>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Changing your password signs you out everywhere"
        description="Including this browser — you will be asked to sign in again with the new password. That is what makes a password change worth doing after someone else has seen it."
      />
      <Form
        form={form}
        layout="vertical"
        disabled={busy}
        onFinish={async (values: { currentPassword: string; newPassword: string }) => {
          setBusy(true);
          try {
            // Only the two fields, never `values` -- the form also holds
            // `confirm`, and the API validates with `forbidNonWhitelisted`,
            // so passing the form's values straight through is a 400 that
            // reads to the user like a wrong password. (It was, first run.)
            await api('/auth/change-password', {
              method: 'POST',
              body: { currentPassword: values.currentPassword, newPassword: values.newPassword },
            });
            message.success('Password changed — sign in again');
            // The token in this tab is dead the moment the API returns, so
            // the session is dropped here rather than left to fail on the
            // next request with something that reads like a bug.
            signOut();
            navigate('/login');
          } catch (err) {
            message.error(err instanceof ApiError ? err.message : 'Could not change the password');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Form.Item name="currentPassword" label="Current password" rules={[{ required: true }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="New password"
          rules={[{ required: true, min: 8, message: 'At least 8 characters' }]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="New password again"
          dependencies={['newPassword']}
          rules={[
            { required: true },
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                !value || value === getFieldValue('newPassword')
                  ? Promise.resolve()
                  : Promise.reject(new Error('The two passwords do not match')),
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={busy}>
          Change password
        </Button>
      </Form>

      <Divider />
      <DeleteAccount />
    </Card>
  );
}

/**
 * Deleting your own account, which Google Play requires any app that lets
 * one be created to offer from inside the app.
 *
 * The copy is the honest version rather than the reassuring one: the
 * sign-in goes, the work does not. A warehouse is legally required to keep
 * the receipts and invoices someone's name is on, and saying "everything
 * will be deleted" would be a promise the product breaks the moment a tax
 * inspector asks the operator for records.
 */
function DeleteAccount() {
  const { signOut } = useSession();
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();

  return (
    <>
      <Typography.Title level={5}>Delete your account</Typography.Title>
      <Typography.Paragraph type="secondary">
        Your sign-in is removed and every session ends immediately. Work you did — receipts you
        booked, dispatches you released, invoices you issued — stays with the workspace, which is
        required to keep it, with your name replaced by “Deleted user”.
      </Typography.Paragraph>
      <Button danger onClick={() => setOpen(true)}>
        Delete my account
      </Button>

      <Modal
        open={open}
        title="Delete your account"
        okText="Delete my account"
        okButtonProps={{ danger: true, loading: busy }}
        onCancel={() => setOpen(false)}
        style={{ maxWidth: 'calc(100vw - 32px)' }}
        onOk={async () => {
          // See the same guard on Settings' close-workspace modal: an async
          // `onOk` that lets antd's validation rejection escape reports it
          // to the window as an unhandled error.
          let values: { currentPassword: string };
          try {
            values = await form.validateFields();
          } catch {
            return;
          }
          setBusy(true);
          try {
            const result = await api<{ workspaces: number; message: string }>('/auth/delete-account', {
              method: 'POST',
              body: { currentPassword: values.currentPassword },
            });
            setOpen(false);
            signOut();
            navigate('/login');
            // A plain toast is too small for the last thing this account
            // will ever be told.
            modal.info({ title: 'Your account has been deleted', content: result.message });
          } catch (error) {
            message.error(error instanceof ApiError ? error.message : 'Could not delete the account');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            type="error"
            showIcon
            message="This cannot be undone"
            description="You will not be able to sign in again, and the same email cannot be reused for a new account."
          />
          <Form form={form} layout="vertical">
            <Form.Item
              name="currentPassword"
              label="Your password, to confirm it is you"
              rules={[{ required: true }]}
            >
              <Input.Password autoComplete="current-password" />
            </Form.Item>
          </Form>
        </Space>
      </Modal>
    </>
  );
}
