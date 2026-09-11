import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/* ------------------------------------------------------------------ bits */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`.trim()}>{children}</section>;
}

export function Pill({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'brand';
  children: ReactNode;
}) {
  return <span className={`pill ${tone === 'neutral' ? '' : tone}`.trim()}>{children}</span>;
}

/** The booking's status, in the operator's words rather than the column's. */
export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: 'neutral' | 'ok' | 'warn' | 'danger' | 'brand' }> = {
    enquiry: { label: 'Enquiry', tone: 'neutral' },
    quoted: { label: 'Quoted', tone: 'neutral' },
    confirmed: { label: 'Confirmed', tone: 'brand' },
    in_storage: { label: 'In storage', tone: 'ok' },
    closed: { label: 'Closed', tone: 'neutral' },
    cancelled: { label: 'Cancelled', tone: 'danger' },
  };
  const it = map[status] ?? { label: status, tone: 'neutral' as const };
  return <Pill tone={it.tone}>{it.label}</Pill>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

export function Stat({ label, value, suffix }: { label: string; value: ReactNode; suffix?: string }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="value num">
        {value}
        {suffix ? <small>{suffix}</small> : null}
      </span>
    </div>
  );
}

export function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/* ----------------------------------------------------------------- forms */

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string) => ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Money({ value }: { value: number }) {
  return <span className="num">₹{value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>;
}

/* ---------------------------------------------------------------- sheets */

export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // A sheet is modal: the page behind it must not scroll under the thumb.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- toasts */

interface Toast {
  id: number;
  text: string;
  bad?: boolean;
}

const ToastCtx = createContext<{ say: (text: string, bad?: boolean) => void }>({ say: () => {} });

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const say = useCallback((text: string, bad?: boolean) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all, { id, text, bad }]);
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), bad ? 5200 : 2600);
  }, []);

  const value = useMemo(() => ({ say }), [say]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.bad ? 'bad' : ''}`.trim()}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ----------------------------------------------------------------- icons */

export const Icon = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M4 10.5 12 4l8 6.5V20H4z" />
      <path d="M9.5 20v-6h5v6" />
    </svg>
  ),
  bookings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M5 4h14v16l-7-3.2L5 20z" />
    </svg>
  ),
  godown: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      {/* A shed with a roller shutter -- deliberately not the house shape
          the Today tab uses, because two identical icons in a three-tab bar
          are no icons at all. */}
      <path d="M3 9.5 12 4.5l9 5V20H3z" />
      <path d="M7 20v-6h10v6" />
      <path d="M7 16.5h10M7 18.3h10" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 5 8 12l6.5 7" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </svg>
  ),
};
