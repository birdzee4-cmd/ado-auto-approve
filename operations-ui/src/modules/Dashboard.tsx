import { useEffect, useState } from 'react';
import { operationsApi } from '../api';
import { EmptyState, ErrorState, LoadingState, PageHeading, StatusBadge } from '../components';
import type { DashboardData } from '../types';

const emptyDashboard: DashboardData = { totalIncidents: 0, adoWorkItems: 0, openWorkItems: 0, closedWorkItems: 0, awaitingApproval: 0, cancelledItems: 0, failedItems: 0, recentIncidents: [] };

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    operationsApi.dashboard().then(setData).catch(err => {
      setData(emptyDashboard);
      setError(err.message);
    });
  };

  useEffect(load, []);

  return (
    <section>
      <PageHeading eyebrow="Power Automate tracking" title="Operations overview" actions={<button className="ops-button" onClick={load}>Refresh</button>} />
      {!data && !error && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}
      {data && <>
        <div className="ops-kpi-grid">
          <Kpi label="All incidents" value={data.totalIncidents} tone="dark" />
          <Kpi label="ADO work items" value={data.adoWorkItems} tone="yellow" />
          <Kpi label="Open work items" value={data.openWorkItems} tone="danger" />
          <Kpi label="Closed work items" value={data.closedWorkItems} tone="success" />
          <Kpi label="Awaiting approval" value={data.awaitingApproval} tone="dark" />
          <Kpi label="Cancelled" value={data.cancelledItems} tone="yellow" />
          <Kpi label="Flow failures" value={data.failedItems} tone="danger" />
        </div>
        <article className="ops-panel">
          <div className="ops-panel-heading"><div><span>INCIDENT FEED</span><h2>Recent incidents</h2></div><small>{data.generatedAt ? `Updated ${new Date(data.generatedAt).toLocaleTimeString()}` : 'Current status'}</small></div>
          {data.recentIncidents.length === 0 ? <EmptyState title="No incidents recorded" detail="Incidents written to the Operations Hub SharePoint List by Power Automate will appear here." /> : (
            <div className="ops-table-wrap"><table><thead><tr><th>Incident</th><th>Service</th><th>ADO state</th><th>Tracking</th><th>Last synced</th></tr></thead><tbody>
              {data.recentIncidents.map(item => <tr key={item.incidentId}><td><strong>{item.incidentId}</strong><small>{item.alertName}</small></td><td>{item.service || item.resource}</td><td>{item.adoState || 'Not created'}</td><td><StatusBadge value={item.trackingStatus} /></td><td>{formatDate(item.lastSyncedAt || item.lastSeen)}</td></tr>)}
            </tbody></table></div>
          )}
        </article>
      </>}
    </section>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <article className={`ops-kpi ops-kpi-${tone}`}><span>{label}</span><strong>{value}</strong><small>SharePoint tracking</small></article>;
}

function formatDate(value?: string) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : '-';
}
