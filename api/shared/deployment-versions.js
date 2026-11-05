const stamp = item => Date.parse(item?.completedAt || item?.eventCreatedAt || item?.receivedAt || '') || 0;
const newest = items => [...items].sort((a,b) => stamp(b) - stamp(a));
const identity = item => JSON.stringify([item.projectId || item.projectName || '', item.pipelineId || item.pipelineName || '', item.runId || item.eventId || '']);

function deploymentVersions(tracking, options = {}) {
  const events = tracking.groups.flatMap(group => group.events);
  const aliases = new Map();
  for (const item of events) {
    if (!item.repositoryId || !item.repositoryName) continue;
    const key = JSON.stringify([item.projectId || item.projectName, item.repositoryName.toLowerCase()]);
    if (!aliases.has(key)) aliases.set(key, new Set());
    aliases.get(key).add(item.repositoryId);
  }
  const repoKey = item => {
    const ids = aliases.get(JSON.stringify([item.projectId || item.projectName, String(item.repositoryName || '').toLowerCase()]));
    return item.repositoryId || (ids?.size === 1 ? [...ids][0] : String(item.repositoryName || '').toLowerCase());
  };
  const lane = item => JSON.stringify([item.projectId || item.projectName, item.pipelineId || item.pipelineName, item.environmentGroup, item.environment, item.stageName]);
  const deployments = events.filter(item => item.sourceType === 'classic-release');
  const latestSuccess = new Map();
  for (const item of newest(deployments)) {
    if (String(item.result).toLowerCase() === 'succeeded' && !latestSuccess.has(lane(item))) latestSuccess.set(lane(item), item);
  }
  const versions = new Map();
  for (const item of events) {
    const commit = String(item.sourceVersion || '').toLowerCase();
    const repository = repoKey(item);
    if (!/^[a-f0-9]{40}$/.test(commit) || !repository || !(item.projectId || item.projectName)) continue;
    const key = JSON.stringify([item.projectId || item.projectName, repository, commit]);
    if (!versions.has(key)) versions.set(key, { key, commit, repositoryId: item.repositoryId || '', repositoryName: item.repositoryName || repository,
      projectName: item.projectName || item.projectId, items: [] });
    versions.get(key).items.push(item);
  }
  const rows = [...versions.values()].map(version => {
    const items = newest(version.items);
    const buildMap = new Map(); const attemptMap = new Map();
    for (const item of items) {
      if (item.sourceType === 'build' && !buildMap.has(identity(item))) buildMap.set(identity(item), item);
      if (item.sourceType === 'classic-release') {
        const key = JSON.stringify([identity(item), item.stageName || item.stageId, item.attemptId || '']);
        if (!attemptMap.has(key)) attemptMap.set(key, item);
      }
    }
    const builds = newest([...buildMap.values()]); const attempts = newest([...attemptMap.values()]);
    const buildLanes = new Map();
    for (const build of builds) {
      const key = JSON.stringify([build.pipelineId || build.pipelineName, build.environmentGroup || 'Other', build.buildSourceBranch || build.targetBranch || build.sourceBranch || '']);
      if (!buildLanes.has(key)) buildLanes.set(key, { pipelineId: build.pipelineId, pipelineName: build.pipelineName, environment: build.environmentGroup || 'Other', latest: build, builds: [] });
      buildLanes.get(key).builds.push(build);
    }
    const environments = {};
    for (const env of ['Staging', 'Production']) {
      const matches = attempts.filter(item => item.environmentGroup === env);
      environments[env] = { status: matches[0]?.result || (options.checkedEnvironments?.includes(env) ? 'not-found' : 'not-checked'),
        latest: matches[0] || null, attempts: matches.length,
        latestSuccessful: matches.some(item => latestSuccess.get(lane(item)) === item),
        sameBuildAsLatestCI: !!(matches[0] && builds[0] && artifactIds(matches[0]).includes(String(builds[0].runId))) };
    }
    const prs = [...new Set(items.map(item => item.pullRequestId).filter(Boolean))];
    const stg = environments.Staging; const prd = environments.Production;
    const bothSucceeded = stg.status === 'succeeded' && prd.status === 'succeeded';
    const stgArtifacts = stg.latest ? artifactIds(stg.latest) : [];
    const prdArtifacts = prd.latest ? artifactIds(prd.latest) : [];
    const comparison = !bothSucceeded ? 'not-verified' : stgArtifacts.length === 1 && prdArtifacts.length === 1 ?
      stgArtifacts[0] === prdArtifacts[0] ? 'same-build' : 'same-source-different-build' : 'same-source-artifact-unknown';
    return { ...version, items, builds, deployments: attempts, latest: items[0], latestBuild: builds[0] || null,
      message: items.find(item => item.commitMessage)?.commitMessage || '', prs, environments, comparison,
      buildCount: builds.length, buildLanes: [...buildLanes.values()], deploymentCount: attempts.length,
      pipelineStages: items.filter(item => item.sourceType === 'yaml-pipeline'),
      lastActivity: new Date(stamp(items[0])).toISOString() };
  }).sort((a,b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity) || a.key.localeCompare(b.key));
  const prefix = String(options.commit || '').toLowerCase();
  const matches = prefix ? rows.filter(row => row.commit.startsWith(prefix)) : rows;
  return { rows: matches, matchedCount: matches.length, ambiguous: !!prefix && matches.length > 1,
    buildCount: matches.reduce((n,row) => n + row.buildCount, 0), deploymentCount: matches.reduce((n,row) => n + row.deploymentCount, 0),
    scope: options.source || 'stored-events', runtimeVerified: false };
}
function artifactIds(item) { try { const ids = JSON.parse(item.artifactBuildIds || '[]'); return Array.isArray(ids) ? ids.map(String) : []; } catch { return []; } }
module.exports = { deploymentVersions };
