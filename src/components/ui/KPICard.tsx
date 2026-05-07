import type { ReactNode } from 'react';

type KPITone = 'neutral' | 'good' | 'bad' | 'warn' | 'info';

export function KPICard({
  label,
  value,
  subtext,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: ReactNode;
  subtext?: ReactNode;
  tone?: KPITone;
  icon?: ReactNode;
}) {
  return (
    <article className={`kpi-card kpi-${tone}`}>
      <div className="kpi-card-top">
        <span>{label}</span>
        {icon ? <div className="kpi-icon">{icon}</div> : null}
      </div>
      <strong>{value}</strong>
      {subtext ? <small className={tone === 'neutral' ? undefined : tone}>{subtext}</small> : null}
    </article>
  );
}
