import { Fragment, useEffect, useRef, useState } from 'react';
import { loadAdoConnection, operationsApi } from '../api';
import { AdoStateBadge, displayStatus, EmptyState, ErrorState, LoadingState, PageHeading, StatusBadge } from '../components';
import type { AdoConnectionStatus, AuditEvent, Incident, OperationsCapabilities, RelatedTicketPreview } from '../types';

export function Incidents() {
  const routeParams = incidentRouteParams();
  const [items, setItems] = useState<Incident[] | null>(null);
  const [overviewItems, setOverviewItems] = useState<Incident[]>([]);
  const [selected, setSelected] = useState<{ incident: Incident; timeline: AuditEvent[] } | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [showTechnicalEvents, setShowTechnicalEvents] = useState(false);
  // Open the Incident page with the complete list by default. Explicit
  // status links (for example, Needs review) still apply their filter.
  const [status, setStatus] = useState(routeParams.get('status') || '');
  const [search, setSearch] = useState(routeParams.get('search') || '');
  const [alertStatus, setAlertStatus] = useState('');
  const [adoState, setAdoState] = useState('');
  const [lifecycle, setLifecycle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const refreshInFlight = useRef(false);
  const [connection, setConnection] = useState<AdoConnectionStatus | null>(null);
  const [capabilities, setCapabilities] = useState<OperationsCapabilities>({ createRelated: false, linkExisting: false, synchronize: false, closeIncident: false, manualCloseIncident: false, restartAppService: false });
  const [escalationTargets, setEscalationTargets] = useState<Array<'APP_SUPPORT' | 'TIER2'>>([]);
  const [mappingPreviews, setMappingPreviews] = useState<Partial<Record<'APP_SUPPORT' | 'TIER2', RelatedTicketPreview>>>({});
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
  const sortedItems = [...(items || [])].sort(compareIncidentNumberDescending);
  const assigneeOptions = [...new Set(overviewItems.map(item => item.assignedTo).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
  const filteredItems = sortedItems.filter(item => {
    if (alertStatus && item.status !== alertStatus) return false;
    if (adoState && item.adoState !== adoState) return false;
    if (assignee && item.assignedTo !== assignee) return false;
    if (lifecycle === 'WAITING_RESOLVED' && !isWaitingForResolved(item)) return false;
    if (lifecycle === 'WAITING_SUPPORT' && !isWaitingForSupport(item)) return false;
    if (lifecycle === 'READY_TO_CLOSE' && !isReadyToClose(item)) return false;
    if (lifecycle === 'CONFLICT' && (!item.hasLifecycleConflict || isWaitingForResolved(item))) return false;
    if (lifecycle === 'NORMAL' && item.hasLifecycleConflict) return false;
    return true;
  });
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleItems = filteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const overview = {
    total: overviewItems.length,
    active: overviewItems.filter(isActiveIncident).length,
    attention: overviewItems.filter(isActionRequired).length,
    waiting: overviewItems.filter(isWaitingForResolved).length,
    waitingSupport: overviewItems.filter(isWaitingForSupport).length,
    readyToClose: overviewItems.filter(isReadyToClose).length,
    closed: overviewItems.filter(isOperationsClosed).length
  };

  const load = async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    setError('');
    const allRequest = operationsApi.incidents('', search);
    try {
      const all = await allRequest;
      setItems(all.items.filter(item => {
        if (status === 'ACTIVE') return isActiveIncident(item);
        if (status === 'ATTENTION') return isActionRequired(item);
        if (status === 'WAITING_RESOLVED') return isWaitingForResolved(item);
        if (status === 'WAITING_SUPPORT') return isWaitingForSupport(item);
        if (status === 'READY_TO_CLOSE') return isReadyToClose(item);
        if (status === 'CLOSED') return isOperationsClosed(item);
        return !status || item.trackingStatus === status;
      }));
      setOverviewItems(all.items);
      setPage(1);
      setLastUpdatedAt(new Date());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  };
  useEffect(() => { void load(); }, [status]);
  useEffect(() => {
    const refreshWhenSafe = () => {
      if (document.visibilityState === 'visible' && !busy && !selected) void load();
    };
    const intervalId = window.setInterval(refreshWhenSafe, 60_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshWhenSafe();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [status, search, busy, selected]);
  useEffect(() => { loadAdoConnection().then(setConnection).catch(() => setConnection({ connected: false })); }, []);
  useEffect(() => { operationsApi.capabilities().then(setCapabilities).catch(() => setCapabilities({ createRelated: false, linkExisting: false, synchronize: false, closeIncident: false, manualCloseIncident: false, restartAppService: false })); }, []);

  const openIncident = async (id: string, preserveFeedback = false) => {
    setSelectedLoading(true);
    try {
      const detail = await operationsApi.incident(id);
      setSelected(detail);
      setShowTechnicalEvents(false);
      setEscalationTargets([]);
      if (!preserveFeedback) {
        setActionError('');
        setActionMessage('');
      }
      setMappingPreviews({});
    } catch (err) { setError((err as Error).message); }
    finally { setSelectedLoading(false); }
  };
  useEffect(() => {
    const incidentId = routeParams.get('id');
    if (incidentId) void openIncident(incidentId);
  }, []);

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

  const previewMappings = async () => {
    if (!selected) return;
    setActionError('');
    try {
      const preview = await operationsApi.previewRelatedBatch(selected.incident.incidentId, escalationTargets);
      setMappingPreviews(Object.fromEntries(preview.results.map(item => [item.supportTeam, item])));
    }
    catch (err) { setMappingPreviews({}); setActionError((err as Error).message); }
  };

  const closeSelectedIncident = async () => {
    if (!selected) return;
    setBusy(true); setActionError(''); setActionMessage('');
    try {
      await operationsApi.close(selected.incident.incidentId);
      setSelected(null);
      setSelectedLoading(false);
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/incidents`);
      await load();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const manualCloseSelectedIncident = async () => {
    if (!selected) return;
    const reason = window.prompt('เหตุผลสำหรับ Manual Override / Force Close (อย่างน้อย 10 ตัวอักษร):', 'RESOLVED event ไม่ถูกประมวลผลย้อนหลัง');
    if (!reason || reason.trim().length < 10) return;
    if (!window.confirm(`ยืนยัน Manual Override ปิด ${selected.incident.displayId || selected.incident.incidentId} หรือไม่?\n\nเหตุผล: ${reason.trim()}`)) return;
    await runAction(() => operationsApi.manualClose(selected.incident.incidentId, reason.trim()), 'Manual Override ปิด Incident และบันทึก Audit แล้ว');
  };

  const toggleEscalationTarget = (team: 'APP_SUPPORT' | 'TIER2') => {
    setEscalationTargets(current => current.includes(team) ? current.filter(item => item !== team) : [...current, team]);
    setMappingPreviews({});
  };

  const createSelectedTickets = async () => {
    if (!selected || escalationTargets.length === 0) return;
    const targets = [...escalationTargets];
    const targetNames = targets.map(team => team === 'APP_SUPPORT' ? 'App Support' : 'IT Tier 2 / Infra');
    if (!window.confirm(`Create ${targets.length} Production ticket${targets.length > 1 ? 's' : ''}?\n\nTarget: ${targetNames.join(' + ')}`)) return;
    await runAction(async () => {
      const result = await operationsApi.createRelatedBatch(selected.incident.incidentId, {
        supportTeams: targets,
        idempotencyKey: globalThis.crypto?.randomUUID?.() || `${Date.now()}`
      });
      if (result.failed) throw new Error(result.results.filter(item => !item.ok).map(item => `${item.supportTeam}: ${item.detail}`).join('; '));
      return result;
    }, `Created ${targets.length} related Work Item${targets.length > 1 ? 's' : ''}: ${targetNames.join(' + ')}`);
  };

  const restartSelectedAppService = async () => {
    if (!selected) return;
    const resource = selected.incident.resource || selected.incident.service || '';
    if (!resource || !window.confirm(`Restart ${resource} in ${selected.incident.environment || 'the current environment'}?\n\nThis may cause a short service interruption.`)) return;
    await runAction(
      () => operationsApi.restartAppService(selected.incident.incidentId, resource),
      `Restart App Service completed: ${resource}`
    );
  };

  return <section className="ops-incidents-page">
    <PageHeading eyebrow="Incident command center" title="Incidents" actions={<div className="ops-refresh-status"><span className="ops-live-label"><i /> Live from SharePoint</span><small>{lastUpdatedAt ? `Updated ${formatClock(lastUpdatedAt)}` : 'Waiting for first update'} · Auto every 60 sec</small><button className="ops-button ops-button-secondary" type="button" disabled={refreshing || busy} onClick={() => void load()}>{refreshing ? 'Refreshing…' : 'Refresh now'}</button></div>} />
    <div className="ops-incident-overview" aria-label="Incident overview">
      <button className={status === 'ACTIVE' ? 'is-active' : ''} onClick={() => setStatus('ACTIVE')}><span>Active</span><strong>{overview.active}</strong><small>Current work queue</small></button>
      <button className={status === 'ATTENTION' ? 'is-active is-warning' : 'is-warning'} onClick={() => setStatus('ATTENTION')}><span>Needs attention</span><strong>{overview.attention}</strong><small>Review or take action</small></button>
      <button className={status === 'WAITING_RESOLVED' ? 'is-active' : ''} onClick={() => setStatus('WAITING_RESOLVED')}><span>Waiting for alert recovery</span><strong>{overview.waiting}</strong><small>Work item closed, alert still active</small></button>
      <button className={status === 'WAITING_SUPPORT' ? 'is-active' : ''} onClick={() => setStatus('WAITING_SUPPORT')}><span>Waiting for support</span><strong>{overview.waitingSupport}</strong><small>Related team action</small></button>
      <button className={status === 'READY_TO_CLOSE' ? 'is-active' : ''} onClick={() => setStatus('READY_TO_CLOSE')}><span>Ready to close</span><strong>{overview.readyToClose}</strong><small>Resolved, tickets closed</small></button>
      <button className={status === 'CLOSED' ? 'is-active' : ''} onClick={() => setStatus('CLOSED')}><span>Closed</span><strong>{overview.closed}</strong><small>Completed incidents</small></button>
      <button className={status === '' ? 'is-active' : ''} onClick={() => setStatus('')}><span>All incidents</span><strong>{overview.total}</strong><small>Full history</small></button>
    </div>
    <div className="ops-incident-controls">
      <form className="ops-incident-search" onSubmit={e => { e.preventDefault(); load(); }}><span aria-hidden="true">⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ID, alert, service or resource…" aria-label="Search incidents" /><button className="ops-button" type="submit">Search</button></form>
      <div className="ops-filter-grid">
        <label className="ops-filter-control"><span>QUEUE</span><select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by queue"><option value="ACTIVE">Active</option><option value="ATTENTION">Needs review</option><option value="WAITING_SUPPORT">Waiting for support</option><option value="WAITING_RESOLVED">Waiting for alert recovery</option><option value="READY_TO_CLOSE">Ready to close</option><option value="OPEN">In progress</option><option value="CLOSED">Closed incidents</option><option value="PENDING">Awaiting action</option><option value="FAILED">Automation failed</option><option value="NOT_CREATED">Work item not created</option><option value="">All incidents</option></select></label>
        <label className="ops-filter-control"><span>ALERT</span><select value={alertStatus} onChange={e => { setAlertStatus(e.target.value); setPage(1); }}><option value="">All</option><option value="FIRING">Active</option><option value="RESOLVED">Recovered</option></select></label>
        <label className="ops-filter-control"><span>VSTS</span><select value={adoState} onChange={e => { setAdoState(e.target.value); setPage(1); }}><option value="">All</option><option value="New">New</option><option value="Processing">Processing</option><option value="Closed">Closed</option><option value="Reject">Reject</option></select></label>
        <label className="ops-filter-control"><span>LIFECYCLE</span><select value={lifecycle} onChange={e => { setLifecycle(e.target.value); setPage(1); }}><option value="">All</option><option value="WAITING_SUPPORT">Waiting for support</option><option value="WAITING_RESOLVED">Waiting for alert recovery</option><option value="READY_TO_CLOSE">Ready to close</option><option value="CONFLICT">Needs review</option><option value="NORMAL">Normal</option></select></label>
        <label className="ops-filter-control"><span>ASSIGNEE</span><select value={assignee} onChange={e => { setAssignee(e.target.value); setPage(1); }}><option value="">All</option>{assigneeOptions.map(value => <option value={value} key={value}>{value}</option>)}</select></label>
        <button className="ops-button ops-button-secondary ops-clear-filters" type="button" onClick={() => { setStatus(''); setAlertStatus(''); setAdoState(''); setLifecycle(''); setAssignee(''); setSearch(''); setPage(1); }}>Clear filters</button>
      </div>
    </div>
    {error && <ErrorState message={error} onRetry={load} />}
    {!items && !error && <LoadingState />}
    {items && filteredItems.length === 0 && <EmptyState title="No matching incidents" detail="Change the filter or wait for Power Automate to write an incident to SharePoint." />}
    {items && filteredItems.length > 0 && <div className="ops-incident-results">
      <div className="ops-results-head"><div><strong>{filteredItems.length} incidents</strong><span>Sorted by Incident number, newest first</span></div><small>Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredItems.length)} of {filteredItems.length}</small></div>
      <div className="ops-incident-columns" aria-hidden="true"><span>Incident / alert</span><span>Resource / owner</span><span>Progress / VSTS</span><span>Incident handling status</span><span>First seen</span><span /></div>
      <div className="ops-card-list">{visibleItems.map(item => <button className={`ops-incident-card is-${item.trackingStatus.toLowerCase().replace('_', '-')}${item.hasLifecycleConflict && !isOperationsClosed(item) ? ' has-lifecycle-conflict' : ''}${isOperationsClosed(item) ? ' is-operations-closed' : ''}`} key={item.incidentId} onClick={() => openIncident(item.incidentId)} aria-label={`Open incident ${item.displayId || item.incidentId}`}>
        <span className="ops-incident-main"><span className="ops-incident-id-row"><strong className="ops-incident-display-id">{item.displayId || item.incidentId}</strong><StatusBadge value={isOperationsClosed(item) ? 'CLOSED' : item.hasLifecycleConflict ? 'NEEDS_REVIEW' : item.status} /></span><span className="ops-incident-alert">{humanizeAlert(item.alertName)}</span></span>
        <span className="ops-incident-service"><strong>{item.resource || item.service || 'Unknown resource'}</strong><small>{item.assignedTo || 'Unassigned'} · {item.environment || 'Unknown environment'}</small></span>
        <span className="ops-cell-stack ops-incident-progress"><StatusBadge value={incidentProgress(item)} /><small>{item.workItemId ? `VSTS ${item.adoState || 'Unknown'} · #${item.workItemId}` : 'No VSTS work item'}</small></span>
        <StatusBadge value={displayLifecycle(item)} />
        <span className="ops-cell-stack ops-incident-time"><strong>{formatRelativeDate(item.firstSeen)}</strong><small>{formatDate(item.firstSeen)}</small></span>
        <span className="ops-row-arrow" aria-hidden="true">→</span>
      </button>)}</div>
      {pageCount > 1 && <div className="ops-pagination"><button className="ops-button ops-button-secondary" disabled={currentPage === 1} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous</button><span>Page {currentPage} of {pageCount}</span><button className="ops-button ops-button-secondary" disabled={currentPage === pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))}>Next</button></div>}
    </div>}
    {(selected || selectedLoading) && <div className="ops-drawer-backdrop" onMouseDown={e => { if (e.currentTarget === e.target && !selectedLoading) setSelected(null); }}><aside className={`ops-detail-drawer${selectedLoading ? ' is-loading' : ''}`} aria-label="Incident details">
      {selectedLoading && !selected && <div className="ops-detail-loading" role="status"><span className="ops-spinner" /><strong>Loading incident details…</strong></div>}
      {selected && <>
      <div className="ops-drawer-head"><div><small>INCIDENT COMMAND DETAIL</small><div className="ops-drawer-title-row"><h2 className="ops-incident-display-id">{selected.incident.displayId || selected.incident.incidentId}</h2><StatusBadge value={isOperationsClosed(selected.incident) ? 'CLOSED' : selected.incident.status} /></div><p>{humanizeAlert(selected.incident.alertName)}</p><div className="ops-drawer-meta"><span>{selected.incident.resource}</span><span>{selected.incident.environment || 'Unknown environment'}</span><span>{selected.incident.priority || 'No priority'}</span></div></div><button className="ops-icon-button" onClick={() => setSelected(null)} aria-label="Close details">×</button></div>
      <div className="ops-incident-summary" aria-label="Incident summary">
        <SummaryCard tone={selected.incident.resolvedAt ? 'success' : 'danger'} label="Alert" value={displayStatus(selected.incident.status)} detail={selected.incident.resolvedAt ? 'Monitoring recovery received' : 'Monitoring alert is active'} />
        <SummaryCard tone={isOperationsClosed(selected.incident) ? 'success' : 'active'} label="Incident" value={displayStatus(isOperationsClosed(selected.incident) ? 'CLOSED' : selected.incident.trackingStatus)} detail={isOperationsClosed(selected.incident) ? 'Incident completed' : 'Follow-up in progress'} />
        <SummaryCard tone={approvalStatus(selected.incident) === 'APPROVED' ? 'success' : approvalStatus(selected.incident) === 'REJECTED' ? 'danger' : 'warning'} label="Approval" value={displayStatus(approvalStatus(selected.incident))} detail={selected.incident.approvalBy || 'Approval status'} />
        <SummaryCard tone={selected.incident.adoState && ['CLOSED', 'DONE', 'RESOLVED'].includes(selected.incident.adoState.toUpperCase()) ? 'success' : selected.incident.workItemId ? 'active' : 'neutral'} label="Work item" value={selected.incident.workItemId ? `#${selected.incident.workItemId}` : 'Not created'} detail={displayStatus(selected.incident.adoState || 'NOT_CREATED')} />
      </div>
      {selected.incident.hasLifecycleConflict && <div className="ops-data-warning ops-data-warning-compact" role="alert"><div><strong>Needs review</strong><span>{lifecycleIssueMessage(selected.incident.lifecycleIssues || [])}</span></div></div>}
      <div className="ops-incident-workspace">
      <section className="ops-incident-section ops-workspace-information"><div className="ops-section-title"><div><small>INCIDENT INFORMATION</small><h3>Incident information</h3></div></div><dl className="ops-detail-grid"><dt>First seen</dt><dd>{formatIncidentDate(selected.incident.firstSeen)}</dd><dt>Resolved at</dt><dd>{formatIncidentDate(selected.incident.resolvedAt)}</dd><dt>Duration</dt><dd>{formatDuration(selected.incident.durationMinutes)}</dd><dt>Alert email received</dt><dd>{formatDate(selected.incident.receivedAt)}</dd><dt>Occurrences</dt><dd>{selected.incident.occurrenceCount ?? '-'}</dd><dt>Current owner</dt><dd>{selected.incident.assignedTo || 'Unassigned'}</dd></dl></section>
      {alertDetails.length > 0 && <section className="ops-alert-details ops-workspace-alert"><details open><summary>Monitoring alert details</summary><dl className="ops-detail-grid">{alertDetails.map(({ label, value }) => <Fragment key={label}><dt>{label}</dt><dd>{value}</dd></Fragment>)}</dl></details></section>}
      <details className="ops-technical-details ops-workspace-technical"><summary>Technical details</summary><dl className="ops-detail-grid"><dt>Technical incident ID</dt><dd><code className="ops-technical-id">{selected.incident.incidentId || '-'}</code></dd><dt>SharePoint ID</dt><dd>{selected.incident.sharePointId ?? '-'}</dd><dt>Source message ID</dt><dd><code>{selected.incident.lastSourceMessageId || '-'}</code></dd><dt>Flow run ID</dt><dd><code>{selected.incident.flowRunId || '-'}</code></dd><dt>Last updated</dt><dd>{formatDate(selected.incident.lastSyncedAt)}</dd></dl></details>
      {selected.incident.errorDetail && <div className="ops-error"><strong>Power Automate error</strong><span>{selected.incident.errorDetail}</span></div>}
      <section className="ops-work-items ops-workspace-work-items"><div className="ops-section-title"><div><small>AZURE DEVOPS</small><h3>Azure DevOps work items</h3></div><strong>{selected.incident.workItemSummary.closed}/{selected.incident.workItemSummary.total} closed</strong></div>
        {selected.incident.workItems.length === 0 ? <p className="ops-muted">Primary Work Item has not been created by the production workflow.</p> : selected.incident.workItems.map(item => <article className="ops-work-item-row" key={item.workItemId}><div><span className={`ops-work-item-role is-${item.role.toLowerCase()}`}>{item.role}</span><strong>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">#{item.workItemId}</a> : `#${item.workItemId}`}</strong><small>{item.supportTeam || 'Unknown team'} · {item.assignedTo || 'Unassigned'}</small></div><AdoStateBadge value={item.state} /></article>)}
      </section>
      <section className="ops-action-panel ops-workspace-actions"><div className="ops-section-title"><div><small>INCIDENT ACTIONS</small><h3>Incident controls</h3></div><span className={`ops-connection-pill ${connection?.connected ? 'is-connected' : ''}`}>{connection?.connected ? `Connected: ${connection.adoIdentity?.email || connection.user}` : 'ADO not connected'}</span></div>
        {actionError && <div className="ops-inline-error">{actionError}</div>}{actionMessage && <div className="ops-inline-success">{actionMessage}</div>}
        {!connection?.connected && <button className="ops-button ops-button-wide" onClick={() => window.location.assign('/api/ado-auth-start?returnTo=' + encodeURIComponent('/operations.html#/incidents'))}>Connect Azure DevOps</button>}
        {!capabilities.createRelated && !capabilities.linkExisting && !capabilities.synchronize && !capabilities.closeIncident && !capabilities.manualCloseIncident && !capabilities.restartAppService && <p className="ops-muted">Operations Hub write actions are disabled by the administrator.</p>}
        <div className="ops-action-group"><h4>Tier1 actions</h4><p className="ops-muted">Run the approved action and automatically record the result in the primary VSTS Discussion.</p><button className="ops-button ops-button-danger" disabled={busy || !connection?.connected || !capabilities.restartAppService || !selected.incident.resource} onClick={restartSelectedAppService}>{busy ? 'Working…' : 'Restart App Service'}</button></div>
        <div className="ops-action-group"><h4>Escalation workspace</h4><p className="ops-muted">No team is selected automatically. Select one team or both teams, then preview before creating. Description is copied from the current Tier 1 Primary Ticket.</p>
          <div className="ops-target-selector">{(['APP_SUPPORT', 'TIER2'] as const).map(team => { const exists = selected.incident.workItems.some(item => item.role === 'RELATED' && item.supportTeam === team); return <label key={team}><input type="checkbox" checked={escalationTargets.includes(team)} disabled={exists} onChange={() => toggleEscalationTarget(team)} /> {team === 'APP_SUPPORT' ? 'App Support' : 'IT Tier 2 / Infra'} <small>{exists ? 'Already linked' : team === 'APP_SUPPORT' ? 'Service Form' : 'IT Support Case'}</small></label>; })}</div>
          <button className="ops-button ops-button-secondary" onClick={previewMappings} disabled={busy || escalationTargets.length === 0}>Preview selected tickets</button>
          {escalationTargets.map(team => { const preview = mappingPreviews[team]; return preview ? <article className="ops-ticket-preview" key={team}><dl className="ops-mapping-preview"><dt>Target</dt><dd>{team === 'APP_SUPPORT' ? 'App Support' : 'IT Tier 2 / Infra'}</dd><dt>Project / Type</dt><dd>{preview.mapping.adoProject} · {preview.mapping.workItemType}</dd><dt>Area Path</dt><dd>{preview.mapping.areaPath}</dd><dt>Assigned To</dt><dd>{preview.mapping.assignedTeam || 'Unassigned'}</dd><dt>Tags</dt><dd>{preview.tags || 'No tags'}</dd><dt>Source</dt><dd>Primary #{preview.primaryWorkItemId}</dd></dl><div className="ops-preview-field"><strong>Title</strong><span>{preview.title}</span></div><details><summary>Description copied from Tier 1</summary><pre>{preview.descriptionText || 'No description'}</pre></details></article> : null; })}
          <button className="ops-button" disabled={busy || !connection?.connected || !capabilities.createRelated || escalationTargets.length === 0 || escalationTargets.some(team => !mappingPreviews[team])} onClick={createSelectedTickets}>{escalationTargets.length === 0 ? 'Select a team to continue' : `Create ${escalationTargets.length} ticket${escalationTargets.length > 1 ? 's' : ''}: ${escalationTargets.map(team => team === 'APP_SUPPORT' ? 'App Support' : 'IT Tier 2').join(' + ')}`}</button>
        </div>
        <div className="ops-closure"><h4>Closure checklist</h4><p className="ops-muted">Readiness: {isOperationsClosed(selected.incident) ? 'Closed' : displayStatus(selected.incident.closeEligibility?.readinessStatus || 'CHECKING')}</p><ul><li className={selected.incident.workItemSummary.total > 0 ? 'is-done' : ''}>Primary Work Item exists</li><li className={selected.incident.workItemSummary.open === 0 && selected.incident.workItemSummary.total > 0 ? 'is-done' : ''}>All Work Items are closed</li><li className={selected.incident.status === 'RESOLVED' ? 'is-done' : ''}>Monitoring alert is recovered (recommended)</li></ul>{!isOperationsClosed(selected.incident) && selected.incident.closeEligibility?.reasons.map(reason => <small key={reason}>{reason}</small>)}{!isOperationsClosed(selected.incident) && selected.incident.closeEligibility?.warnings?.map(warning => <small className="ops-closure-warning" key={warning}>{warning}</small>)}<div className="ops-card-actions"><button className="ops-button ops-button-secondary" disabled={busy || !connection?.connected || !capabilities.synchronize} onClick={() => runAction(() => operationsApi.synchronize(selected.incident.incidentId), 'Work Item states synchronized')}>Synchronize</button><button className="ops-button" disabled={busy || !connection?.connected || !capabilities.closeIncident || !selected.incident.closeEligibility?.allowed || isOperationsClosed(selected.incident)} onClick={closeSelectedIncident}>{isOperationsClosed(selected.incident) ? 'Incident Closed' : busy ? 'Closing…' : 'Close Incident'}</button>{!isOperationsClosed(selected.incident) && selected.incident.hasLifecycleConflict && <button className="ops-button ops-button-danger" disabled={busy || !capabilities.manualCloseIncident} onClick={manualCloseSelectedIncident}>Manual Override / Force Close</button>}</div></div>
      </section>
      <details className="ops-timeline ops-workspace-timeline"><summary><span><small>ACTIVITY</small><strong>Incident timeline</strong></span><em>View timeline</em></summary><div className="ops-timeline-content"><div className="ops-timeline-head"><span>Incident activity history</span><button type="button" className="ops-button ops-button-secondary" onClick={event => { event.preventDefault(); setShowTechnicalEvents(value => !value); }}>{showTechnicalEvents ? 'Hide system activity' : 'Show system activity'}</button></div>{timelineForDisplay(selected.timeline, showTechnicalEvents).map(event => <div key={event.eventId}><span /><p><strong>{humanizeEventType(event.eventType)}</strong><small>{event.detail || event.result} · {formatDate(event.timestamp)}</small>{(event.operationsUserEmail || event.adoIdentityEmail) && <small className="ops-audit-identities">Operations: {event.operationsUserEmail || 'Unknown'} · Azure DevOps: {event.adoIdentityEmail || 'Unknown'}</small>}</p></div>)}</div></details>
      </div>
      </>}
    </aside></div>}
  </section>;
}

function SummaryCard({ tone, label, value, detail }: { tone: 'success' | 'danger' | 'warning' | 'active' | 'neutral'; label: string; value: string; detail: string }) {
  return <article className={`ops-summary-card ops-summary-card-${tone}`}><small>{label}</small><strong>{value}</strong><span>{detail}</span></article>;
}

function formatDate(value?: string) {
  const timestamp = parseTimestamp(value);
  return timestamp
    ? timestamp.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })
    : '-';
}

function formatIncidentDate(value?: string) {
  const timestamp = parseTimestamp(value);
  if (!timestamp) return '-';
  return timestamp.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' });
}

// SharePoint/API timestamps are UTC instants. Treat timezone-less ISO values as UTC
// instead of allowing the browser's local timezone to reinterpret them.
function parseTimestamp(value?: string) {
  if (!value) return undefined;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const timestamp = new Date(normalized);
  return Number.isFinite(timestamp.getTime()) ? timestamp : undefined;
}

function formatClock(value: Date) {
  return value.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' });
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

function humanizeEventType(value: string) {
  return value.replace(/^ALERT_RECEIVED$/, 'Alert received')
    .replace(/^ALERT_FIRING$/, 'Alert detected')
    .replace(/^ALERT_RESOLVED$/, 'Alert recovered')
    .replace(/^APPROVAL_REQUESTED$/, 'Approval requested')
    .replace(/^APPROVAL_COMPLETED$/, 'Approval completed')
    .replace(/^ADO_WORK_ITEM_CREATED$/, 'Work item created')
    .replace(/^ADO_WORK_ITEM_CLOSED$/, 'Work item closed')
    .replace(/^INCIDENT_CLOSED$/, 'Incident closed')
    .replace(/^WORK_ITEMS_SYNCED$/, 'Work items synchronized')
    .replace(/^SYNCHRONIZE_WORK_ITEMS$/, 'Work items synchronized')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^./, character => character.toUpperCase());
}

function incidentRouteParams() {
  const query = window.location.hash.split('?')[1] || '';
  return new URLSearchParams(query);
}

function lifecycleIssueMessage(issues: string[]) {
  if (issues.includes('ALERT_FIRING_WORK_ITEM_CLOSED')) return 'Monitoring still reports FIRING although the tracked Azure DevOps work item is closed.';
  if (issues.includes('RESOLVED_TIMESTAMP_MISSING')) return 'The alert is resolved but Resolved At is missing.';
  if (issues.includes('RESOLVED_WORKFLOW_STILL_ACTIVE')) return 'The alert is resolved while the workflow is still active.';
  return 'Monitoring, workflow, and work-item states are not aligned.';
}

function isActiveIncident(item: Incident) {
  return !isOperationsClosed(item)
    && item.trackingStatus !== 'CLOSED'
    && !isWaitingForResolved(item)
    && !isWaitingForSupport(item)
    && !isReadyToClose(item)
    && !isActionRequired(item);
}

function isWaitingForResolved(item: Incident) {
  return !isOperationsClosed(item)
    && item.status === 'FIRING'
    && item.workItemSummary.total > 0
    && item.workItemSummary.open === 0;
}

function isWaitingForSupport(item: Incident) {
  return !isOperationsClosed(item)
    && !['PENDING', 'FAILED', 'NOT_CREATED'].includes(item.trackingStatus)
    && item.workItems.some(workItem => workItem.role === 'RELATED' && !isClosedWorkItemState(workItem.state));
}

function isReadyToClose(item: Incident) {
  return !isOperationsClosed(item) && item.status === 'RESOLVED' && item.workItemSummary.total > 0 && item.workItemSummary.open === 0;
}

function isActionRequired(item: Incident) {
  return !isOperationsClosed(item) && !isWaitingForSupport(item) && !isWaitingForResolved(item) && !isReadyToClose(item) && (['PENDING', 'FAILED', 'NOT_CREATED'].includes(item.trackingStatus)
    || Boolean(item.hasLifecycleConflict && !isWaitingForResolved(item)));
}

function displayLifecycle(item: Incident) {
  if (isOperationsClosed(item)) return 'CLOSED';
  if (isReadyToClose(item)) return 'READY_TO_CLOSE';
  if (isWaitingForResolved(item)) return 'WAITING_RESOLVED';
  if (isWaitingForSupport(item)) return 'WAITING_SUPPORT';
  return item.trackingStatus;
}

function isClosedWorkItemState(value?: string) {
  return ['CLOSED', 'DONE', 'REMOVED', 'RESOLVED', 'REJECT', 'REJECTED'].includes(String(value || '').trim().toUpperCase());
}

function timelineForDisplay(events: AuditEvent[], showTechnical: boolean) {
  if (showTechnical) return events;
  const syncEvents = events.filter(event => event.eventType === 'SYNCHRONIZE_WORK_ITEMS');
  const visible = events.filter(event => !['SYNCHRONIZE_WORK_ITEMS', 'LAST_SYNCED'].includes(event.eventType));
  if (syncEvents.length > 0) {
    const latest = syncEvents.reduce((left, right) => Date.parse(left.timestamp) >= Date.parse(right.timestamp) ? left : right);
    visible.push({ ...latest, eventId: `WORK_ITEMS_SYNCED_SUMMARY:${latest.eventId}`, eventType: 'WORK_ITEMS_SYNCED', detail: `${latest.detail || latest.result} · ${syncEvents.length} synchronization${syncEvents.length === 1 ? '' : 's'} recorded` });
  }
  return visible.sort((left, right) => (Date.parse(right.timestamp) || 0) - (Date.parse(left.timestamp) || 0));
}

function isOperationsClosed(item: Incident) {
  return String(item.operationsStatus || '').toUpperCase() === 'CLOSED';
}

function approvalStatus(item: Incident) {
  const outcome = String(item.approvalOutcome || '').trim().toUpperCase();
  const workflow = String(item.workflowStatus || '').trim().toUpperCase();
  if (['APPROVE', 'APPROVED'].includes(outcome) || workflow.includes('APPROVED')) return 'APPROVED';
  if (['REJECT', 'REJECTED'].includes(outcome) || workflow.includes('REJECTED')) return 'REJECTED';
  if (item.approvalCompletedAt) return outcome || 'COMPLETED';
  if (item.approvalRequestedAt || item.approvalId || workflow.includes('APPROVAL')) return 'AWAITING_APPROVAL';
  return 'NOT_REQUESTED';
}

function incidentProgress(item: Incident) {
  if (isOperationsClosed(item)) return 'INCIDENT_CLOSED';
  const relatedTeams = new Set(item.workItems
    .filter(workItem => workItem.role === 'RELATED')
    .map(workItem => workItem.supportTeam));
  if (relatedTeams.has('APP_SUPPORT') && relatedTeams.has('TIER2')) return 'BOTH_TEAMS_CREATED';
  if (relatedTeams.has('APP_SUPPORT')) return 'APP_SUPPORT_CREATED';
  if (relatedTeams.has('TIER2')) return 'TIER2_CREATED';
  const approval = approvalStatus(item);
  if (approval === 'APPROVED') return 'APPROVED';
  if (approval === 'REJECTED') return 'REJECTED';
  if (approval === 'AWAITING_APPROVAL') return 'AWAITING_APPROVAL';
  if (item.workItemId) return 'PRIMARY_CREATED';
  return item.workflowStatus || 'RECEIVED';
}

function compareIncidentNumberDescending(left: Incident, right: Incident) {
  const sequence = (item: Incident) => item.sharePointId ?? Number(item.displayId.match(/(\d+)$/)?.[1] || 0);
  return sequence(right) - sequence(left);
}

function formatDuration(value?: number) {
  return Number.isFinite(value) ? `${value} min` : '-';
}
