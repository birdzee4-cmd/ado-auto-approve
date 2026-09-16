import { useEffect, useState } from 'react';
import { operationsApi } from '../api';
import { EmptyState, ErrorState, LoadingState, PageHeading, StatusBadge } from '../components';
import type { AuditEvent, Incident } from '../types';

export function Incidents() {
  const [items, setItems] = useState<Incident[] | null>(null);
  const [selected, setSelected] = useState<{ incident: Incident; timeline: AuditEvent[] } | null>(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    operationsApi.incidents(status, search).then(result => setItems(result.items)).catch(err => setError(err.message));
  };
  useEffect(load, [status]);

  const openIncident = async (id: string) => {
    try { setSelected(await operationsApi.incident(id)); } catch (err) { setError((err as Error).message); }
  };

  return <section>
    <PageHeading eyebrow="SharePoint incident store" title="Incidents" />
    <div className="ops-toolbar">
      <form onSubmit={e => { e.preventDefault(); load(); }}><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search incident, alert or resource" aria-label="Search incidents" /><button className="ops-button" type="submit">Search</button></form>
      <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by tracking status"><option value="">All statuses</option><option value="OPEN">Open work items</option><option value="CLOSED">Closed work items</option><option value="PENDING">Awaiting action</option><option value="FAILED">Flow failures</option><option value="NOT_CREATED">No work item</option></select>
    </div>
    {error && <ErrorState message={error} onRetry={load} />}
    {!items && !error && <LoadingState />}
    {items && items.length === 0 && <EmptyState title="No matching incidents" detail="Change the filter or wait for Power Automate to write an incident to SharePoint." />}
    {items && items.length > 0 && <div className="ops-card-list">{items.map(item => <button className="ops-incident-card" key={item.incidentId} onClick={() => openIncident(item.incidentId)}>
      <span className="ops-incident-main"><strong>{item.alertName}</strong><small>{item.incidentId} · {item.service || item.resource}</small></span><span>{item.adoState || 'No ADO item'}</span><StatusBadge value={item.trackingStatus} /><span className="ops-incident-time">{formatDate(item.lastSyncedAt || item.lastSeen)}</span>
    </button>)}</div>}
    {selected && <div className="ops-drawer-backdrop" onMouseDown={e => { if (e.currentTarget === e.target) setSelected(null); }}><aside className="ops-detail-drawer" aria-label="Incident details">
      <div className="ops-drawer-head"><div><small>{selected.incident.incidentId}</small><h2>{selected.incident.alertName}</h2></div><button className="ops-icon-button" onClick={() => setSelected(null)} aria-label="Close details">×</button></div>
      <dl className="ops-detail-grid"><dt>Alert</dt><dd><StatusBadge value={selected.incident.status} /></dd><dt>Tracking</dt><dd><StatusBadge value={selected.incident.trackingStatus} /></dd><dt>Workflow</dt><dd>{selected.incident.workflowStatus || '-'}</dd><dt>ADO state</dt><dd>{selected.incident.adoState || 'Not created'}</dd><dt>Service</dt><dd>{selected.incident.service || selected.incident.resource}</dd><dt>Environment</dt><dd>{selected.incident.environment || '-'}</dd><dt>Priority</dt><dd>{selected.incident.priority || '-'}</dd><dt>Received</dt><dd>{formatDate(selected.incident.receivedAt || selected.incident.firstSeen)}</dd><dt>Assigned to</dt><dd>{selected.incident.assignedTo || '-'}</dd><dt>Work item</dt><dd>{selected.incident.workItemUrl ? <a href={selected.incident.workItemUrl} target="_blank" rel="noreferrer">#{selected.incident.workItemId}</a> : 'Not created'}</dd><dt>Last synced</dt><dd>{formatDate(selected.incident.lastSyncedAt)}</dd></dl>
      {selected.incident.errorDetail && <div className="ops-error"><strong>Power Automate error</strong><span>{selected.incident.errorDetail}</span></div>}
      <div className="ops-timeline"><h3>Timeline</h3>{selected.timeline.map(event => <div key={event.eventId}><span /><p><strong>{event.eventType}</strong><small>{event.detail || event.result} · {new Date(event.timestamp).toLocaleString()}</small></p></div>)}</div>
    </aside></div>}
  </section>;
}

function formatDate(value?: string) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : '-';
}
