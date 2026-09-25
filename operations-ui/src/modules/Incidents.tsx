import { Fragment, useEffect, useState } from 'react';
import { loadAdoConnection, operationsApi } from '../api';
import { AdoStateBadge, EmptyState, ErrorState, LoadingState, PageHeading, StatusBadge } from '../components';
import type { AdoConnectionStatus, AuditEvent, Incident, OperationsCapabilities, ServiceMapping, SupportTeam } from '../types';

export function Incidents() {
  const [items, setItems] = useState<Incident[] | null>(null);
  const [overviewItems, setOverviewItems] = useState<Incident[]>([]);
  const [selected, setSelected] = useState<{ incident: Incident; timeline: AuditEvent[] } | null>(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<AdoConnectionStatus | null>(null);
  const [capabilities, setCapabilities] = useState<OperationsCapabilities>({ createRelated: false, linkExisting: false, synchronize: false, closeIncident: false });
  const [supportTeam, setSupportTeam] = useState<SupportTeam>('APP_SUPPORT');
  const [mapping, setMapping] = useState<ServiceMapping | null>(null);
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [existingWorkItemId, setExistingWorkItemId] = useState('');
  const alertDetails: Array<{ label: string; value: string }> = selected ? [
    { label: 'Resource', value: selected.incident.resource },
    { label: 'Subscription', value: selected.incident.subscription },
    { label: 'Resource Group', value: selected.incident.resourceGroup },
    { label: 'Plan', value: selected.incident.appServicePlan },
    { label: 'Default Host', value: selected.incident.defaultHost },
    { label: 'Metric', value: selected.incident.metric },
    { label: 'Current Value', value: selected.incident.currentValue },
    { label: 'Threshold', value: selected.incident.thresholdDetail },
    { label: 'Summary', value: selected.incident.alertSummary }
  ].filter((item): item is { label: string; value: string } => Boolean(item.value && item.value.trim())) : [];
  const overview = {
    total: overviewItems.length,
    active: overviewItems.filter(item => item.status === 'FIRING' || item.trackingStatus === 'OPEN').length,
    attention: overviewItems.filter(item => ['PENDING', 'FAILED', 'NOT_CREATED'].includes(item.trackingStatus)).length,
    closed: overviewItems.filter(item => item.trackingStatus === 'CLOSED').length
  };

  const load = () => {
    setError('');
    const allRequest = operationsApi.incidents('', search);
    const visibleRequest = status && status !== 'ATTENTION' ? operationsApi.incidents(status, search) : allRequest;
    Promise.all([visibleRequest, allRequest])
      .then(([visible, all]) => {
        setItems(status === 'ATTENTION' ? visible.items.filter(item => ['PENDING', 'FAILED', 'NOT_CREATED'].includes(item.trackingStatus)) : visible.items);
        setOverviewItems(all.items);
      })
      .catch(err => setError(err.message));
  };
  useEffect(load, [status]);
  useEffect(() => { loadAdoConnection().then(setConnection).catch(() => setConnection({ connected: false })); }, []);
  useEffect(() => { operationsApi.capabilities().then(setCapabilities).catch(() => setCapabilities({ createRelated: false, linkExisting: false, synchronize: false, closeIncident: false })); }, []);

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

  return <section className="ops-incidents-page">
    <PageHeading eyebrow="Incident command center" title="Incidents" actions={<span className="ops-live-label"><i /> Live from SharePoint</span>} />
    <div className="ops-incident-overview" aria-label="Incident overview">
      <button className={status === '' ? 'is-active' : ''} onClick={() => setStatus('')}><span>All incidents</span><strong>{overview.total}</strong><small>Current result set</small></button>
      <button className={status === 'OPEN' ? 'is-active' : ''} onClick={() => setStatus('OPEN')}><span>Open</span><strong>{overview.active}</strong><small>Work in progress</small></button>
      <button className={status === 'ATTENTION' ? 'is-active is-warning' : 'is-warning'} onClick={() => setStatus('ATTENTION')}><span>Needs attention</span><strong>{overview.attention}</strong><small>Review or take action</small></button>
      <button className={status === 'CLOSED' ? 'is-active' : ''} onClick={() => setStatus('CLOSED')}><span>Closed</span><strong>{overview.closed}</strong><small>Completed incidents</small></button>
    </div>
    <div className="ops-incident-controls">
      <form className="ops-incident-search" onSubmit={e => { e.preventDefault(); load(); }}><span aria-hidden="true">⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ID, alert, service or resource…" aria-label="Search incidents" /><button className="ops-button" type="submit">Search</button></form>
      <label className="ops-filter-control"><span>STATUS</span><select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by tracking status"><option value="">All statuses</option><option value="ATTENTION">Needs attention</option><option value="OPEN">Open work items</option><option value="CLOSED">Closed work items</option><option value="PENDING">Awaiting action</option><option value="CANCELLED">Cancelled</option><option value="FAILED">Flow failures</option><option value="NOT_CREATED">No work item</option></select></label>
    </div>
    {error && <ErrorState message={error} onRetry={load} />}
    {!items && !error && <LoadingState />}
    {items && items.length === 0 && <EmptyState title="No matching incidents" detail="Change the filter or wait for Power Automate to write an incident to SharePoint." />}
    {items && items.length > 0 && <div className="ops-incident-results">
      <div className="ops-results-head"><div><strong>{items.length} incidents</strong><span>{status ? `Filtered by ${status.replace('_', ' ').toLowerCase()}` : 'Showing all tracking states'}</span></div><small>Updated from SharePoint</small></div>
      <div className="ops-incident-columns" aria-hidden="true"><span>Incident</span><span>Service / resource</span><span>Work item</span><span>Tracking</span><span>Last update</span><span /></div>
      <div className="ops-card-list">{items.map(item => <button className={`ops-incident-card is-${item.trackingStatus.toLowerCase().replace('_', '-')}`} key={item.incidentId} onClick={() => openIncident(item.incidentId)} aria-label={`Open incident ${item.displayId || item.incidentId}`}>
        <span className="ops-incident-main"><span className="ops-incident-id-row"><strong className="ops-incident-display-id">{item.displayId || item.incidentId}</strong><StatusBadge value={item.status} /></span><span className="ops-incident-alert">{humanizeAlert(item.alertName)}</span></span>
        <span className="ops-incident-service"><strong>{item.service || item.resource || 'Unknown service'}</strong><small>{item.environment || item.metric || 'No environment data'}</small></span>
        <span className="ops-cell-stack"><AdoStateBadge value={item.adoState} /><small>{item.workItemId ? `#${item.workItemId}` : 'No work item'}</small></span>
        <StatusBadge value={item.trackingStatus} />
        <span className="ops-cell-stack ops-incident-time"><strong>{formatRelativeDate(item.lastSyncedAt || item.lastSeen)}</strong><small>{formatDate(item.lastSyncedAt || item.lastSeen)}</small></span>
        <span className="ops-row-arrow" aria-hidden="true">→</span>
      </button>)}</div>
    </div>}
    {selected && <div className="ops-drawer-backdrop" onMouseDown={e => { if (e.currentTarget === e.target) setSelected(null); }}><aside className="ops-detail-drawer" aria-label="Incident details">
      <div className="ops-drawer-head"><div><small>Incident ID</small><h2 className="ops-incident-display-id">{selected.incident.displayId || selected.incident.incidentId}</h2><p>{selected.incident.alertName}</p></div><button className="ops-icon-button" onClick={() => setSelected(null)} aria-label="Close details">×</button></div>
      <dl className="ops-detail-grid"><dt>Alert status</dt><dd><StatusBadge value={selected.incident.status} /></dd><dt>Tracking</dt><dd><StatusBadge value={selected.incident.trackingStatus} /></dd><dt>Workflow</dt><dd>{selected.incident.workflowStatus || '-'}</dd><dt>ADO state</dt><dd><AdoStateBadge value={selected.incident.adoState} /></dd><dt>Service</dt><dd>{selected.incident.service || selected.incident.resource}</dd><dt>Environment</dt><dd>{selected.incident.environment || '-'}</dd><dt>Priority</dt><dd>{selected.incident.priority || '-'}</dd><dt>First seen</dt><dd>{formatDate(selected.incident.firstSeen)}</dd><dt>Resolved at</dt><dd>{formatDate(selected.incident.resolvedAt)}</dd><dt>Duration</dt><dd>{formatDuration(selected.incident.durationMinutes)}</dd><dt>Email received</dt><dd>{formatDate(selected.incident.receivedAt)}</dd><dt>Occurrences</dt><dd>{selected.incident.occurrenceCount ?? '-'}</dd><dt>Assigned to</dt><dd>{selected.incident.assignedTo || '-'}</dd><dt>Work item</dt><dd>{selected.incident.workItemUrl ? <a href={selected.incident.workItemUrl} target="_blank" rel="noreferrer">#{selected.incident.workItemId}</a> : 'Not created'}</dd><dt>SharePoint ID</dt><dd>{selected.incident.sharePointId ?? '-'}</dd><dt>Technical ID</dt><dd><code className="ops-technical-id" title="Technical IncidentId; select to copy">{selected.incident.incidentId || '-'}</code></dd><dt>Last synced</dt><dd>{formatDate(selected.incident.lastSyncedAt)}</dd></dl>
      {alertDetails.length > 0 && <section className="ops-alert-details"><h3>Monitoring Alert Details</h3><dl className="ops-detail-grid">{alertDetails.map(({ label, value }) => <Fragment key={label}><dt>{label}</dt><dd>{value}</dd></Fragment>)}</dl></section>}
      {selected.incident.errorDetail && <div className="ops-error"><strong>Power Automate error</strong><span>{selected.incident.errorDetail}</span></div>}
      <section className="ops-work-items"><div className="ops-section-title"><div><small>AZURE DEVOPS</small><h3>Work Items in this Incident</h3></div><strong>{selected.incident.workItemSummary.closed}/{selected.incident.workItemSummary.total} closed</strong></div>
        {selected.incident.workItems.length === 0 ? <p className="ops-muted">Primary Work Item has not been created by the production workflow.</p> : selected.incident.workItems.map(item => <article className="ops-work-item-row" key={item.workItemId}><div><span className={`ops-work-item-role is-${item.role.toLowerCase()}`}>{item.role}</span><strong>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">#{item.workItemId}</a> : `#${item.workItemId}`}</strong><small>{item.supportTeam || 'Unknown team'} · {item.assignedTo || 'Unassigned'}</small></div><AdoStateBadge value={item.state} /></article>)}
      </section>
      <section className="ops-action-panel"><div className="ops-section-title"><div><small>TIER 1 ACTIONS</small><h3>Incident controls</h3></div><span className={`ops-connection-pill ${connection?.connected ? 'is-connected' : ''}`}>{connection?.connected ? `Connected: ${connection.adoIdentity?.email || connection.user}` : 'ADO not connected'}</span></div>
        {actionError && <div className="ops-inline-error">{actionError}</div>}{actionMessage && <div className="ops-inline-success">{actionMessage}</div>}
        {!connection?.connected && <button className="ops-button ops-button-wide" onClick={() => window.location.assign('/api/ado-auth-start?returnTo=' + encodeURIComponent('/operations.html#/incidents'))}>Connect Azure DevOps</button>}
        {!capabilities.createRelated && !capabilities.linkExisting && !capabilities.synchronize && !capabilities.closeIncident && <p className="ops-muted">Operations Hub write actions are disabled by the administrator.</p>}
        <div className="ops-action-group"><h4>Create Related Work Item</h4><label>Support team<select value={supportTeam} onChange={event => { setSupportTeam(event.target.value as SupportTeam); setMapping(null); }}><option value="APP_SUPPORT">App Support</option><option value="TIER2">Tier 2 / Cloud Ops</option></select></label><button className="ops-button ops-button-secondary" onClick={previewMapping} disabled={busy || !capabilities.createRelated}>Preview mapping</button>
          {mapping && <dl className="ops-mapping-preview"><dt>Project / Type</dt><dd>{mapping.adoProject} · {mapping.workItemType}</dd><dt>Area Path</dt><dd>{mapping.areaPath}</dd><dt>Assigned Team</dt><dd>{mapping.assignedTeam}</dd></dl>}
          <label>Title (optional)<input value={title} onChange={event => setTitle(event.target.value)} maxLength={255} /></label><label>Tier 1 detail<textarea value={detail} onChange={event => setDetail(event.target.value)} rows={3} /></label><button className="ops-button" disabled={busy || !connection?.connected || !capabilities.createRelated || !mapping} onClick={() => runAction(() => operationsApi.createRelated(selected.incident.incidentId, { supportTeam, title, detail, idempotencyKey: globalThis.crypto?.randomUUID?.() || `${Date.now()}` }), 'Related Work Item created')}>Create Related Work Item</button>
        </div>
        <div className="ops-action-group"><h4>Link Existing Work Item</h4><label>Work Item ID<input inputMode="numeric" value={existingWorkItemId} onChange={event => setExistingWorkItemId(event.target.value.replace(/\D/g, ''))} /></label><button className="ops-button ops-button-secondary" disabled={busy || !connection?.connected || !capabilities.linkExisting || !existingWorkItemId} onClick={() => runAction(() => operationsApi.linkExisting(selected.incident.incidentId, { supportTeam, workItemId: Number(existingWorkItemId) }), 'Existing Work Item linked')}>Link as Related</button></div>
        <div className="ops-closure"><h4>Closure checklist</h4><ul><li className={selected.incident.workItemSummary.total > 0 ? 'is-done' : ''}>Primary Work Item exists</li><li className={selected.incident.workItemSummary.open === 0 && selected.incident.workItemSummary.total > 0 ? 'is-done' : ''}>All Work Items are closed</li></ul>{selected.incident.closeEligibility?.reasons.map(reason => <small key={reason}>{reason}</small>)}<div className="ops-card-actions"><button className="ops-button ops-button-secondary" disabled={busy || !connection?.connected || !capabilities.synchronize} onClick={() => runAction(() => operationsApi.synchronize(selected.incident.incidentId), 'Work Item states synchronized')}>Synchronize</button><button className="ops-button" disabled={busy || !connection?.connected || !capabilities.closeIncident || !selected.incident.closeEligibility?.allowed} onClick={() => runAction(() => operationsApi.close(selected.incident.incidentId), 'Incident closed')}>Close Incident</button></div></div>
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

function formatRelativeDate(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Unknown';
  const minutes = Math.round((Date.now() - Date.parse(value)) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

function humanizeAlert(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
}

function formatDuration(value?: number) {
  return Number.isFinite(value) ? `${value} min` : '-';
}
