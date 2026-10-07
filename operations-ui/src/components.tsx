import type { ReactNode } from 'react';

// API timestamps are UTC instants. Explicitly mark timezone-less values as UTC
// so browser locale settings cannot shift incident times inconsistently.
export function parseUtcTimestamp(value?: string) {
  if (!value) return undefined;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function formatBangkokTimestamp(value?: string, locale = 'en-US') {
  const date = parseUtcTimestamp(value);
  return date ? date.toLocaleString(locale, { timeZone: 'Asia/Bangkok' }) : '-';
}

export function StatusBadge({ value }: { value: string }) {
  const className = value.toLowerCase().replace(/_/g, '-');
  return <span className={`ops-status ops-status-${className}`}>{displayStatus(value)}</span>;
}

export function displayStatus(value?: string) {
  const key = String(value || '').trim().toUpperCase();
  const labels: Record<string, string> = {
    FIRING: 'Active', RESOLVED: 'Recovered',
    RECEIVED: 'Received', AWAITING_APPROVAL: 'Awaiting approval', CREATED: 'Work item created',
    REJECTED: 'Rejected', FAILED: 'Automation failed', CANCELLED: 'Cancelled',
    OPEN: 'In progress', CLOSED: 'Closed', PENDING: 'Awaiting action', NOT_CREATED: 'Work item not created',
    WAITING_RESOLVED: 'Waiting for alert recovery', WAITING_SUPPORT: 'Waiting for support',
    READY_TO_CLOSE: 'Ready to close', NEEDS_REVIEW: 'Needs review',
    APPROVED: 'Approved', NOT_REQUESTED: 'Not requested', COMPLETED: 'Completed',
    ACTIVE: 'Active', PROCESSED: 'Processed', MATCHED: 'Matched', UNMATCHED: 'Unmatched',
    AMBIGUOUS: 'Needs review', DUPLICATE: 'Duplicate'
  };
  return labels[key] || key.replace(/_/g, ' ') || '-';
}

export function AdoStateBadge({ value }: { value?: string }) {
  const label = value?.trim() || 'Not created';
  const normalized = label.toLowerCase();
  let tone = 'neutral';

  if (['closed', 'done', 'resolved'].includes(normalized)) tone = 'success';
  else if (['reject', 'rejected'].includes(normalized)) tone = 'danger';
  else if (['processing', 'active', 'pending', 'awaiting approval'].includes(normalized)) tone = 'active';
  else if (['new', 'open'].includes(normalized)) tone = 'new';

  return <span className={`ops-status ops-ado-state ops-ado-state-${tone}`}>{label}</span>;
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
