import { useEffect, useState } from 'react';
import { operationsApi } from '../api';
import { AdoStateBadge, EmptyState, ErrorState, LoadingState, PageHeading, StatusBadge } from '../components';
import type { DashboardData } from '../types';

const emptyDashboard: DashboardData = { totalIncidents: 0, adoWorkItems: 0, openWorkItems: 0, closedWorkItems: 0, awaitingApproval: 0, cancelledItems: 0, failedItems: 0, recentIncidents: [], selectedDate: '', daily: { newIncidents: 0, resolvedIncidents: 0, adoCreated: 0, failedIncidents: 0, pendingApproval: 0, openBacklog: 0, incidents: [] }, dailySeries: [], needsAttention: [] };

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [selectedDate, setSelectedDate] = useState('');

  const load = () => {
    setError('');
    operationsApi.dashboard(selectedDate).then(result => { setData(result); setSelectedDate(result.selectedDate); }).catch(err => {
      setData(emptyDashboard);
      setError(err.message);
    });
  };

  useEffect(load, [selectedDate]);

  return (
    <section>
      <PageHeading eyebrow="Daily operations brief" title="What needs attention today?" actions={<><label className="ops-date-control"><span>Operating date</span><input type="date" value={selectedDate} onChange={event => setSelectedDate(event.target.value)} /></label><button className="ops-button" onClick={load}>Refresh</button></>} />
      {!data && !error && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}
      {data && <>
        <div className="ops-day-banner"><div><span>OPERATING DATE · ASIA/BANGKOK</span><strong>{formatDay(data.selectedDate)}</strong><small>{data.daily.newIncidents === 0 ? 'No new incidents recorded for this day' : `${data.daily.newIncidents} new incident${data.daily.newIncidents === 1 ? '' : 's'} require review`}</small></div><a href="#/incidents">Open incident explorer →</a></div>
        <div className="ops-kpi-grid ops-kpi-grid-daily">
          <Kpi label="New incidents" value={data.daily.newIncidents} tone="dark" detail="First seen on selected day" />
          <Kpi label="Resolved" value={data.daily.resolvedIncidents} tone="success" detail="Recovery recorded" />
          <Kpi label="Awaiting approval" value={data.daily.pendingApproval} tone="yellow" detail="Action required today" />
          <Kpi label="Flow failures" value={data.daily.failedIncidents} tone="danger" detail="Needs investigation" />
        </div>
        <div className="ops-dashboard-grid">
          <TrendChart series={data.dailySeries} />
          <article className="ops-panel ops-attention-panel"><div className="ops-panel-heading"><div><span>CURRENT BACKLOG</span><h2>Needs attention</h2></div><strong>{data.daily.openBacklog}</strong></div>{data.needsAttention.length === 0 ? <EmptyState title="Queue is clear" detail="No open, pending, or failed incidents." /> : <div className="ops-attention-list">{data.needsAttention.map(item => <a href="#/incidents" key={item.incidentId}><div><strong>{item.displayId}</strong><small>{item.service || item.resource || item.alertName}</small></div><StatusBadge value={item.trackingStatus} /></a>)}</div>}</article>
        </div>
        <article className="ops-panel ops-daily-table">
          <div className="ops-panel-heading"><div><span>DAILY INCIDENT LOG</span><h2>Incidents first seen on {formatDay(data.selectedDate)}</h2></div><small>{data.generatedAt ? `Updated ${formatTime(data.generatedAt)}` : 'Current status'}</small></div>
          {data.daily.incidents.length === 0 ? <EmptyState title="No incidents for this date" detail="Choose another operating date or open the incident explorer to search all records." /> : (
            <div className="ops-table-wrap"><table><thead><tr><th>Incident</th><th>Service</th><th>ADO state</th><th>Tracking</th><th>Last synced</th></tr></thead><tbody>
              {data.daily.incidents.map(item => <tr key={item.incidentId}><td><strong>{item.displayId || item.incidentId}</strong><small>{item.alertName}</small></td><td>{item.service || item.resource}</td><td><AdoStateBadge value={item.adoState} /></td><td><StatusBadge value={item.trackingStatus} /></td><td>{formatDate(item.lastSyncedAt || item.lastSeen)}</td></tr>)}
            </tbody></table></div>
          )}
        </article>
      </>}
    </section>
  );
}

function Kpi({ label, value, tone, detail }: { label: string; value: number; tone: string; detail: string }) {
  return <article className={`ops-kpi ops-kpi-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function TrendChart({ series }: { series: DashboardData['dailySeries'] }) {
  const max = Math.max(1, ...series.flatMap(point => [point.opened, point.resolved]));
  return <article className="ops-panel ops-trend-panel"><div className="ops-panel-heading"><div><span>14-DAY SIGNAL</span><h2>Opened vs resolved</h2></div><div className="ops-chart-legend"><span className="is-opened" />Opened <span className="is-resolved" />Resolved</div></div><div className="ops-bar-chart">{series.map(point => <div className="ops-bar-day" key={point.date} title={`${point.date}: ${point.opened} opened, ${point.resolved} resolved`}><div className="ops-bar-pair"><i className="is-opened" style={{ height: `${Math.max(3, point.opened / max * 100)}%` }} /><i className="is-resolved" style={{ height: `${Math.max(3, point.resolved / max * 100)}%` }} /></div><small>{point.date.slice(8)}</small></div>)}</div></article>;
}

function formatDay(value?: string) {
  if (!value) return '-';
  return new Date(`${value}T00:00:00+07:00`).toLocaleDateString('en-GB', { timeZone: 'Asia/Bangkok', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDate(value?: string) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })
    : '-';
}

function formatTime(value?: string) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleTimeString('en-US', { timeZone: 'Asia/Bangkok' })
    : '-';
}
