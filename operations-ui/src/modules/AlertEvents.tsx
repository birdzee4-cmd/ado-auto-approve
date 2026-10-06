import { useEffect, useMemo, useState } from 'react';
import { operationsApi } from '../api';
import { displayStatus, EmptyState, ErrorState, LoadingState, PageHeading, StatusBadge } from '../components';
import type { AlertEvent } from '../types';

export function AlertEvents() {
  const [items, setItems] = useState<AlertEvent[] | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try { setItems((await operationsApi.alertEvents(status)).items); }
    catch (err) { setError((err as Error).message); }
  };
  useEffect(() => { void load(); }, [status]);

  const visible = useMemo(() => (items || []).filter(item => !status || item.processingStatus === status), [items, status]);
  return <section className="ops-incidents-page">
    <PageHeading eyebrow="Alert lifecycle · Read-only monitoring" title="Alert Events" actions={<button className="ops-button ops-button-secondary" onClick={() => void load()}>Refresh</button>} />
    <p className="ops-muted">ข้อมูลหน้านี้รับมาจาก Production Power Automate เพื่อใช้ตรวจสอบเท่านั้น Flow หลักเป็นผู้ดูแล Incident และสถานะจริง</p>
    <div className="ops-incident-controls">
      <label className="ops-filter-control"><span>STATUS</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="">All events</option>{['RECEIVED', 'MATCHED', 'PROCESSED', 'UNMATCHED', 'AMBIGUOUS', 'FAILED', 'DUPLICATE'].map(value => <option value={value} key={value}>{displayStatus(value)}</option>)}</select></label>
    </div>
    {error && <ErrorState message={error} onRetry={load} />}
    {!items && !error && <LoadingState label="Loading alert events…" />}
    {items && visible.length === 0 && <EmptyState title="No alert events" detail="Events submitted by Power Automate will appear here." />}
    {visible.length > 0 && <div className="ops-card-list">{visible.map(item => {
      return <article className="ops-ticket-preview" key={item.eventId}>
        <div className="ops-section-title"><div><small>{item.eventType}</small><h3>{item.alertName}</h3></div><StatusBadge value={item.processingStatus} /></div>
        <dl className="ops-detail-grid"><dt>Resource</dt><dd>{item.resource}</dd><dt>First seen</dt><dd>{formatDate(item.firstSeenAt)}</dd><dt>Resolved at</dt><dd>{formatDate(item.resolvedAt)}</dd><dt>Message ID</dt><dd><code>{item.messageId}</code></dd><dt>Matched incident</dt><dd>{item.matchedIncidentId || '-'}</dd><dt>Match method</dt><dd>{item.matchMethod || '-'}</dd><dt>Attempts</dt><dd>{item.attemptCount}</dd></dl>
        {(item.errorCode || item.errorDetail) && <div className="ops-inline-error">{[item.errorCode, item.errorDetail].filter(Boolean).join(': ')}</div>}
      </article>;
    })}</div>}
  </section>;
}

function formatDate(value?: string) { if (!value) return '-'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' }); }
