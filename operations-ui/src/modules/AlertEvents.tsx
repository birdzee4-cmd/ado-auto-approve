import { useEffect, useMemo, useState } from 'react';
import { operationsApi } from '../api';
import { EmptyState, ErrorState, LoadingState, PageHeading, StatusBadge } from '../components';
import type { AlertEvent, OperationsCapabilities } from '../types';

const reviewStatuses = ['UNMATCHED', 'AMBIGUOUS', 'FAILED', 'MATCHED'];

export function AlertEvents() {
  const [items, setItems] = useState<AlertEvent[] | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [incidentIds, setIncidentIds] = useState<Record<string, string>>({});
  const [capabilities, setCapabilities] = useState<OperationsCapabilities | null>(null);

  const load = async () => {
    setError('');
    try { setItems((await operationsApi.alertEvents(status)).items); }
    catch (err) { setError((err as Error).message); }
  };
  useEffect(() => { void load(); }, [status]);
  useEffect(() => { operationsApi.capabilities().then(setCapabilities).catch(() => setCapabilities(null)); }, []);

  const visible = useMemo(() => (items || []).filter(item => !status || item.processingStatus === status), [items, status]);
  const run = async (eventId: string, action: () => Promise<unknown>) => {
    setBusy(eventId); setError('');
    try { await action(); await load(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(''); }
  };

  return <section className="ops-incidents-page">
    <PageHeading eyebrow="Alert lifecycle" title="Alert Events" actions={<button className="ops-button ops-button-secondary" onClick={() => void load()}>Refresh</button>} />
    <div className="ops-incident-controls">
      <label className="ops-filter-control"><span>STATUS</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="">All events</option>{['RECEIVED', 'MATCHED', 'PROCESSED', 'UNMATCHED', 'AMBIGUOUS', 'FAILED', 'DUPLICATE'].map(value => <option value={value} key={value}>{value}</option>)}</select></label>
    </div>
    {error && <ErrorState message={error} onRetry={load} />}
    {!items && !error && <LoadingState label="Loading alert events…" />}
    {items && visible.length === 0 && <EmptyState title="No alert events" detail="Events submitted by Power Automate will appear here." />}
    {visible.length > 0 && <div className="ops-card-list">{visible.map(item => {
      const candidateId = incidentIds[item.eventId] ?? item.matchedIncidentId ?? item.incidentId ?? '';
      const needsReview = reviewStatuses.includes(item.processingStatus);
      return <article className="ops-ticket-preview" key={item.eventId}>
        <div className="ops-section-title"><div><small>{item.eventType}</small><h3>{item.alertName}</h3></div><StatusBadge value={item.processingStatus} /></div>
        <dl className="ops-detail-grid"><dt>Resource</dt><dd>{item.resource}</dd><dt>First seen</dt><dd>{formatDate(item.firstSeenAt)}</dd><dt>Resolved at</dt><dd>{formatDate(item.resolvedAt)}</dd><dt>Message ID</dt><dd><code>{item.messageId}</code></dd><dt>Matched incident</dt><dd>{item.matchedIncidentId || '-'}</dd><dt>Match method</dt><dd>{item.matchMethod || '-'}</dd><dt>Attempts</dt><dd>{item.attemptCount}</dd></dl>
        {(item.errorCode || item.errorDetail) && <div className="ops-inline-error">{[item.errorCode, item.errorDetail].filter(Boolean).join(': ')}</div>}
        {needsReview && <div className="ops-action-group"><label className="ops-filter-control"><span>INCIDENT ID</span><input value={candidateId} onChange={event => setIncidentIds(current => ({ ...current, [item.eventId]: event.target.value }))} placeholder="Technical Incident ID" /></label>{capabilities && !capabilities.alertEventWrite && <p className="ops-muted">Shadow mode is active. Confirm Match is disabled until Alert Event writes are enabled.</p>}<div className="ops-card-actions"><button className="ops-button ops-button-secondary" disabled={busy === item.eventId} onClick={() => run(item.eventId, () => operationsApi.processAlertEvent(item.eventId, true))}>Dry Run</button><button className="ops-button" disabled={busy === item.eventId || !candidateId || !capabilities?.alertEventWrite} onClick={() => { if (window.confirm(`Confirm RESOLVED match to ${candidateId}?`)) void run(item.eventId, () => operationsApi.confirmAlertEvent(item.eventId, candidateId)); }}>Confirm Match</button><button className="ops-button ops-button-danger" disabled={busy === item.eventId} onClick={() => { if (window.confirm('Reject this alert event?')) void run(item.eventId, () => operationsApi.rejectAlertEvent(item.eventId)); }}>Reject</button></div></div>}
      </article>;
    })}</div>}
  </section>;
}

function formatDate(value?: string) { if (!value) return '-'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' }); }
