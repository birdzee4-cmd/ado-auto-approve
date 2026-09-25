import { useEffect, useState } from 'react';
import { operationsApi } from '../api';
import { EmptyState, ErrorState, LoadingState, PageHeading } from '../components';
import type { ServiceMapping } from '../types';

export function Mappings() {
  const [items, setItems] = useState<ServiceMapping[] | null>(null);
  const [error, setError] = useState('');
  const load = () => operationsApi.mappings().then(result => setItems(result.items)).catch(err => setError(err.message));
  useEffect(() => { void load(); }, []);
  const enabledCount = items?.filter(item => item.enabled).length || 0;
  const draftCount = (items?.length || 0) - enabledCount;
  return <section>
    <PageHeading eyebrow="Administrator" title="Service Mapping" actions={<button className="ops-button" onClick={load}>Refresh</button>} />
    {error && <ErrorState message={error} onRetry={load} />}
    {!items && !error && <LoadingState />}
    {items?.length === 0 && <EmptyState title="No service mappings" detail="Provision draft mappings in SharePoint, review them here, then enable only the approved routes." />}
    {items && items.length > 0 && <>
      <div className="mapping-summary" aria-label="Mapping readiness">
        <span><strong>{items.length}</strong> total</span>
        <span className="mapping-summary-enabled"><strong>{enabledCount}</strong> enabled</span>
        <span className="mapping-summary-draft"><strong>{draftCount}</strong> draft</span>
      </div>
      <div className="ops-panel ops-table-wrap"><table><thead><tr><th>Status</th><th>Service</th><th>Team</th><th>Project / Type</th><th>Area Path</th><th>Assigned Team</th><th>Priority</th></tr></thead><tbody>{items.map(item => <tr key={item.mappingId} className={item.enabled ? '' : 'mapping-row-draft'}><td><span className={`mapping-status ${item.enabled ? 'is-enabled' : 'is-draft'}`}>{item.enabled ? 'Enabled' : 'Draft'}</span></td><td><strong>{item.service || '*'}</strong><small>{item.environment || 'All environments'}</small>{item.alertNamePattern && <small>Alert: {item.alertNamePattern}</small>}{item.resourcePattern && <small>Resource: {item.resourcePattern}</small>}</td><td>{item.supportTeam}</td><td><strong>{item.adoProject || 'Not set'}</strong><small>{item.workItemType || 'Not set'}</small></td><td>{item.areaPath || 'Not set'}</td><td>{item.assignedTeam || 'Not set'}</td><td>{item.priority}</td></tr>)}</tbody></table></div>
    </>}
  </section>;
}
