const TOKEN_KEY = 'storage.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* a private window with storage blocked still gets a working session for this tab */
  }
}

export interface PaywallBody {
  paywall: true;
  message: string;
  featureCode: string;
  featureName: string;
  limitKind: 'resource' | 'consumable';
  planCode: string | null;
  planName: string | null;
  limit: number | null;
  used: number;
  remaining: number | null;
  upgradeRequired: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** 402: the plan does not stretch this far, and the body says how far it does. */
  get paywall(): PaywallBody | null {
    const body = this.body as PaywallBody | null;
    return this.status === 402 && body?.paywall === true ? body : null;
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Every call goes through here so three things are decided once: the token
 * is attached, the API's own error message is what surfaces (never
 * "Request failed"), and a dead session logs out rather than leaving the
 * screen half-loaded.
 */
export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = text ? safeJson(text) : null;

  if (!res.ok) {
    if (res.status === 401) {
      setToken(null);
      // A stale token on a screen that keeps polling would otherwise loop
      // forever; sending the operator back to the login screen is honest.
      if (!location.pathname.startsWith('/login')) location.assign('/login');
    }
    throw new ApiError(res.status, messageOf(body) ?? `Something went wrong (${res.status})`, body);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageOf(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  // class-validator returns an array of messages; the first is the one a
  // person can act on.
  if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  return null;
}
