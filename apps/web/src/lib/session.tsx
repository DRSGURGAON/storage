import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, getToken, setToken } from './api';

export interface Session {
  user: { email: string; fullName: string };
  role: { code: string; name: string };
  tenant: { id: string; slug: string; legalName: string; isDemo: boolean };
  /** The caller's live grants. Presentation only -- the API re-checks. */
  permissions: string[];
}

interface SessionContextValue {
  session: Session | null;
  loading: boolean;
  signIn: (token: string) => Promise<void>;
  signOut: () => void;
  /**
   * Whether to *offer* an action. Never whether to allow one: the API
   * re-resolves the same grants on every request and is what decides
   * (saas-layer §14, "never trust the frontend"). Hiding a button the
   * server would refuse is courtesy; it is not a control.
   */
  can: (permission: string) => boolean;
  /**
   * Set when `/auth/me` could not be reached at all -- the server is down
   * or the network is gone. Distinct from "not signed in": the token is
   * still there and still good, so the answer is to try again, not to log
   * in again.
   */
  unreachable: boolean;
  retry: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * The session is read from the API (`GET /auth/me`), never decoded from the
 * JWT in the browser. The token's claims would be the same data and one
 * fetch cheaper, but they are a snapshot from login: a role change or a
 * disabled membership bites the *server* immediately (the API resolves
 * grants per request) and would not show here until the token expired. The
 * screens would then be drawn from a role the user no longer has.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setUnreachable(false);
    api<Session>('/auth/me')
      .then((loaded) => {
        setSession(loaded);
        setUnreachable(false);
      })
      .catch((error) => {
        // Only a 401 means the token is no longer good, and `api()` has
        // already discarded it and sent the browser to the login screen.
        // Anything else -- a 500, an offline moment, a request the browser
        // aborted mid-navigation -- must NOT throw the session away: doing
        // that turned every transient blip into a forced re-login, with no
        // message saying why.
        if (error instanceof ApiError && error.status === 401) {
          setSession(null);
          return;
        }
        setUnreachable(true);
      })
      .finally(() => setLoading(false));
  }, [attempt]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      loading,
      signIn: async (token: string) => {
        setToken(token);
        setSession(await api<Session>('/auth/me'));
      },
      signOut: () => {
        setToken(null);
        setSession(null);
      },
      can: (permission: string) => session?.permissions.includes(permission) ?? false,
      unreachable,
      retry: () => setAttempt((n) => n + 1),
    }),
    [session, loading, unreachable],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside a SessionProvider');
  return context;
}
