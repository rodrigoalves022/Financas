import type { ReactNode } from 'react';

export function EmptyState({
  title = 'Nada por aqui ainda',
  description,
  action,
  compact = false,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`}>
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
