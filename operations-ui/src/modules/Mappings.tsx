import { useEffect, useState } from 'react';
import { operationsApi } from '../api';
import { EmptyState, ErrorState, LoadingState, PageHeading } from '../components';
import type { ServiceMapping } from '../types';

export function Mappings() {
  const [items, setItems] = useState<ServiceMapping[] | null>(null);
  const [error, setError] = useState('');
  const load = () => operationsApi.mappings().then(result => setItems(result.items)).catch(err => setError(err.message));
  useEffect(() => { void load(); }, []);
  return <section>
    <PageHeading eyebrow="Administrator" title="Service Mapping" actions={<button className="ops-button" onClick={load}>Refresh</button>} />
    {error && <ErrorState message={error} onRetry={load} />}
    {!items && !error && <LoadingState />}
    {items?.length === 0 && <EmptyState title="No enabled mappings" detail="Provision mappings in the Operations Hub Service Mapping SharePoint List." />}
    {items && items.length > 0 && <div className="ops-panel ops-table-wrap"><table><thead><tr><th>Service</th><th>Team</th><th>Project / Type</th><th>Area Path</th><th>Assigned Team</th><th>Priority</th></tr></thead><tbody>{items.map(item => <tr key={item.mappingId}><td><strong>{item.service || '*'}</strong><small>{item.environment || 'All environments'}</small></td><td>{item.supportTeam}</td><td><strong>{item.adoProject}</strong><small>{item.workItemType}</small></td><td>{item.areaPath}</td><td>{item.assignedTeam}</td><td>{item.priority}</td></tr>)}</tbody></table></div>}
  </section>;
}
