import { useEffect, useRef, useState } from 'react';
import { operationsApi } from '../api';
import { EmptyState, ErrorState, formatBangkokTimestamp, LoadingState, PageHeading, StatusBadge } from '../components';
import type { IncidentReport } from '../types';

export function Reports() {
  const [period, setPeriod] = useState('week');
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  const [data, setData] = useState<IncidentReport | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [resource, setResource] = useState('');
  const [repeatsOnly, setRepeatsOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [day, setDay] = useState('');
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null); setError(''); setResource(''); setDay(''); setPage(1);
    operationsApi.report(period, date).then(result => { if (!cancelled) setData(result); }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [period, date, refresh]);
  const resourceKey = (item: IncidentReport['incidents'][number]) => JSON.stringify([item.subscription || '', item.resourceGroup || '', item.resource?.trim() || 'Unknown resource'].map(value => value.trim().toLowerCase()));
  const resourceIncidents = data?.incidents.filter(item => !resource || resourceKey(item) === resource) || [];
  const started = (item: IncidentReport['incidents'][number]) => item.firstSeen || item.receivedAt || item.createdAt;
  const dateKey = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) : '';
  const incidents = resourceIncidents.filter(item => !day || dateKey(started(item)) === day);
  const daily = (data?.daily || []).map(entry => ({ ...entry, count: resourceIncidents.filter(item => dateKey(started(item)) === entry.date).length }));
  const alerts = [...new Set(resourceIncidents.map(item => item.alertName || item.metric || 'Unknown alert'))];
  const tickets = (item: IncidentReport['incidents'][number]) => item.workItems?.length ? item.workItems : item.workItemId ? [{ workItemId: item.workItemId, url: item.workItemUrl, role: 'PRIMARY', state: item.adoState, assignedTo: item.assignedTo }] : [];
  const duration = (item: IncidentReport['incidents'][number]) => {
    const start = Date.parse(started(item) || ''), end = Date.parse(item.resolvedAt || '');
    return item.status === 'RESOLVED' && Number.isFinite(start) && Number.isFinite(end) && end >= start ? `${Math.round((end - start) / 60000)} min` : '—';
  };
  function selectResource(key: string) {
    setResource(key); setDay(''); setPage(1);
    requestAnimationFrame(() => { detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); detailRef.current?.focus({ preventScroll: true }); });
  }
  const rows = data?.resources.filter(item => !repeatsOnly || item.total > 1) || [];
  const max = Math.max(1, ...daily.map(day => day.count));
  function exportCsv() {
    if (!data) return;
    const cells = [['Incident', 'Resource', 'Resource group', 'Subscription', 'Alert', 'Status', 'First seen (Asia/Bangkok)', 'Recovered (Asia/Bangkok)', 'Recovery duration', 'Environment', 'App Service Plan', 'Metric', 'Value', 'Threshold', 'Severity', 'ADO work items', 'ADO URLs', 'ADO states', 'Assignees'], ...incidents.map(item => [item.displayId || item.incidentId, item.resource, item.resourceGroup || '', item.subscription || '', item.alertName, item.status, formatBangkokTimestamp(started(item)), item.status === 'RESOLVED' ? formatBangkokTimestamp(item.resolvedAt) : '', duration(item), item.environment || '', item.appServicePlan || '', item.metric || '', item.currentValue || '', item.thresholdDetail || '', item.severity || item.priority || '', tickets(item).map(t => '#' + t.workItemId + ' (' + t.role + ')').join('; '), tickets(item).map(t => t.url || '').join('; '), tickets(item).map(t => t.state || '').join('; '), tickets(item).map(t => t.assignedTo || '').join('; ')])];
    const csv = '\uFEFF' + cells.map(row => row.map(value => '"' + String(value).replace(/^[=+@-]/, "'$&").replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `Incident-report-${data.start}-${data.end}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return <section>
    <PageHeading eyebrow="Weekly & monthly insights" title="Incident Report" actions={<>
      <label className="ops-date-control"><span>Period</span><select value={period} onChange={event => setPeriod(event.target.value)}><option value="week">Weekly</option><option value="month">Monthly</option></select></label>
      <label className="ops-date-control"><span>Date within period</span><input type="date" required value={date} onChange={event => { if (event.target.value) setDate(event.target.value); }} /></label>
      <button className="ops-button" onClick={() => setRefresh(value => value + 1)}>Refresh</button>
      <button className="ops-button ops-button-secondary" disabled={!data} onClick={exportCsv}>Export CSV</button>
    </>} />
    {error ? <ErrorState message={error} onRetry={() => setRefresh(value => value + 1)} /> : !data ? <LoadingState label="Preparing incident report…" /> : <>
      <div className="ops-day-banner"><div><span>{period === 'week' ? 'WEEKLY REPORT · MON–SUN' : 'MONTHLY REPORT'} · ASIA/BANGKOK</span><strong>{data.start} — {data.end}</strong><small>Incidents first seen in this period · Updated {formatBangkokTimestamp(data.generatedAt)}</small></div></div>
      <p className="ops-muted">Counts represent incident records, not repeated alert notifications. Recovery and active counts reflect the latest monitoring status. Resources are grouped by subscription, resource group and name.</p>
      {data.unknownDates > 0 && <p role="status">{data.unknownDates} records have no valid start date and are excluded from period totals.</p>}
      <div className="ops-kpi-grid ops-kpi-grid-daily">{[
        ['Total incidents', data.total, 'Started during this period'], ['Affected resources', data.resources.length, 'Distinct resources'],
        ['Recurring resources', data.resources.filter(item => item.total > 1).length, 'More than one incident'], ['Active incidents', data.active, `${data.recovered} recovered`]
      ].map(([label, value, detail]) => <article className="ops-kpi" key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>)}</div>
      <article className="ops-panel ops-report-panel"><div className="ops-panel-heading"><div><p>INCIDENT FREQUENCY</p><h2>Daily trend</h2></div></div>
        <div className="ops-report-chart" role="group" aria-label={daily.map(day => `${day.date}: ${day.count} incidents`).join('; ')}>{daily.map(day => <div key={day.date} title={`${day.date}: ${day.count} incidents`}><strong>{day.count}</strong><button type="button" className="ops-report-bar" aria-label={`${day.date}: ${day.count} incidents. Show incidents for this date`} onClick={() => { setDay(day.date); setPage(1); detailRef.current?.scrollIntoView({ behavior: 'smooth' }); }}><i style={{ height: `${day.count / max * 140}px` }} /></button><small>{day.date.slice(8)}</small></div>)}</div>
      </article>
      <article className="ops-panel ops-report-panel"><div className="ops-panel-heading"><div><p>RESOURCE RELIABILITY</p><h2>Incidents by App Service / resource</h2></div><label><input type="checkbox" checked={repeatsOnly} onChange={event => setRepeatsOnly(event.target.checked)} /> Recurring only (&gt;1)</label></div>
        {rows.length ? <div className="ops-report-table"><table><thead><tr><th>App Service / resource</th><th>Incidents</th><th>Active</th><th>Recovered</th><th>Days affected</th><th>Latest incident · Bangkok</th><th>Share</th></tr></thead><tbody>{rows.map(row => <tr key={row.key}><td><button className="ops-report-link" onClick={() => selectResource(row.key)}>{row.resource}</button><small>{row.resourceGroup || 'Unknown resource group'} · {row.subscription || 'Unknown subscription'}</small></td><td><strong>{row.total}</strong>{row.total > 1 && <small>Recurring</small>}</td><td>{row.active}</td><td>{row.recovered}</td><td>{new Set(data.incidents.filter(item => resourceKey(item) === row.key).map(item => dateKey(started(item)))).size}</td><td>{formatBangkokTimestamp(started(data.incidents.find(item => resourceKey(item) === row.key)!))}</td><td>{Math.round(row.total / data.total * 100)}%</td></tr>)}</tbody></table></div> : <EmptyState title={repeatsOnly ? 'No recurring resources' : 'No incidents in this period'} detail="Select another week or month to explore incident history." />}
      </article>
      <article ref={detailRef} tabIndex={-1} className="ops-panel ops-report-panel ops-investigation"><div className="ops-panel-heading"><div><p>RESOURCE INVESTIGATION / PERIOD INCIDENT LOG</p><h2>{resource ? data.resources.find(row => row.key === resource)?.resource : 'All incidents'} · {incidents.length}</h2></div>{resource && <button className="ops-button ops-button-secondary" onClick={() => selectResource('')}>Show all resources</button>}</div>
        <div className="ops-investigation-summary">
          <p>Incidents started in this period. Recovery duration describes monitoring recovery, not confirmed downtime. Work item states reflect the latest stored sync.</p>
          {resource && <><p><strong>{new Set(resourceIncidents.map(item => dateKey(started(item)))).size} days affected</strong> · {resourceIncidents.length} incidents</p><p>Environment: {[...new Set(resourceIncidents.map(item => item.environment || 'Unknown'))].join(', ')} · App Service Plan: {[...new Set(resourceIncidents.map(item => item.appServicePlan || 'Unknown'))].join(', ')}</p><p>Alerts: {alerts.map(name => name + ' (' + resourceIncidents.filter(item => (item.alertName || item.metric || 'Unknown alert') === name).length + ')').join(' · ')}</p></>}
          <label>Incident date · Bangkok <select value={day} onChange={event => { setDay(event.target.value); setPage(1); }}><option value="">All dates in period</option>{daily.filter(entry => entry.count > 0).map(entry => <option key={entry.date} value={entry.date}>{entry.date} ({entry.count})</option>)}</select></label>
          <button className="ops-button ops-button-secondary" disabled={!incidents.length} onClick={exportCsv}>Export matching incidents ({incidents.length})</button>
        </div>
        {incidents.length ? <><div className="ops-report-table"><table><thead><tr><th>Incident</th><th>Resource / alert</th><th>First seen · Bangkok</th><th>Recovered · Bangkok / duration</th><th>Monitoring / Severity</th><th>ADO work items / owner</th></tr></thead><tbody>{incidents.slice((page - 1) * 20, page * 20).map(item => <tr key={item.incidentId}><td><a href={`#/incidents?id=${encodeURIComponent(item.incidentId)}`}>{item.displayId || item.incidentId}</a></td><td>{item.resource || 'Unknown resource'}<small>{item.alertName}</small></td><td>{formatBangkokTimestamp(item.firstSeen || item.receivedAt || item.createdAt)}</td><td>{item.status === 'RESOLVED' ? formatBangkokTimestamp(item.resolvedAt) : item.status === 'FIRING' ? 'Still active' : 'Unknown recovery status'}<small>{duration(item)}</small></td><td><StatusBadge value={item.status} /><small>{item.severity || item.priority || 'Unknown severity'}</small></td><td>{tickets(item).length ? tickets(item).map(ticket => <div key={ticket.workItemId}>{ticket.url ? <a href={ticket.url} target="_blank" rel="noreferrer">#{ticket.workItemId}</a> : <strong>#{ticket.workItemId}</strong>}<small>{ticket.role} · {ticket.state || 'Unknown state'} · {ticket.assignedTo || 'Unassigned'}</small></div>) : 'No work item recorded'}</td></tr>)}</tbody></table></div><div className="ops-report-pagination"><button className="ops-button ops-button-secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {Math.ceil(incidents.length / 20)}</span><button className="ops-button ops-button-secondary" disabled={page * 20 >= incidents.length} onClick={() => setPage(page + 1)}>Next</button></div></> : <EmptyState title="No incidents" detail="No incident records started within this period." />}
      </article>
    </>}
  </section>;
}
