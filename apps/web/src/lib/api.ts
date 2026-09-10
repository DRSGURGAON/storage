/**
 * The one place this app talks to the API.
 *
 * Everything goes through `api()`: it attaches the bearer token, unwraps
 * JSON, and turns a non-2xx into an `ApiError` carrying the server's own
 * message. That last part matters more than it looks — the API says useful,
 * specific things ("Only 30 of that product is available to return on this
 * dispatch", "A workspace must keep at least one active Owner"), and a
 * client that replaces those with "Something went wrong" throws away the
 * most valuable thing it was given.
 */
const TOKEN_KEY = 'warehouse.token';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }

  /** 402 is the entitlement paywall (`ux-system.md` §11), not a generic failure. */
  get isPaywall(): boolean {
    return this.status === 402;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

const BASE = import.meta.env.VITE_API_URL ?? '/api';

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const token = getToken();
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed = text ? safeJson(text) : null;
  if (!response.ok) {
    // Nest's exception filter puts the useful sentence in `message`, which is
    // a string for most errors and an array for a failed ValidationPipe.
    const raw = (parsed as { message?: string | string[] } | null)?.message;
    const message = Array.isArray(raw) ? raw.join('; ') : (raw ?? `Request failed (${response.status})`);
    // A dead or expired token is not an error the user can act on -- send
    // them to the login screen rather than showing them a 401.
    if (response.status === 401 && token) {
      setToken(null);
      window.location.assign('/login');
    }
    throw new ApiError(response.status, message, parsed);
  }
  return parsed as T;
}

/**
 * Multipart upload. Separate from `api()` because the two disagree on one
 * thing: the browser has to set `content-type` itself here, so it can add
 * the multipart boundary. Setting it by hand produces a body the server
 * cannot parse, with no error that says so.
 */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  const token = getToken();
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const text = await response.text();
  const parsed = text ? safeJson(text) : null;
  if (!response.ok) {
    const raw = (parsed as { message?: string | string[] } | null)?.message;
    const message = Array.isArray(raw) ? raw.join('; ') : (raw ?? `Upload failed (${response.status})`);
    throw new ApiError(response.status, message, parsed);
  }
  return parsed as T;
}

/**
 * The bytes of a file, as a blob URL the browser can put in an `<img>` or
 * an `<a>`. A plain `src="/api/attachments/..."` would not carry the
 * bearer token, so the fetch happens here and the caller gets a URL that
 * needs no headers. Callers must `URL.revokeObjectURL` when done.
 */
export async function fileUrl(path: string): Promise<string> {
  const token = getToken();
  const response = await fetch(`${BASE}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new ApiError(response.status, `Could not load the file (${response.status})`, null);
  return URL.createObjectURL(await response.blob());
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** `?a=1&b=2`, skipping anything the caller left undefined or blank. */
export function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** Every list endpoint in this API returns this shape. */
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
