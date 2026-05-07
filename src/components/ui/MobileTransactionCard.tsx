import type { ReactNode } from 'react';

export function MobileTransactionCard({
  title,
  subtitle,
  value,
  description,
  children,
  actions,
}: {
  title: string;
  subtitle: string;
  value: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <article className="mobile-transaction-card">
      <div className="mobile-card-head">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <strong className="mobile-card-value">{value}</strong>
      </div>
      {description ? <p>{description}</p> : null}
      {children}
      {actions ? <div className="row-button-group mobile-actions">{actions}</div> : null}
    </article>
  );
}
