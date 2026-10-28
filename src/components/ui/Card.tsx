import type { ReactNode } from 'react';

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
  span = 'half',
  icon,
  id,
}: {
  id?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  span?: 'half' | 'full' | 'third' | 'two-thirds';
  icon?: ReactNode;
}) {
  return (
    <section id={id} className={`card span-${span} ${className}`}>
      {title || actions ? (
        <header className="card-header">
          <div className="card-heading">
            {icon ? <span className="card-icon">{icon}</span> : null}
            <div>
              {title ? <h3>{title}</h3> : null}
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
          </div>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'info' | 'accent';

export interface Trend {
  label: string;
  favorable: boolean;
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
  trend,
  onClick,
  active,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  trend?: Trend | null;
  onClick?: () => void;
  active?: boolean;
}) {
  const content = (
    <>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {icon ? <span className={`stat-icon tone-${tone}`}>{icon}</span> : null}
      </div>
      <strong className={`stat-value ${tone === 'good' || tone === 'bad' ? `text-${tone}` : ''}`}>{value}</strong>
      <div className="stat-bottom">
        {trend ? <span className={`trend ${trend.favorable ? 'trend-good' : 'trend-bad'}`}>{trend.label}</span> : null}
        {hint ? <span className="stat-hint">{hint}</span> : null}
      </div>
    </>
  );
  return onClick
    ? <button type="button" className={`stat-card clickable ${active ? 'active' : ''}`} onClick={onClick}>{content}</button>
    : <article className="stat-card">{content}</article>;
}

export function ProgressBar({ value, tone, color, size = 'md' }: { value: number; tone?: 'good' | 'warn' | 'bad' | 'accent'; color?: string; size?: 'sm' | 'md' | 'lg' }) {
  const width = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div className={`progress progress-${size}`} role="progressbar" aria-valuenow={Math.round(width)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`progress-fill ${tone ? `fill-${tone}` : ''}`} style={{ width: `${width}%`, background: color }} />
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, size = 'md' }: {
  tabs: Array<{ id: T; label: ReactNode; icon?: ReactNode; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`tabs tabs-${size}`} role="tablist">
      {tabs.map(tab => (
        <button key={tab.id} type="button" role="tab" aria-selected={value === tab.id} className={value === tab.id ? 'active' : ''} onClick={() => onChange(tab.id)}>
          {tab.icon}
          <span>{tab.label}</span>
          {tab.count !== undefined ? <span className="tab-count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return <span className={`badge badge-${tone}`} title={title}>{children}</span>;
}

export function Avatar({ name, color, size = 'md' }: { name: string; color?: string; size?: 'sm' | 'md' | 'lg' }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length ? (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() : '?';
  return <span className={`avatar avatar-${size}`} style={color ? { background: color } : undefined}>{letters}</span>;
}

export function CategoryDot({ color }: { color: string }) {
  return <span className="category-dot" style={{ background: color }} />;
}

export function Field({ label, hint, children, full = false }: { label: ReactNode; hint?: ReactNode; children: ReactNode; full?: boolean }) {
  return (
    <label className={`field ${full ? 'full' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <small className="field-hint">{hint}</small> : null}
    </label>
  );
}
