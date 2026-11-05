const endpoint = 'https://statoffice.buzzebees-dev.com/monitordeployment/getDeploymentStatus';
const terminal = new Set(['complete', 'build fail', 'deploy fail', 'cancel deploy']);
function normalize(payload) {
  if (!Array.isArray(payload) || payload.length > 20000) throw new Error('Invalid monitor response');
  return payload.map(row => {
    if (!row || ['BuildId', 'CiName', 'Status', 'Branch', 'LastUpdate'].some(key => typeof row[key] !== 'string')) throw new Error('Invalid monitor row');
    const status = row.Status.trim().toLowerCase();
    const branch = row.Branch.trim().toLowerCase();
    const environment = { development: 'Development', staging: 'Staging', production: 'Production' }[branch] || 'Other';
    const match = row.LastUpdate.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2})$/);
    const updatedAt = match ? `${match[3]}-${match[2]}-${match[1]}T${match[4]}+07:00` : '';
    const azureBuildId = /^\d+(?:_[MP])?$/.test(row.BuildId) ? row.BuildId.replace(/_[MP]$/, '') : '';
    return { id: row.BuildId, azureBuildId, project: row.CiName, projectType: String(row.ProjectType || '').trim(),
      environment, branch: String(row.BranchName || ''), requestedBy: String(row.RequestBy || ''), status,
      terminal: terminal.has(status), updatedAt, updatedText: row.LastUpdate, startText: String(row.StartTime || ''),
      duration: String(row.TotalTime || '').split('.')[0] };
  }).sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
}
async function load(fetcher = fetch) {
  const response = await fetcher(endpoint, { signal: AbortSignal.timeout(15000), redirect: 'error', headers: { Accept: 'application/json' } });
  if (!response.ok || !/application\/json/i.test(response.headers.get('content-type') || '')) throw new Error('Monitor upstream unavailable');
  return normalize(await response.json());
}
module.exports = { normalize, load };
