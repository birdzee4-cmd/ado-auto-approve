import { Fragment, useEffect, useRef, useState } from 'react';
import { loadAdoConnection, operationsApi } from '../api';
import { AdoStateBadge, displayStatus, EmptyState, ErrorState, formatBangkokTimestamp, LoadingState, PageHeading, parseUtcTimestamp, StatusBadge } from '../components';
import type { AdoConnectionStatus, AuditEvent, Incident, OperationsCapabilities, RelatedTicketPreview } from '../types';
import { isOperationsClosed, isReadyToClose, isWaitingForAlertRecovery, isWaitingForSupport, operationsStatus } from '../incidentStatus';

function incidentMonthRange() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [year, month] = today.slice(0, 7).split('-').map(Number);
  const nextMonth = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  return { from: `${today.slice(0, 7)}-01T00:00:00+07:00`, to: `${nextMonth}-01T00:00:00+07:00` };
}

export function Incidents({ isAdmin = false }: { isAdmin?: boolean }) {
  const routeParams = incidentRouteParams();
  const [items, setItems] = useState<Incident[] | null>(null);
  const [overviewItems, setOverviewItems] = useState<Incident[]>([]);
  const [followUpTotal, setFollowUpTotal] = useState(0);
  const [selected, setSelected] = useState<{ incident: Incident; timeline: AuditEvent[] } | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [showTechnicalEvents, setShowTechnicalEvents] = useState(false);
  // Open the Incident page on actionable work by default. Explicit status
  // links still apply their requested filter.
  const [status, setStatus] = useState(routeParams.get('status') === 'ACTIVE' ? 'FOLLOW_UP' : routeParams.get('status') || 'FOLLOW_UP');
  const [search, setSearch] = useState(routeParams.get('search') || '');
  const [periodScope, setPeriodScope] = useState('current-month');
  const [resultLimit, setResultLimit] = useState('1000');
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
  const [syncScope, setSyncScope] = useState('page');
  const [syncProgress, setSyncProgress] = useState('');
  const [syncResults, setSyncResults] = useState<Array<{ incidentId: string; ok: boolean; skipped?: boolean; detail?: string }>>([]);
  const syncRunning = useRef(false);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [batchReview, setBatchReview] = useState<Incident[] | null>(null);
  const [batchNote, setBatchNote] = useState('');
  const [batchResults, setBatchResults] = useState<Array<{ id: string; label: string; result: string; failed: boolean }>>([]);
  const batchRunning = useRef(false);
  const batchDialog = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!batchReview) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = batchDialog.current;
    dialog?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !batchRunning.current) setBatchReview(null);
      if (event.key !== 'Tab' || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)'));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, [batchReview]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const refreshInFlight = useRef(false);
  const hasLoadedOnce = useRef(false);
  const detailReturnScrollTop = useRef(0);
  const [connection, setConnection] = useState<AdoConnectionStatus | null>(null);
  const [capabilities, setCapabilities] = useState<OperationsCapabilities>({ createRelated: false, linkExisting: false, synchronize: false, closeIncident: false, manualCloseIncident: false, manualAlertStatus: false, restartAppService: false, globalAutoRestart: false });
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
  const assigneeOptions = [...new Set(overviewItems.map(item => normalizeAssignee(item.assignedTo)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const alertOptions = [...new Set(overviewItems.map(item => item.status).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const adoStateOptions = [...new Set(overviewItems.map(item => item.adoState?.trim()).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
  const operationsStatusOptions = [...new Set(overviewItems.map(operationsStatus))].sort((a, b) => a.localeCompare(b));
  const queueOptions = [
    { value: 'ACTION_REQUIRED', label: 'Needs action', count: overviewItems.filter(isActionRequired).length },
    { value: 'WAITING_RESOLVED', label: 'Awaiting alert recovery', count: overviewItems.filter(item => operationsStatus(item) === 'WAITING_RESOLVED').length },
    { value: 'READY_TO_CLOSE', label: 'Ready to close', count: overviewItems.filter(item => operationsStatus(item) === 'READY_TO_CLOSE').length },
    { value: 'FOLLOW_UP', label: 'Follow up', count: followUpTotal },
    { value: '', label: 'All incidents', count: overviewItems.length },
  ];
  const filteredItems = sortedItems.filter(item => {
    if (alertStatus && item.status !== alertStatus) return false;
    if (adoState === 'NOT_CREATED' && item.workItemId) return false;
    if (adoState === 'UNKNOWN' && (!item.workItemId || item.adoState)) return false;
    if (adoState && !['NOT_CREATED', 'UNKNOWN'].includes(adoState) && item.adoState?.toUpperCase() !== adoState.toUpperCase()) return false;
    if (assignee && normalizeAssignee(item.assignedTo) !== assignee) return false;
    if (lifecycle && operationsStatus(item) !== lifecycle) return false;
    return true;
  });
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleItems = filteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  // The batch action uses the guarded manual-close endpoint for recovered
  // legacy incidents. It must remain visible when manual close is enabled
  // even if the standard close capability is disabled.
  const canBatchClose = (capabilities.closeIncident || capabilities.manualCloseIncident) && connection?.connected;
  const eligibleVisible = visibleItems.filter(item => {
    if (operationsStatus(item) === 'READY_TO_CLOSE' && item.status === 'RESOLVED' && !item.hasLifecycleConflict) return true;
    return item.status === 'RESOLVED' && (Boolean(item.hasLifecycleConflict) || hasInvalidResolutionTimeline(item)) && Number(item.workItemSummary?.total || 0) > 0 && Number(item.workItemSummary?.open || 0) === 0;
  });
  const checkedVisible = eligibleVisible.filter(item => checkedIds.includes(item.incidentId));
  useEffect(() => { setCheckedIds([]); }, [status, search, alertStatus, adoState, lifecycle, assignee, currentPage]);
  const syncCandidates = (syncScope === 'page' ? visibleItems : filteredItems).filter(item => item.workItemSummary.total > 0);
  const synchronizeIncidents = async (retryIds?: string[]) => {
    if (syncRunning.current || busy || refreshing) return;
    const ids = retryIds || syncCandidates.map(item => item.incidentId);
    if (!ids.length) return;
    syncRunning.current = true; setBusy(true); setSyncResults([]);
    const results: typeof syncResults = [];
    try {
      for (const [index, incidentId] of ids.entries()) {
        setSyncProgress('Synchronizing… ' + index + '/' + ids.length);
        try {
          const response = await operationsApi.synchronize(incidentId);
          const failed = response.items.filter(item => !item.ok);
          results.push({ incidentId, ok: failed.length === 0, detail: failed.map(item => '#' + item.workItemId + ' (HTTP ' + (item.status || 'unknown') + ')').join(', ') });
        } catch (err) {
          results.push({ incidentId, ok: false, detail: (err as Error).message });
        }
        setSyncResults([...results]);
        setSyncProgress('Synchronizing… ' + (index + 1) + '/' + ids.length);
      }
      setSyncResults(results);
      await load(true);
    } finally { syncRunning.current = false; setSyncProgress(''); setBusy(false); }
  };
  const overview = {
    total: overviewItems.length,
    open: followUpTotal,
    actionRequired: overviewItems.filter(isActionRequired).length,
    waiting: overviewItems.filter(item => operationsStatus(item) === 'WAITING_RESOLVED').length,
    readyToClose: overviewItems.filter(item => operationsStatus(item) === 'READY_TO_CLOSE').length,
    closed: overviewItems.filter(isOperationsClosed).length
  };

  const load = async (preservePage = true) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    setError('');
    try {
      // Do not let the inventory refresh hide a successful incident-list read.
      // Both requests hit SharePoint and a transient failure in the second one
      // previously caused the whole page to show an error while retaining stale rows.
      // The API returns primary incident rows without loading audit and
      // supporting work-item lists for every explorer refresh. Reusing one
      // request also prevents search from doubling SharePoint traffic.
      const range = periodScope === 'current-month' ? incidentMonthRange() : {};
      const allPromise = operationsApi.incidents('', search, { limit: resultLimit, ...range });
      const followUpSummaryPromise = operationsApi.incidents('', '', { summary: 'follow-up' });
      const inventoryPromise = allPromise;
      const [allResult, inventoryResult, followUpResult] = await Promise.allSettled([allPromise, inventoryPromise, followUpSummaryPromise]);
      const all = allResult.status === 'fulfilled' ? allResult.value : null;
      const inventory = inventoryResult.status === 'fulfilled' ? inventoryResult.value : all;
      if (!all && !inventory) throw (allResult.status === 'rejected' ? allResult.reason : inventoryResult.status === 'rejected' ? inventoryResult.reason : new Error('Unable to read Operations Hub incidents'));
      const sourceItems = all?.items || [];
      setItems(sourceItems.filter(item => {
        if (status === 'OPEN_INCIDENTS' || status === 'FOLLOW_UP') return isFollowUpItem(item);
        if (status === 'ATTENTION') return isFollowUpItem(item);
        if (status === 'ACTION_REQUIRED') return isActionRequired(item);
        return !status || operationsStatus(item) === status;
      }));
      setOverviewItems(inventory?.items || sourceItems);
      if (followUpResult.status === 'fulfilled') setFollowUpTotal(followUpResult.value.count || 0);
      if (allResult.status === 'rejected' || inventoryResult.status === 'rejected' || followUpResult.status === 'rejected') {
        setError('บางข้อมูลอาจอัปเดตไม่ครบ กรุณากด Refresh now เพื่อลองใหม่');
      }
      if (!preservePage) setPage(1);
      setLastUpdatedAt(new Date());
      hasLoadedOnce.current = true;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  };
  useEffect(() => { void load(false); }, [status, periodScope, resultLimit]);
  useEffect(() => {
    const refreshWhenSafe = () => {
      if (hasLoadedOnce.current && document.visibilityState === 'visible' && !busy && !selected && !batchReview) void load();
    };
    const intervalId = window.setInterval(refreshWhenSafe, 30 * 60_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshWhenSafe();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [status, search, busy, selected, batchReview]);
  useEffect(() => { loadAdoConnection().then(setConnection).catch(() => setConnection({ connected: false })); }, []);
  useEffect(() => { operationsApi.capabilities().then(setCapabilities).catch(() => setCapabilities({ createRelated: false, linkExisting: false, synchronize: false, closeIncident: false, manualCloseIncident: false, manualAlertStatus: false, restartAppService: false, globalAutoRestart: false })); }, []);

  const toggleGlobalAutoRestart = async () => {
    const next = !capabilities.globalAutoRestart;
    const prompt = next
      ? 'Enable automatic Restart App Service for all qualifying P1 incidents? This may restart Production App Services after 5 minutes.'
      : 'Disable global automatic Restart App Service?';
    if (!window.confirm(prompt)) return;
    setBusy(true);
    try {
      const updated = await operationsApi.setGlobalAutoRestart(next) as OperationsCapabilities & { enabled?: boolean };
      setCapabilities(value => ({ ...value, ...updated, globalAutoRestart: updated.enabled ?? next }));
      setActionMessage(next ? 'Global Auto-Restart enabled.' : 'Global Auto-Restart disabled.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update global Auto-Restart.');
    } finally { setBusy(false); }
  };

  const openIncident = async (id: string, preserveFeedback = false) => {
    detailReturnScrollTop.current = window.scrollY;
    setSelectedLoading(true);
    try {
      const detail = await operationsApi.incident(id);
      // Read-model detail is intentionally lightweight. Preserve the primary
      // Work Item shown by the row even when the enriched workItems array is
      // unavailable because SharePoint is slow or throttled.
      const incident = detail.incident;
      if ((!incident.workItems || incident.workItems.length === 0) && incident.workItemId) {
        incident.workItems = [{
          workItemId: incident.workItemId,
          incidentId: incident.incidentId,
          role: 'PRIMARY',
          supportTeam: 'TIER1',
          state: incident.adoState || 'Unknown',
          url: incident.workItemUrl,
          assignedTo: incident.assignedTo,
          source: 'EXISTING_INCIDENT'
        }];
        incident.workItemSummary = {
          total: Math.max(1, incident.workItemSummary?.total || 0),
          closed: incident.workItemSummary?.closed || 0,
          open: incident.workItemSummary?.open || (String(incident.adoState || '').toUpperCase() === 'CLOSED' ? 0 : 1)
        };
      }
      setSelected({ ...detail, incident });
      setShowTechnicalEvents(false);
      setEscalationTargets([]);
      if (!preserveFeedback) {
        setActionError('');
        setActionMessage('');
      }
      setMappingPreviews({});
    } catch (err) {
      if (preserveFeedback) {
        setActionError(`Action completed, but the detail refresh failed: ${(err as Error).message}`);
      } else {
        setError((err as Error).message);
      }
    }
    finally { setSelectedLoading(false); }
  };
  const closeIncidentDetails = () => {
    setSelected(null);
    setSelectedLoading(false);
    window.requestAnimationFrame(() => window.scrollTo({ top: detailReturnScrollTop.current, behavior: 'auto' }));
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
      // The write and the follow-up refresh are separate operations. A slow
      // SharePoint/read-model refresh must not make a successful button
      // action appear to have failed.
      try {
        await openIncident(selected.incident.incidentId, true);
        await load();
      } catch (refreshError) {
        setActionError(`Action completed, but the display refresh failed: ${(refreshError as Error).message}`);
      }
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

  const manualAlertStatusSelectedIncident = async () => {
    if (!selected) return;
    const recovered = selected.incident.status !== 'RESOLVED';
    const nextStatus = recovered ? 'RESOLVED' : 'FIRING';
    const label = recovered ? 'Recovered' : 'Active';
    const reason = window.prompt(`Reason for changing Alert status to ${label} (minimum 10 characters):`, recovered ? 'Monitoring alert recovered but the event was not recorded' : 'Monitoring alert is active again');
    if (!reason || reason.trim().length < 10) return;
    if (!window.confirm(`Confirm changing Alert status to ${label}?\n\nReason: ${reason.trim()}`)) return;
    await runAction(() => operationsApi.manualAlertStatus(selected.incident.incidentId, nextStatus, reason.trim()), `Alert status changed to ${label}. Audit recorded.`);
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

  const closeBatch = async (targets: Incident[]) => {
    if (batchRunning.current || !canBatchClose || targets.length === 0 || targets.length > 20) return;
    batchRunning.current = true;
    setBusy(true);
    setBatchResults(current => current.filter(result => !targets.some(item => item.incidentId === result.id)));
    const batchId = globalThis.crypto.randomUUID();
    try {
      for (const [index, item] of targets.entries()) {
        // Give SharePoint/ADO a short recovery window between closure writes.
        // Bulk close remains sequential; pacing prevents a burst of Graph
        // writes from turning a partially successful batch into HTTP 429s.
        // Keep a wider recovery window, especially when this is a retry of
        // failed items after SharePoint returned 429/5xx responses.
        if (index > 0) await new Promise(resolve => setTimeout(resolve, 3000));
        let result: string;
        let failed = false;
        try {
          // The ready/legacy picker is already restricted to recovered
          // incidents whose list summary reports all Work Items closed. Use
          // the same guarded override as the working single-incident button;
          // the API re-verifies both conditions before writing the closure.
          await operationsApi.manualClose(item.incidentId, batchNote.trim() || 'Legacy timeline override: recovered alert and all VSTS Work Items verified closed');
          result = 'Legacy override closed';
        } catch (err) {
          result = (err as Error).message;
          failed = true;
        }
        setBatchResults(current => [...current, { id: item.incidentId, label: item.displayId || item.incidentId, result, failed }]);
      }
      setCheckedIds([]);
      await load();
    } finally {
      batchRunning.current = false;
      setBusy(false);
    }
  };

  return <section className="ops-incidents-page">
    <PageHeading eyebrow="Incident command center" title="Incidents" actions={<div className={`ops-refresh-status${refreshing ? ' is-refreshing' : ''}`}><div className="ops-system-status"><span className="ops-live-label"><i /> Live from incident read model</span><small>{lastUpdatedAt ? `Updated ${formatClock(lastUpdatedAt)} Bangkok` : 'Waiting for first update'} · Auto every 30 min</small>{refreshing && <span className="ops-refreshing-indicator" role="status" aria-live="polite"><i className="ops-spinner" /> Updating incident list…</span>}</div><div className="ops-sync-controls"><select aria-label="Synchronization scope" value={syncScope} disabled={busy || refreshing} onChange={event => { setSyncScope(event.target.value); setSyncResults([]); }}><option value="page">Current page (include closed)</option><option value="results">Current results (all pages, include closed)</option></select><button className="ops-button ops-button-secondary" type="button" disabled={busy || refreshing || !connection?.connected || !capabilities.synchronize || !syncCandidates.length} title="Same synchronization as each incident detail, applied to incidents in the selected scope" onClick={() => void synchronizeIncidents()}>{syncProgress || 'Synchronize (' + syncCandidates.length + ')'}</button></div><div className="ops-admin-controls">{isAdmin && <><span className={`ops-live-label${capabilities.globalAutoRestart ? '' : ' is-muted'}`} role="status" aria-live="polite"><i /> Auto-Restart: {capabilities.globalAutoRestart ? 'ON' : 'OFF'}</span><button className={`ops-button ${capabilities.globalAutoRestart ? 'ops-button-danger' : 'ops-button-secondary'}`} type="button" disabled={busy || refreshing} onClick={() => void toggleGlobalAutoRestart()}>{capabilities.globalAutoRestart ? 'Emergency Stop Auto-Restart' : 'Enable Global Auto-Restart'}</button></>}</div></div>} />
    <div role="status" aria-live="polite">{syncProgress || (!syncCandidates.length && items ? 'No work items to synchronize in the selected scope.' : '')}</div>
    {syncResults.length > 0 && <div className="ops-sync-summary"><p role="status">{syncProgress ? 'Synchronization progress:' : 'Synchronization complete:'} {syncResults.filter(item => item.ok && !item.skipped).length} succeeded · {syncResults.filter(item => item.skipped).length} skipped · {syncResults.filter(item => !item.ok).length} failed.</p>{syncResults.some(item => !item.ok) && <><button className="ops-button ops-button-secondary" disabled={busy || refreshing || !connection?.connected || !capabilities.synchronize} onClick={() => void synchronizeIncidents(syncResults.filter(item => !item.ok).map(item => item.incidentId))}>Retry failed incidents</button><ul>{syncResults.filter(item => !item.ok).map(item => <li key={item.incidentId}>{overviewItems.find(incident => incident.incidentId === item.incidentId)?.displayId || item.incidentId}: {item.detail}</li>)}</ul></>}</div>}

    <div className="ops-incident-overview" aria-label="Incident overview">
      <button className={status === 'ACTION_REQUIRED' ? 'is-active is-warning' : overview.actionRequired > 0 ? 'is-warning is-critical' : ''} onClick={() => setStatus('ACTION_REQUIRED')}><span>Needs action</span><strong>{overview.actionRequired}</strong><small>Review or take action</small></button>
      <button className={status === 'WAITING_RESOLVED' ? 'is-active' : ''} onClick={() => setStatus('WAITING_RESOLVED')}><span>Awaiting alert recovery</span><strong>{overview.waiting}</strong><small>Alert still firing</small></button>
      <button className={status === 'READY_TO_CLOSE' ? 'is-active' : ''} onClick={() => setStatus('READY_TO_CLOSE')}><span>Ready to close</span><strong>{overview.readyToClose}</strong><small>Alert recovered, tickets closed</small></button>
      <button className={status === 'FOLLOW_UP' || status === 'OPEN_INCIDENTS' ? 'is-active' : ''} onClick={() => { setStatus('FOLLOW_UP'); setPeriodScope('all'); setResultLimit('all'); setPage(1); }}><span>Follow up</span><strong>{overview.open}</strong><small>All open follow-up work</small></button>
      <button className={status === '' ? 'is-active' : ''} onClick={() => setStatus('')}><span>All incidents</span><strong>{overview.total}</strong><small>Active and closed history</small></button>
    </div>
    <div className="ops-incident-data-controls" aria-label="Incident data scope">
      <label className={`ops-filter-control${periodScope !== 'current-month' ? ' is-selected' : ''}`}><span>PERIOD</span><select value={periodScope} onChange={e => { setPeriodScope(e.target.value); setPage(1); }} aria-label="Filter by period"><option value="current-month">Current month</option><option value="all">All time</option></select></label>
      <label className={`ops-filter-control${resultLimit !== '1000' ? ' is-selected' : ''}`}><span>LOAD</span><select value={resultLimit} onChange={e => { setResultLimit(e.target.value); setPage(1); }} aria-label="Number of incidents to load"><option value="1000">1,000</option><option value="2000">2,000</option><option value="all">All</option></select></label>
    </div>
    <div className="ops-incident-controls">
      <form className="ops-incident-search" onSubmit={e => { e.preventDefault(); void load(false); }}><span aria-hidden="true">⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search incidents…" aria-label="Search incidents" /><button className="ops-button" type="submit">Search</button></form>
      <div className="ops-filter-grid">
        <label className={`ops-filter-control${status ? ' is-selected' : ''}`}><span>QUEUE</span><select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by queue">{queueOptions.map(option => <option value={option.value} key={option.value}>{option.label} ({option.count})</option>)}</select></label>
        <label className={`ops-filter-control${alertStatus ? ' is-selected' : ''}`}><span>ALERT</span><select value={alertStatus} onChange={e => { setAlertStatus(e.target.value); setPage(1); }}><option value="">All</option>{alertOptions.map(value => <option value={value} key={value}>{displayStatus(value)}</option>)}</select></label>
        <label className={`ops-filter-control${adoState ? ' is-selected' : ''}`}><span>ADO STATE</span><select value={adoState} onChange={e => { setAdoState(e.target.value); setPage(1); }}><option value="">All</option>{adoStateOptions.map(value => <option value={value} key={value}>{value}</option>)}{overviewItems.some(item => !item.workItemId) && <option value="NOT_CREATED">Not created</option>}{overviewItems.some(item => item.workItemId && !item.adoState) && <option value="UNKNOWN">Unknown</option>}</select></label>
        <label className={`ops-filter-control${lifecycle ? ' is-selected' : ''}`}><span>OPERATIONS STATUS</span><select value={lifecycle} onChange={e => { setLifecycle(e.target.value); setPage(1); }}><option value="">All</option>{operationsStatusOptions.map(value => <option value={value} key={value}>{displayStatus(value)}</option>)}</select></label>
        <label className={`ops-filter-control${assignee ? ' is-selected' : ''}`}><span>ASSIGNEE</span><select value={assignee} onChange={e => { setAssignee(e.target.value); setPage(1); }}><option value="">All</option>{assigneeOptions.map(value => <option value={value} key={value}>{value}</option>)}</select></label>
        <button className="ops-button ops-button-secondary ops-clear-filters" type="button" onClick={() => { setStatus('FOLLOW_UP'); setPeriodScope('current-month'); setResultLimit('1000'); setAlertStatus(''); setAdoState(''); setLifecycle(''); setAssignee(''); setSearch(''); setPage(1); }}>Clear filters</button><button className="ops-button ops-button-secondary ops-refresh-filter" type="button" disabled={refreshing || busy} onClick={() => void load()}>{refreshing ? 'Refreshing…' : 'Refresh now'}</button>
      </div>
    </div>
    {error && <ErrorState message={error} onRetry={load} />}
    {!items && !error && <LoadingState />}
    {items && filteredItems.length === 0 && <EmptyState title="No matching incidents" detail="Change the filter or wait for Power Automate to write an incident to SharePoint." />}
    {items && filteredItems.length > 0 && <div className="ops-incident-results">
      <div className="ops-results-head"><div><strong>{filteredItems.length} incidents</strong><span>Sorted by Incident number, newest first</span></div><small>Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredItems.length)} of {filteredItems.length}</small></div>
      <div className="ops-incident-columns" aria-hidden="true"><span>Incident / alert</span><span>Resource</span><span>ADO state</span><span>Operations status</span><span>Related</span><span>First seen</span><span>Owner</span><span /></div>
      {canBatchClose && <details className="ops-bulk-panel">
        <summary>Close multiple ready/legacy incidents · {eligibleVisible.length} eligible on this page</summary>
        <label><input type="checkbox" disabled={busy || eligibleVisible.length === 0} checked={eligibleVisible.length > 0 && checkedVisible.length === eligibleVisible.length} onChange={e => setCheckedIds(e.target.checked ? eligibleVisible.map(item => item.incidentId) : [])} /> Select all ready incidents on this page (maximum 20)</label>
        <div className="ops-bulk-selection">{eligibleVisible.map(item => <label key={item.incidentId}><input type="checkbox" disabled={busy} checked={checkedIds.includes(item.incidentId)} onChange={e => setCheckedIds(current => e.target.checked ? [...current, item.incidentId] : current.filter(id => id !== item.incidentId))} /><span><strong>{item.displayId || item.incidentId}</strong> · {item.resource || item.service}</span></label>)}</div>
        <button className="ops-button" disabled={busy || checkedVisible.length === 0} onClick={() => { setBatchReview([...checkedVisible]); setBatchResults([]); setBatchNote(''); }}>Close selected incidents ({checkedVisible.length})</button>
      </details>}
      <div className="ops-card-list">{visibleItems.map(item => <button className={`ops-incident-card is-${item.trackingStatus.toLowerCase().replace('_', '-')}${item.hasLifecycleConflict && !isOperationsClosed(item) ? ' has-lifecycle-conflict' : ''}${isOperationsClosed(item) ? ' is-operations-closed' : ''}${operationsStatus(item) === 'READY_TO_CLOSE' ? ' is-ready-to-close' : ''}`} key={item.incidentId} onClick={() => openIncident(item.incidentId)} aria-label={`Open incident ${item.displayId || item.incidentId}`}>
        <span className="ops-incident-main"><span className="ops-incident-id-row"><strong className="ops-incident-display-id">{item.displayId || item.incidentId}</strong><StatusBadge value={item.status} /></span><span className="ops-incident-alert">{humanizeAlert(item.alertName)}</span></span>
        <span className="ops-incident-service"><strong>{item.resource || item.service || 'Unknown resource'}</strong><small>{item.environment || 'Unknown environment'}</small></span>
        <span className="ops-cell-stack ops-incident-ado"><AdoStateBadge value={item.adoState} /><small>{item.workItemId ? `#${item.workItemId}` : 'No work item'}</small></span>
        <StatusBadge value={operationsStatus(item)} />
        <span className="ops-cell-stack ops-incident-related"><strong>{relatedWorkItemCount(item) || '—'}</strong><small>{relatedWorkItemSummary(item)}</small></span>
        <span className="ops-cell-stack ops-incident-time"><strong>{formatRelativeDate(item.firstSeen)}</strong><small>{formatBangkokTimestamp(item.firstSeen, 'en-GB')}</small></span>
        <span className="ops-incident-owner">{item.assignedTo || 'Unassigned'}</span>
        <span className="ops-row-arrow" aria-hidden="true">→</span>
      </button>)}</div>
      {pageCount > 1 && <div className="ops-pagination"><button className="ops-button ops-button-secondary" disabled={currentPage === 1} onClick={() => setPage(1)}>First</button><button className="ops-button ops-button-secondary" disabled={currentPage === 1} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous</button><span>Page {currentPage} of {pageCount}</span><button className="ops-button ops-button-secondary" disabled={currentPage === pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))}>Next</button><button className="ops-button ops-button-secondary" disabled={currentPage === pageCount} onClick={() => setPage(pageCount)}>Last</button></div>}
    </div>}
    {batchReview && <div className="ops-drawer-backdrop"><aside ref={batchDialog} tabIndex={-1} className="ops-detail-drawer ops-bulk-review" role="dialog" aria-modal="true" aria-labelledby="bulk-close-title">
      <div className="ops-bulk-review-content">
      <h2 id="bulk-close-title">Close {batchReview.length} incidents</h2>
      <p>Latest Work Item and alert states will be checked before each closure. Incidents that no longer qualify will be skipped.</p>
      <ul>{batchReview.map(item => <li key={item.incidentId}><strong>{item.displayId || item.incidentId}</strong> · {item.resource || item.service}<br /><small>Recovered: {formatBangkokTimestamp(item.resolvedAt, 'en-GB')} · ADO: {item.adoState || 'Unknown'}</small></li>)}</ul>
      <label>Closure note (optional)<textarea maxLength={1000} disabled={busy || batchResults.length > 0} value={batchNote} onChange={e => setBatchNote(e.target.value)} /></label>
      <div role="status" aria-live="polite">{busy ? `Processing ${batchResults.length} / ${batchReview.length}` : batchResults.length > 0 ? `${batchResults.filter(item => !item.failed && /closed/i.test(item.result)).length} closed · ${batchResults.filter(item => /already closed/i.test(item.result)).length} already closed · ${batchResults.filter(item => item.failed).length} failed / skipped` : ''}</div>
      {batchResults.length > 0 && <ul>{batchResults.map(item => <li key={item.id}>{item.label}: {item.result}</li>)}</ul>}
      </div>
      <div className="ops-card-actions">
        {batchResults.length === 0 && <button className="ops-button" disabled={busy} onClick={() => void closeBatch(batchReview)}>Confirm closure</button>}
        {!busy && batchResults.some(item => item.failed) && <button className="ops-button" onClick={() => void closeBatch(batchReview.filter(item => batchResults.some(result => result.id === item.incidentId && result.failed)))}>Retry failed incidents only</button>}
        <button className="ops-button ops-button-secondary" disabled={busy} onClick={() => setBatchReview(null)}>{batchResults.length ? 'Done' : 'Cancel'}</button>
      </div>
    </aside></div>}
    {(selected || selectedLoading) && <div className="ops-drawer-backdrop" onMouseDown={e => { if (e.currentTarget === e.target && !selectedLoading) closeIncidentDetails(); }}><aside className={`ops-detail-drawer${selectedLoading && !selected ? ' is-loading' : ''}`} aria-label="Incident details">
      {selectedLoading && !selected && <div className="ops-detail-loading" role="status" aria-live="polite"><span className="ops-spinner" /><strong>Loading incident details…</strong><small>Please wait while the latest incident data is retrieved.</small></div>}
      {selected && <>
      <div className="ops-detail-content">
      <div className="ops-drawer-head"><div><small>INCIDENT COMMAND DETAIL</small><div className="ops-drawer-title-row"><h2 className="ops-incident-display-id">{selected.incident.displayId || selected.incident.incidentId}</h2><StatusBadge value={operationsStatus(selected.incident)} /></div><p>{humanizeAlert(selected.incident.alertName)}</p><div className="ops-drawer-meta"><span>{selected.incident.resource}</span><span>{selected.incident.environment || 'Unknown environment'}</span><span>{selected.incident.priority || 'No priority'}</span></div></div><button type="button" className="ops-icon-button" onClick={closeIncidentDetails} aria-label="Close details">×</button></div>
      <div className="ops-incident-summary" aria-label="Incident summary">
        <SummaryCard tone={selected.incident.resolvedAt ? 'success' : 'danger'} label="Alert status" value={displayStatus(selected.incident.status)} detail={selected.incident.resolvedAt ? 'Monitoring recovery received' : 'Monitoring alert is active'} />
        <SummaryCard tone={isOperationsClosed(selected.incident) ? 'success' : 'active'} label="Operations status" value={displayStatus(operationsStatus(selected.incident))} detail={isOperationsClosed(selected.incident) ? 'Incident completed' : 'Follow-up in progress'} />
        <SummaryCard tone="active" label="Workflow status" value={displayStatus(selected.incident.workflowStatus)} detail={`Approval: ${displayStatus(approvalStatus(selected.incident))}`} />
        <SummaryCard tone={selected.incident.adoState && ['CLOSED', 'DONE', 'RESOLVED'].includes(selected.incident.adoState.toUpperCase()) ? 'success' : selected.incident.workItemId ? 'active' : 'neutral'} label="ADO state" value={selected.incident.adoState || 'Not created'} detail={selected.incident.workItemId ? `Work item #${selected.incident.workItemId}` : 'No ADO work item'} />
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
        {!capabilities.createRelated && !capabilities.linkExisting && !capabilities.synchronize && !capabilities.closeIncident && !capabilities.manualCloseIncident && !capabilities.manualAlertStatus && !capabilities.restartAppService && <p className="ops-muted">Operations Hub write actions are disabled by the administrator.</p>}
        {capabilities.manualAlertStatus && <div className="ops-action-group"><h4>Alert status</h4><p className="ops-muted">Use this when a monitoring event was not received or legacy data does not reflect the actual status. Operations status, ADO state, and related work will remain unchanged.</p><button className="ops-button ops-button-secondary" disabled={busy} onClick={manualAlertStatusSelectedIncident}>{selected.incident.status === 'RESOLVED' ? 'Set to Active' : 'Set to Recovered'}</button></div>}
        <div className="ops-action-group"><h4>Tier1 actions</h4><p className="ops-muted">Run the approved action and automatically record the result in the primary VSTS Discussion.</p><button className="ops-button ops-button-danger" disabled={busy || !connection?.connected || !capabilities.restartAppService || !selected.incident.resource} onClick={restartSelectedAppService}>{busy ? 'Working…' : 'Restart App Service'}</button></div>
        <div className="ops-action-group"><h4>Escalation workspace</h4><p className="ops-muted">No team is selected automatically. Select one team or both teams. Preview is optional; creation validates the current mapping again. Description is copied from the current Tier 1 Primary Ticket.</p>
          <div className="ops-target-selector">{(['APP_SUPPORT', 'TIER2'] as const).map(team => { const exists = selected.incident.workItems.some(item => item.role === 'RELATED' && item.supportTeam === team); return <label key={team}><input type="checkbox" checked={escalationTargets.includes(team)} disabled={exists} onChange={() => toggleEscalationTarget(team)} /> {team === 'APP_SUPPORT' ? 'App Support' : 'IT Tier 2 / Infra'} <small>{exists ? 'Already linked' : team === 'APP_SUPPORT' ? 'Service Form' : 'IT Support Case'}</small></label>; })}</div>
          <button className="ops-button ops-button-secondary" onClick={previewMappings} disabled={busy || escalationTargets.length === 0}>Preview selected tickets</button>
          {escalationTargets.map(team => { const preview = mappingPreviews[team]; return preview ? <article className="ops-ticket-preview" key={team}><dl className="ops-mapping-preview"><dt>Target</dt><dd>{team === 'APP_SUPPORT' ? 'App Support' : 'IT Tier 2 / Infra'}</dd><dt>Project / Type</dt><dd>{preview.mapping.adoProject} · {preview.mapping.workItemType}</dd><dt>Area Path</dt><dd>{preview.mapping.areaPath}</dd><dt>Assigned To</dt><dd>{preview.mapping.assignedTeam || 'Unassigned'}</dd><dt>Tags</dt><dd>{preview.tags || 'No tags'}</dd><dt>Source</dt><dd>Primary #{preview.primaryWorkItemId}</dd></dl><div className="ops-preview-field"><strong>Title</strong><span>{preview.title}</span></div><details><summary>Description copied from Tier 1</summary><pre>{preview.descriptionText || 'No description'}</pre></details></article> : null; })}
          <button className="ops-button" disabled={busy || !connection?.connected || !capabilities.createRelated || escalationTargets.length === 0} onClick={createSelectedTickets}>{escalationTargets.length === 0 ? 'Select a team to continue' : `Create ${escalationTargets.length} ticket${escalationTargets.length > 1 ? 's' : ''}: ${escalationTargets.map(team => team === 'APP_SUPPORT' ? 'App Support' : 'IT Tier 2').join(' + ')}`}</button>
        </div>
        <div className="ops-closure"><h4>Closure checklist</h4><p className="ops-muted">Readiness: {isOperationsClosed(selected.incident) ? 'Closed' : displayStatus(selected.incident.closeEligibility?.readinessStatus || 'CHECKING')}</p><ul><li className={selected.incident.workItemSummary.total > 0 ? 'is-done' : ''}>Primary Work Item exists</li><li className={selected.incident.workItemSummary.open === 0 && selected.incident.workItemSummary.total > 0 ? 'is-done' : ''}>All Work Items are closed</li><li className={selected.incident.status === 'RESOLVED' ? 'is-done' : ''}>Monitoring alert is recovered (recommended)</li></ul>{!isOperationsClosed(selected.incident) && selected.incident.closeEligibility?.reasons.map(reason => <small key={reason}>{reason}</small>)}{!isOperationsClosed(selected.incident) && selected.incident.closeEligibility?.warnings?.map(warning => <small className="ops-closure-warning" key={warning}>{warning}</small>)}<div className="ops-card-actions"><button className="ops-button ops-button-secondary" disabled={busy || !connection?.connected || !capabilities.synchronize} onClick={() => runAction(() => operationsApi.synchronize(selected.incident.incidentId), 'Work Item states synchronized')}>Synchronize</button><button className="ops-button" disabled={busy || !connection?.connected || !capabilities.closeIncident || !selected.incident.closeEligibility?.allowed || isOperationsClosed(selected.incident)} onClick={closeSelectedIncident}>{isOperationsClosed(selected.incident) ? 'Incident Closed' : busy ? 'Closing…' : 'Close Incident'}</button>{!isOperationsClosed(selected.incident) && (selected.incident.hasLifecycleConflict || hasInvalidResolutionTimeline(selected.incident)) && <button className="ops-button ops-button-danger" disabled={busy || !capabilities.manualCloseIncident} onClick={manualCloseSelectedIncident}>Manual Override / Force Close</button>}</div></div>
      </section>
      <details className="ops-timeline ops-workspace-timeline"><summary><span><small>ACTIVITY</small><strong>Incident timeline</strong></span><em>View timeline</em></summary><div className="ops-timeline-content"><div className="ops-timeline-head"><span>Incident activity history</span><button type="button" className="ops-button ops-button-secondary" onClick={event => { event.preventDefault(); setShowTechnicalEvents(value => !value); }}>{showTechnicalEvents ? 'Hide system activity' : 'Show system activity'}</button></div>{timelineForDisplay(selected.timeline, showTechnicalEvents).map(event => <div key={event.eventId}><span /><p><strong>{humanizeEventType(event.eventType)}</strong><small>{decodeHtmlEntities(event.detail || event.result)} · {formatTimelineDate(event)}</small>{(event.operationsUserEmail || event.adoIdentityEmail) && <small className="ops-audit-identities">Operations: {event.operationsUserEmail || 'Unknown'} · Azure DevOps: {event.adoIdentityEmail || 'Unknown'}</small>}</p></div>)}</div></details>
      </div>
      </div>
      </>}
      {selectedLoading && selected && <div className="ops-detail-refreshing" role="status" aria-live="polite"><span className="ops-spinner" /><strong>Loading latest incident data…</strong></div>}
    </aside></div>}
  </section>;
}
function SummaryCard({ tone, label, value, detail }: { tone: 'success' | 'danger' | 'warning' | 'active' | 'neutral'; label: string; value: string; detail: string }) {
  return <article className={`ops-summary-card ops-summary-card-${tone}`}><small>{label}</small><strong>{value}</strong><span>{detail}</span></article>;
}

function formatDate(value?: string) {
  return formatBangkokTimestamp(value, 'en-GB');
}

function formatIncidentDate(value?: string) {
  return formatBangkokTimestamp(value, 'en-GB');
}

function formatTimelineDate(event: { eventType?: string; timestamp?: string }) {
  const monitoringEvent = event.eventType === 'ALERT_FIRING' || event.eventType === 'ALERT_RESOLVED';
  return monitoringEvent ? formatBangkokTimestamp(event.timestamp, 'en-GB') : formatDate(event.timestamp);
}

function relatedWorkItemCount(item: Incident) {
  const related = item.workItems.filter(workItem => workItem.role === 'RELATED');
  return related.length;
}

function relatedWorkItemSummary(item: Incident) {
  const related = item.workItems.filter(workItem => workItem.role === 'RELATED');
  if (!related.length) return 'None';
  return related.map(workItem => `${workItem.assignedTo || 'Unassigned'} · ${displayStatus(workItem.state)}`).join(', ');
}

function decodeHtmlEntities(value: string) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&colon;/gi, ':');
}

// SharePoint/API timestamps are UTC instants. Treat timezone-less ISO values as UTC
// instead of allowing the browser's local timezone to reinterpret them.
function formatClock(value: Date) {
  return value.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatRelativeDate(value?: string) {
  const timestamp = parseUtcTimestamp(value);
  if (!timestamp) return 'Unknown';
  const minutes = Math.round((Date.now() - timestamp.getTime()) / 60000);
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

function normalizeAssignee(value?: string) {
  return String(value || '').replace(/\s*<[^>]+>\s*$/, '').trim();
}

function lifecycleIssueMessage(issues: string[]) {
  if (issues.includes('ALERT_FIRING_WORK_ITEM_CLOSED')) return 'Monitoring still reports FIRING although the tracked Azure DevOps work item is closed.';
  if (issues.includes('RESOLVED_TIMESTAMP_MISSING')) return 'The alert is resolved but Resolved At is missing.';
  if (issues.includes('RESOLVED_WORKFLOW_STILL_ACTIVE')) return 'The alert is resolved while the workflow is still active.';
  return 'Monitoring, workflow, and work-item states are not aligned.';
}

function hasInvalidResolutionTimeline(incident: Incident) {
  return incident.closeEligibility?.reasons?.includes('Resolved event predates this incident episode; verify First Seen and recovery correlation') || false;
}

function isActionRequired(item: Incident) {
  // An assigned open child ticket is follow-up work, even when the incident
  // already has an Approved workflow outcome. Needs action is reserved for
  // work that has not started or has an integrity/creation problem.
  if (isOperationsClosed(item) || isWaitingForSupport(item) || isReadyToClose(item) || isWaitingForAlertRecovery(item)) return false;
  const status = operationsStatus(item);
  return ['NEEDS_REVIEW', 'PENDING', 'FAILED', 'NOT_CREATED', 'NEW'].includes(status);
}

function isFollowUpItem(item: Incident) {
  return !isOperationsClosed(item)
    && !isActionRequired(item)
    && !isWaitingForAlertRecovery(item)
    && !isReadyToClose(item);
}

function timelineForDisplay(events: AuditEvent[], showTechnical: boolean) {
  if (showTechnical) return events;
  const syncEvents = events.filter(event => event.eventType === 'SYNCHRONIZE_WORK_ITEMS');
  const visible = events.filter(event => !['SYNCHRONIZE_WORK_ITEMS', 'LAST_SYNCED'].includes(event.eventType));
  if (syncEvents.length > 0) {
    const latest = syncEvents.reduce((left, right) => (parseUtcTimestamp(left.timestamp)?.getTime() || 0) >= (parseUtcTimestamp(right.timestamp)?.getTime() || 0) ? left : right);
    visible.push({ ...latest, eventId: `WORK_ITEMS_SYNCED_SUMMARY:${latest.eventId}`, eventType: 'WORK_ITEMS_SYNCED', detail: `${latest.detail || latest.result} · ${syncEvents.length} synchronization${syncEvents.length === 1 ? '' : 's'} recorded` });
  }
  return visible.sort((left, right) => (parseUtcTimestamp(right.timestamp)?.getTime() || 0) - (parseUtcTimestamp(left.timestamp)?.getTime() || 0));
}

function approvalStatus(item: Incident) {
  const outcome = String(item.approvalOutcome || '').trim().toUpperCase();
  const workflow = String(item.workflowStatus || '').trim().toUpperCase();
  if (outcome.startsWith('HISTORICAL:')) return 'HISTORICAL_RESPONSE';
  if (['APPROVE', 'APPROVED'].includes(outcome) || workflow.includes('APPROVED')) return 'APPROVED';
  if (['REJECT', 'REJECTED'].includes(outcome) || workflow.includes('REJECTED')) return 'REJECTED';
  if (item.approvalCompletedAt) return outcome || 'COMPLETED';
  if (workflow === 'CANCELLED' || workflow === 'CANCELED') return 'CANCELLED';
  if (item.status === 'RESOLVED' && (item.approvalRequestedAt || item.approvalId)) return 'NO_LONGER_REQUIRED';
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
