import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Tabs, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';

interface TokenResponse {
  accessToken: string;
}

/**
 * Sign in, and sign up a new workspace. One screen rather than two: they
 * are the same decision seen from either side, and a warehouse operator
 * arriving at the wrong one should not have to hunt for a link.
 *
 * `tenantSlug` is optional on login and only consulted when the account
 * belongs to more than one workspace -- the API says so in its own words
 * when it needs it, and this shows that message rather than pre-empting it
 * with a workspace picker the single-tenant majority would have to ignore.
 */
export function Login() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (path: string, body: unknown) => {
    setError(null);
    setBusy(true);
    try {
      const { accessToken } = await api<TokenResponse>(path, { method: 'POST', body });
      await signIn(accessToken);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f5f5f5', padding: 16 }}>
      {/* 440 is the shape on a laptop; on a phone the screen is narrower than
          that, and a fixed width there pushes the whole page sideways. */}
      <Card style={{ width: '100%', maxWidth: 440, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          Warehouse Operations
        </Typography.Title>
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
        <Tabs
          items={[
            {
              key: 'login',
              label: 'Sign in',
              children: (
                <Form layout="vertical" onFinish={(values) => run('/auth/login', values)} disabled={busy}>
                  <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
                    <Input autoComplete="username" placeholder="you@company.com" />
                  </Form.Item>
                  <Form.Item name="password" label="Password" rules={[{ required: true }]}>
                    <Input.Password autoComplete="current-password" />
                  </Form.Item>
                  <Form.Item
                    name="tenantSlug"
                    label="Workspace"
                    tooltip="Only needed if this account belongs to more than one workspace"
                  >
                    <Input placeholder="optional" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={busy}>
                    Sign in
                  </Button>
                </Form>
              ),
            },
            {
              key: 'signup',
              label: 'Create a workspace',
              children: (
                <Form layout="vertical" onFinish={(values) => run('/auth/signup', values)} disabled={busy}>
                  <Form.Item name="companyLegalName" label="Company legal name" rules={[{ required: true, min: 2 }]}>
                    <Input placeholder="Acme Warehousing Pvt Ltd" />
                  </Form.Item>
                  <Form.Item
                    name="tenantSlug"
                    label="Workspace address"
                    rules={[{ required: true }, { pattern: /^[a-z0-9-]+$/, message: 'Lowercase letters, numbers and hyphens' }]}
                  >
                    <Input placeholder="acme-warehousing" />
                  </Form.Item>
                  <Form.Item name="fullName" label="Your name" rules={[{ required: true, min: 2 }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
                    <Input autoComplete="username" />
                  </Form.Item>
                  <Form.Item
                    name="password"
                    label="Password"
                    rules={[{ required: true, min: 8, message: 'At least 8 characters' }]}
                  >
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={busy}>
                    Create workspace
                  </Button>
                </Form>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
