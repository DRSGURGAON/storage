import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';

export interface Session {
  user: { email: string; fullName: string };
  role: { code: string; name: string };
  tenant: { id: string; slug: string; legalName: string; isDemo: boolean };
  permissions: string[];
}

interface SessionValue {
  session: Session | null;
  loading: boolean;
  signIn: (token: string) => Promise<void>;
  signOut: () => void;
  /**
   * Whether to *offer* an action -- never whether to allow one. The API
   * re-resolves the same grants on every request and is what decides; this
   * only keeps a button off the screen that would collect a 403.
   */
  can: (permission: string) => boolean;
}

const Ctx = createContext<SessionValue>({
  session: null,
  loading: true,
  signIn: async () => {},
  signOut: () => {},
  can: () => false,
});

export function useSession(): SessionValue {
  return useContext(Ctx);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!getToken()) {
      setSession(null);
      setLoading(false);
      return;
    }
    try {
      setSession(await api<Session>('/auth/me'));
    } catch {
      setToken(null);
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo<SessionValue>(
    () => ({
      session,
      loading,
      signIn: async (token: string) => {
        setToken(token);
        setLoading(true);
        await load();
      },
      signOut: () => {
        setToken(null);
        setSession(null);
      },
      can: (permission: string) => session?.permissions.includes(permission) ?? false,
    }),
    [session, loading, load],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
