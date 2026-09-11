import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { Card, Field } from '../components/ui';

/**
 * Signing up is four fields and no card.
 *
 * The workspace URL is derived from the business name rather than asked
 * for: it is a technical detail the person filling this in has no opinion
 * about, and every field on a signup form is somebody deciding not to
 * bother. They can still edit it if the derived one is taken.
 */
export function Signup() {
  const { signIn } = useSession();
  const [company, setCompany] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveSlug = slugTouched ? slug : slugify(company);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ accessToken: string }>('/auth/signup', {
        method: 'POST',
        body: {
          companyLegalName: company.trim(),
          tenantSlug: effectiveSlug,
          fullName: fullName.trim(),
          email: email.trim(),
          password,
          // Which price list this workspace belongs on. Sent by the app
          // rather than asked on a screen -- somebody signing up from a
          // household storage app has already answered the question.
          product: 'storage',
        },
      });
      await signIn(res.accessToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the workspace');
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="login-mark">SB</div>
          <div>
            <h1>Start free</h1>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>
              Three customers in storage, free forever. No card.
            </p>
          </div>
        </div>

        <Card>
          <form className="card-body" onSubmit={submit}>
            <Field label="Business name">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  autoFocus
                  placeholder="Gurgaon Safe Storage"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label="Your name">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label="Email">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label="Password" hint="At least 8 characters.">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label="Workspace address" hint="Lowercase letters, digits and hyphens.">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  value={effectiveSlug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(slugify(e.target.value));
                  }}
                  required
                />
              )}
            </Field>

            {error ? <div className="notice danger">{error}</div> : null}
            <button className="btn primary block" type="submit" disabled={busy || !effectiveSlug}>
              {busy ? 'Creating…' : 'Create my workspace'}
            </button>
          </form>
        </Card>

        <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
          Already have a workspace? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

/** Matches the API's own rule: lowercase letters, digits, single hyphens. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40);
}
