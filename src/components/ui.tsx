import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useOrg, type Role } from '../lib/orgContext';

// ─── Layout ───
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 px-6 py-3 flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2">{title}</h1>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex gap-2 flex-wrap">{actions}</div>
    </div>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="p-6 max-w-[1500px]">{children}</div>;
}

// ─── States: loading / empty / error (every screen should use these) ───
export function Loading({ msg = 'Loading…' }: { msg?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-400">
      <span className="w-5 h-5 rounded-full border-2 border-slate-300 border-t-brand animate-spin" />
      <span className="text-sm">{msg}</span>
    </div>
  );
}

export function Empty({ icon, title, msg, action }: { icon: string; title: string; msg: string; action?: ReactNode }) {
  return (
    <div className="text-center py-16 text-slate-400">
      <div className="text-5xl mb-3">{icon}</div>
      <h3 className="text-base font-semibold text-slate-600 mb-1">{title}</h3>
      <p className="text-sm">{msg}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div className="text-center py-16">
      <div className="text-5xl mb-3">⚠️</div>
      <h3 className="text-base font-semibold text-slate-700 mb-1">Something went wrong</h3>
      <p className="text-sm text-red-600 max-w-md mx-auto">{msg}</p>
      {onRetry && <button className="btn btn-outline btn-sm mt-4" onClick={onRetry}>Try again</button>}
    </div>
  );
}

// ─── Stat card ───
export function Stat({ label, value, color = 'slate' }: { label: string; value: string | number; color?: string }) {
  const colors: Record<string, string> = {
    slate: 'border-slate-300',
    brand: 'border-brand text-brand-dark',
    teal: 'border-brand text-brand-dark', // backward-compat alias
    blue: 'border-blue-500 text-blue-600',
    red: 'border-red-500 text-red-600',
    green: 'border-emerald-500 text-emerald-600',
    amber: 'border-amber-500 text-amber-600'
  };
  return (
    <div className={`card border-l-4 ${colors[color] || colors.slate}`}>
      <div className="text-xs text-slate-500 font-semibold uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-extrabold mt-1 tabular-nums">{value}</div>
    </div>
  );
}

// ─── Form controls ───
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
};
export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: BtnProps) {
  const v = { primary: 'btn-primary', outline: 'btn-outline', ghost: 'btn-ghost', danger: 'btn-danger' }[variant];
  const s = { sm: 'btn-sm', md: '', lg: 'btn-lg' }[size];
  return <button className={`btn ${v} ${s} ${className}`.trim()} {...rest} />;
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`.trim()} {...rest} />;
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`input ${className}`.trim()} {...rest}>{children}</select>;
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`input ${className}`.trim()} {...rest} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

// ─── Badge ───
const BADGE: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-600',
  brand: 'bg-brand-light text-brand-dark',
  green: 'bg-emerald-50 text-emerald-700',
  red: 'bg-red-50 text-red-600',
  amber: 'bg-amber-50 text-amber-700',
  blue: 'bg-blue-50 text-blue-700'
};
export function Badge({ tone = 'slate', children }: { tone?: keyof typeof BADGE; children: ReactNode }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${BADGE[tone]}`}>{children}</span>;
}

// ─── Modal ───
export function Modal({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm grid place-items-center p-4" onMouseDown={onClose}>
      <div
        className={`bg-white rounded-xl shadow-xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] flex flex-col`}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h2 className="font-bold">{title}</h2>
          <button className="text-slate-400 hover:text-slate-700 text-xl leading-none" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

// ─── Table (responsive: scrolls on small screens) ───
export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white shadow-card">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
          {head}
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

// ─── Pagination (for large lists — keeps rendering bounded) ───
export function Pagination({ page, pageSize, total, onPage }: {
  page: number;          // zero-based current page
  pageSize: number;
  total: number;         // total row count across all pages
  onPage: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null; // nothing to paginate
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 mt-3 text-sm text-slate-500">
      <span className="tabular-nums">{from}–{to} of {total}</span>
      <div className="flex items-center gap-2">
        <button className="btn btn-outline btn-sm" disabled={page <= 0} onClick={() => onPage(page - 1)}>← Prev</button>
        <span className="tabular-nums text-xs">Page {page + 1} / {pageCount}</span>
        <button className="btn btn-outline btn-sm" disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)}>Next →</button>
      </div>
    </div>
  );
}

// ─── Role gate: render children only if current role is allowed ───
export function RoleGate({ allow, children, fallback = null }: { allow: Role[]; children: ReactNode; fallback?: ReactNode }) {
  const { role } = useOrg();
  if (role && allow.includes(role)) return <>{children}</>;
  return <>{fallback}</>;
}

// ─── Formatters ───
export function fmtCurrency(n: number) {
  return '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
export function fmtDate(d?: string) {
  if (!d) return '-';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y?.slice(2)}`;
}
