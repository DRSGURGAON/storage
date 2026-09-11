import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { Card, Field } from '../components/ui';

export function Login() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        body: { email: email.trim(), password },
      });
      await signIn(res.accessToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in');
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="login-mark">SB</div>
          <div>
            <h1>Storage Book</h1>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>Household goods storage, end to end</p>
          </div>
        </div>

        <Card>
          <form className="card-body" onSubmit={submit}>
            <Field label="Email">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  type="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label="Password">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              )}
            </Field>
            {error ? <div className="notice danger">{error}</div> : null}
            <button className="btn primary block" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </Card>

        <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
          Forgot your password? Ask the owner of your workspace to set a new one.
        </p>
      </div>
    </div>
  );
}
