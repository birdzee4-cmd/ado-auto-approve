const endpoint = 'https://statoffice.buzzebees-dev.com/monitordeployment/getDeploymentStatus';
const terminal = new Set(['complete', 'build fail', 'deploy fail', 'cancel deploy']);
const text = value => String(value ?? '').trim();
const normalized = value => text(value).toLowerCase();
const branchRef = value => {
  const valueText = text(value);
  if (!valueText) return '';
  return valueText.replace(/^refs\/heads\//i, 'refs/heads/');
};
function normalize(payload) {
  if (!Array.isArray(payload) || payload.length > 20000) throw new Error('Invalid monitor response');
  return payload.map(row => {
    if (!row || ['BuildId', 'CiName', 'Status', 'Branch', 'LastUpdate'].some(key => typeof row[key] !== 'string')) throw new Error('Invalid monitor row');
    const status = row.Status.trim().toLowerCase();
    const branch = normalized(row.Branch);
    const environment = { development: 'Development', staging: 'Staging', production: 'Production' }[branch] || 'Other';
    const match = row.LastUpdate.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2})$/);
    const updatedAt = match ? `${match[3]}-${match[2]}-${match[1]}T${match[4]}+07:00` : '';
    const azureBuildId = /^\d+(?:_[MP])?$/.test(row.BuildId) ? row.BuildId.replace(/_[MP]$/, '') : '';
    const repositoryId = text(row.RepositoryId || row.RepoId || row.RepositoryID);
    const pipelineId = text(row.PipelineId || row.DefinitionId || row.BuildDefinitionId || row.DefinitionID);
    const commitId = normalized(row.Commit || row.CommitId || row.SourceVersion || row.Version);
    const branchName = branchRef(row.BranchName || row.SourceBranch || row.SourceBranchName);
    const projectName = text(row.Project || row.ProjectName || row.CiProject || row.CiName);
    return { id: row.BuildId, azureBuildId, project: projectName, projectName, pipelineName: text(row.CiName), pipelineId, definitionId: pipelineId,
      repository: text(row.Repository || row.RepositoryName), repositoryId, commitId, lineageUnavailable: !commitId || (!repositoryId && !text(row.Repository || row.RepositoryName)),
      projectType: text(row.ProjectType),
      environment, branch: branchName, requestedBy: text(row.RequestBy), status,
      terminal: terminal.has(status), updatedAt, updatedText: row.LastUpdate, startText: String(row.StartTime || ''),
      duration: String(row.TotalTime || '').split('.')[0] };
  }).sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
}
async function loadRaw(fetcher = fetch) {
  const response = await fetcher(endpoint, { signal: AbortSignal.timeout(15000), redirect: 'error', headers: { Accept: 'application/json' } });
  if (!response.ok || !/application\/json/i.test(response.headers.get('content-type') || '')) throw new Error('Monitor upstream unavailable');
  const payload = await response.json();
  normalize(payload);
  return payload;
}
async function load(fetcher = fetch) { return normalize(await loadRaw(fetcher)); }
module.exports = { normalize, load, loadRaw };
