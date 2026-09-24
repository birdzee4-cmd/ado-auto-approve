import { useEffect, useState } from 'react';
import { loadAdoConnection, operationsApi } from '../api';
import { AdoStateBadge, EmptyState, ErrorState, LoadingState, PageHeading, StatusBadge } from '../components';
import type { AdoConnectionStatus, AuditEvent, Incident, ServiceMapping, SupportTeam } from '../types';

export function Incidents() {
  const [items, setItems] = useState<Incident[] | null>(null);
  const [selected, setSelected] = useState<{ incident: Incident; timeline: AuditEvent[] } | null>(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<AdoConnectionStatus | null>(null);
  const [supportTeam, setSupportTeam] = useState<SupportTeam>('APP_SUPPORT');
  const [mapping, setMapping] = useState<ServiceMapping | null>(null);
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [existingWorkItemId, setExistingWorkItemId] = useState('');

  const load = () => {
    setError('');
    operationsApi.incidents(status, search).then(result => setItems(result.items)).catch(err => setError(err.message));
  };
  useEffect(load, [status]);
  useEffect(() => { loadAdoConnection().then(setConnection).catch(() => setConnection({ connected: false })); }, []);

  const openIncident = async (id: string, preserveFeedback = false) => {
    try {
      setSelected(await operationsApi.incident(id));
      if (!preserveFeedback) {
        setActionError('');
        setActionMessage('');
      }
      setMapping(null);
    } catch (err) { setError((err as Error).message); }
  };

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    if (!selected) return;
    setBusy(true); setActionError(''); setActionMessage('');
    try {
      await action();
      setActionMessage(success);
      await openIncident(selected.incident.incidentId, true);
      load();
    } catch (err) {
      const typed = err as Error & { status?: number; connectUrl?: string };
      setActionError(typed.message);
      if (typed.status === 428 && typed.connectUrl) window.location.assign(typed.connectUrl);
    } finally { setBusy(false); }
  };

  const previewMapping = async () => {
    if (!selected) return;
    setActionError('');
    try { setMapping((await operationsApi.resolveMapping(selected.incident.incidentId, supportTeam)).mapping); }
    catch (err) { setMapping(null); setActionError((err as Error).message); }
  };

  return <section>
    <PageHeading eyebrow="SharePoint incident store" title="Incidents" />
    <div className="ops-toolbar">
      <form onSubmit={e => { e.preventDefault(); load(); }}><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search incident ID, alert or resource" aria-label="Search incidents" /><button className="ops-button" type="submit">Search</button></form>
      <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by tracking status"><option value="">All statuses</option><option value="OPEN">Open work items</option><option value="CLOSED">Closed work items</option><option value="PENDING">Awaiting action</option><option value="CANCELLED">Cancelled</option><option value="FAILED">Flow failures</option><option value="NOT_CREATED">No work item</option></select>
    </div>
    {error && <ErrorState message={error} onRetry={load} />}
    {!items && !error && <LoadingState />}
    {items && items.length === 0 && <EmptyState title="No matching incidents" detail="Change the filter or wait for Power Automate to write an incident to SharePoint." />}
    {items && items.length > 0 && <div className="ops-card-list">{items.map(item => <button className="ops-incident-card" key={item.incidentId} onClick={() => openIncident(item.incidentId)} aria-label={`Open incident ${item.displayId || item.incidentId}`}>
      <span className="ops-incident-main"><strong className="ops-incident-display-id">{item.displayId || item.incidentId}</strong><span className="ops-incident-alert">{item.alertName}</span><small>{item.service || item.resource}</small></span><AdoStateBadge value={item.adoState} /><StatusBadge value={item.trackingStatus} /><span className="ops-incident-time">{formatDate(item.lastSyncedAt || item.lastSeen)}</span>
    </button>)}</div>}
    {selected && <div className="ops-drawer-backdrop" onMouseDown={e => { if (e.currentTarget === e.target) setSelected(null); }}><aside className="ops-detail-drawer" aria-label="Incident details">
      <div className="ops-drawer-head"><div><small>Incident ID</small><h2 className="ops-incident-display-id">{selected.incident.displayId || selected.incident.incidentId}</h2><p>{selected.incident.alertName}</p></div><button className="ops-icon-button" onClick={() => setSelected(null)} aria-label="Close details">×</button></div>
      <dl className="ops-detail-grid"><dt>Alert status</dt><dd><StatusBadge value={selected.incident.status} /></dd><dt>Tracking</dt><dd><StatusBadge value={selected.incident.trackingStatus} /></dd><dt>Workflow</dt><dd>{selected.incident.workflowStatus || '-'}</dd><dt>ADO state</dt><dd><AdoStateBadge value={selected.incident.adoState} /></dd><dt>Service</dt><dd>{selected.incident.service || selected.incident.resource}</dd><dt>Environment</dt><dd>{selected.incident.environment || '-'}</dd><dt>Priority</dt><dd>{selected.incident.priority || '-'}</dd><dt>First seen</dt><dd>{formatDate(selected.incident.firstSeen)}</dd><dt>Resolved at</dt><dd>{formatDate(selected.incident.resolvedAt)}</dd><dt>Duration</dt><dd>{formatDuration(selected.incident.durationMinutes)}</dd><dt>Email received</dt><dd>{formatDate(selected.incident.receivedAt)}</dd><dt>Occurrences</dt><dd>{selected.incident.occurrenceCount ?? '-'}</dd><dt>Assigned to</dt><dd>{selected.incident.assignedTo || '-'}</dd><dt>Work item</dt><dd>{selected.incident.workItemUrl ? <a href={selected.incident.workItemUrl} target="_blank" rel="noreferrer">#{selected.incident.workItemId}</a> : 'Not created'}</dd><dt>SharePoint ID</dt><dd>{selected.incident.sharePointId ?? '-'}</dd><dt>Technical ID</dt><dd><code className="ops-technical-id" title="Technical IncidentId; select to copy">{selected.incident.incidentId || '-'}</code></dd><dt>Last synced</dt><dd>{formatDate(selected.incident.lastSyncedAt)}</dd></dl>
      {selected.incident.errorDetail && <div className="ops-error"><strong>Power Automate error</strong><span>{selected.incident.errorDetail}</span></div>}
      <section className="ops-work-items"><div className="ops-section-title"><div><small>AZURE DEVOPS</small><h3>Work Items in this Incident</h3></div><strong>{selected.incident.workItemSummary.closed}/{selected.incident.workItemSummary.total} closed</strong></div>
        {selected.incident.workItems.length === 0 ? <p className="ops-muted">Primary Work Item has not been created by the production workflow.</p> : selected.incident.workItems.map(item => <article className="ops-work-item-row" key={item.workItemId}><div><span className={`ops-work-item-role is-${item.role.toLowerCase()}`}>{item.role}</span><strong>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">#{item.workItemId}</a> : `#${item.workItemId}`}</strong><small>{item.supportTeam || 'Unknown team'} · {item.assignedTo || 'Unassigned'}</small></div><AdoStateBadge value={item.state} /></article>)}
      </section>
      <section className="ops-action-panel"><div className="ops-section-title"><div><small>TIER 1 ACTIONS</small><h3>Incident controls</h3></div><span className={`ops-connection-pill ${connection?.connected ? 'is-connected' : ''}`}>{connection?.connected ? `Connected: ${connection.adoIdentity?.email || connection.user}` : 'ADO not connected'}</span></div>
        {actionError && <div className="ops-inline-error">{actionError}</div>}{actionMessage && <div className="ops-inline-success">{actionMessage}</div>}
        {!connection?.connected && <button className="ops-button ops-button-wide" onClick={() => window.location.assign('/api/ado-auth-start?returnTo=' + encodeURIComponent('/operations.html#/incidents'))}>Connect Azure DevOps</button>}
        <div className="ops-action-group"><h4>Create Related Work Item</h4><label>Support team<select value={supportTeam} onChange={event => { setSupportTeam(event.target.value as SupportTeam); setMapping(null); }}><option value="APP_SUPPORT">App Support</option><option value="TIER2">Tier 2 / Cloud Ops</option></select></label><button className="ops-button ops-button-secondary" onClick={previewMapping} disabled={busy}>Preview mapping</button>
          {mapping && <dl className="ops-mapping-preview"><dt>Project / Type</dt><dd>{mapping.adoProject} · {mapping.workItemType}</dd><dt>Area Path</dt><dd>{mapping.areaPath}</dd><dt>Assigned Team</dt><dd>{mapping.assignedTeam}</dd></dl>}
          <label>Title (optional)<input value={title} onChange={event => setTitle(event.target.value)} maxLength={255} /></label><label>Tier 1 detail<textarea value={detail} onChange={event => setDetail(event.target.value)} rows={3} /></label><button className="ops-button" disabled={busy || !connection?.connected || !mapping} onClick={() => runAction(() => operationsApi.createRelated(selected.incident.incidentId, { supportTeam, title, detail, idempotencyKey: globalThis.crypto?.randomUUID?.() || `${Date.now()}` }), 'Related Work Item created')}>Create Related Work Item</button>
        </div>
        <div className="ops-action-group"><h4>Link Existing Work Item</h4><label>Work Item ID<input inputMode="numeric" value={existingWorkItemId} onChange={event => setExistingWorkItemId(event.target.value.replace(/\D/g, ''))} /></label><button className="ops-button ops-button-secondary" disabled={busy || !connection?.connected || !existingWorkItemId} onClick={() => runAction(() => operationsApi.linkExisting(selected.incident.incidentId, { supportTeam, workItemId: Number(existingWorkItemId) }), 'Existing Work Item linked')}>Link as Related</button></div>
        <div className="ops-closure"><h4>Closure checklist</h4><ul><li className={selected.incident.workItemSummary.total > 0 ? 'is-done' : ''}>Primary Work Item exists</li><li className={selected.incident.workItemSummary.open === 0 && selected.incident.workItemSummary.total > 0 ? 'is-done' : ''}>All Work Items are closed</li><li className={selected.incident.recoveryConfirmed ? 'is-done' : ''}>Tier 1 confirmed recovery</li></ul>{selected.incident.closeEligibility?.reasons.map(reason => <small key={reason}>{reason}</small>)}<div className="ops-card-actions"><button className="ops-button ops-button-secondary" disabled={busy || !connection?.connected} onClick={() => runAction(() => operationsApi.synchronize(selected.incident.incidentId), 'Work Item states synchronized')}>Synchronize</button><button className="ops-button ops-button-secondary" disabled={busy || !connection?.connected || selected.incident.recoveryConfirmed} onClick={() => runAction(() => operationsApi.confirmRecovery(selected.incident.incidentId), 'Recovery confirmed')}>Confirm Recovery</button><button className="ops-button" disabled={busy || !connection?.connected || !selected.incident.closeEligibility?.allowed} onClick={() => runAction(() => operationsApi.close(selected.incident.incidentId), 'Incident closed')}>Close Incident</button></div></div>
      </section>
      <div className="ops-timeline"><h3>Timeline</h3>{selected.timeline.map(event => <div key={event.eventId}><span /><p><strong>{event.eventType}</strong><small>{event.detail || event.result} · {formatDate(event.timestamp)}</small></p></div>)}</div>
    </aside></div>}
  </section>;
}

function formatDate(value?: string) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })
    : '-';
}

function formatDuration(value?: number) {
  return Number.isFinite(value) ? `${value} min` : '-';
}
