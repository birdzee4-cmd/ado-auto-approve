import type { ReactNode } from 'react';

export function StatusBadge({ value }: { value: string }) {
  const className = value.toLowerCase().replace(/_/g, '-');
  return <span className={`ops-status ops-status-${className}`}>{value.replace(/_/g, ' ')}</span>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="ops-empty">
      <span className="ops-empty-mark" aria-hidden="true">◇</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function LoadingState({ label = 'Loading data…' }: { label?: string }) {
  return <div className="ops-loading" role="status"><span className="ops-spinner" />{label}</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="ops-error" role="alert">
      <div><strong>Unable to load data</strong><p>{message}</p></div>
      {onRetry && <button type="button" className="ops-button ops-button-secondary" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function PageHeading({ eyebrow, title, actions }: { eyebrow: string; title: string; actions?: ReactNode }) {
  return (
    <header className="ops-page-heading">
      <div><p>{eyebrow}</p><h1>{title}</h1></div>
      {actions && <div className="ops-page-actions">{actions}</div>}
    </header>
  );
}
