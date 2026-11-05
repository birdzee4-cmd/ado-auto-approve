const PROJECT_MAP = require('./pr-build-project-map.json');
// Recovery means the same pipeline/stage succeeded later, not proof of a bug fix.
function time(item) {
  return Date.parse(item.completedAt || item.eventCreatedAt || item.receivedAt || '') || 0;
}
function buildTracking(items, options = {}) {
  const buildsById = new Map();
  for (const item of items) {
    if (item.sourceType !== 'build' || !item.runId) continue;
    const key = JSON.stringify([item.projectId || item.projectName, String(item.runId)]);
    if (!buildsById.has(key)) buildsById.set(key, []);
    buildsById.get(key).push(item);
  }
  // Classic CD can reuse an older CI artifact. Only its explicit artifact ID
  // may supply a missing PR; never attach the most recent PR by date or name.
  items = items.map(item => {
    if (item.sourceType !== 'classic-release' || !item.artifactBuildIds) return item;
    let ids;
    try { ids = JSON.parse(item.artifactBuildIds); } catch { return item; }
    if (!Array.isArray(ids) || ids.length !== 1) return item;
    const matches = buildsById.get(JSON.stringify([item.projectId || item.projectName, String(ids[0])])) || [];
    if (!matches.length || new Set(matches.map(build => String(build.pullRequestId))).size !== 1) return item;
    return { ...item, pullRequestId: item.pullRequestId || matches[0].pullRequestId, pullRequestTitle: item.pullRequestTitle || matches[0].pullRequestTitle,
      pullRequestUrl: item.pullRequestUrl || matches[0].pullRequestUrl, prLinkEvidence: 'release-build-artifact',
      sourceVersion: item.sourceVersion || matches[0].sourceVersion || '',
      repositoryId: item.repositoryId || matches[0].repositoryId || '', repositoryName: item.repositoryName || matches[0].repositoryName || '' };
  });
  const lanes = new Map();
  for (const item of items) {
    const source = item.sourceType || 'unknown';
    const identity = [item.projectId || item.projectName, item.repositoryName || '', source,
      item.pipelineId || item.pipelineName, item.environmentGroup || 'Other',
      item.targetBranch || (source === 'build' ? item.sourceBranch : ''), item.environment || '',
      item.stageName || item.stageId || ''];
    // Incomplete identities must never close another event's failure.
    if (!identity[0] || !identity[3]) identity.push(item.eventId);
    const key = JSON.stringify(identity);
    if (!lanes.has(key)) lanes.set(key, new Map());
    const runs = lanes.get(key);
    const attempt = item.runId ? JSON.stringify([item.runId, item.stageId || item.stageName || '', item.attemptId || '']) : item.eventId;
    const previous = runs.get(attempt);
    if (!previous || time(item) > time(previous) || (time(item) === time(previous) && String(item.eventId).localeCompare(String(previous.eventId)) > 0)) runs.set(attempt, item);
  }
  const groups = [];
  for (const [key, runs] of lanes) {
    const events = [...runs.values()].sort((a, b) => time(a) - time(b) || String(a.eventId).localeCompare(String(b.eventId)));
    const latest = events.at(-1);
    const failures = [];
    let nextSuccess = null;
    for (let i = events.length - 1; i >= 0; i--) {
      const item = events[i];
      const result = String(item.result).toLowerCase();
      if (result === 'succeeded') nextSuccess = item;
      if (result === 'failed') {
        const recovery = nextSuccess && time(nextSuccess) > time(item) ? nextSuccess : null;
        failures.push({ failed: item, recovery, status: recovery ? 'recovered' : 'open' });
      }
    }
    failures.reverse();
    groups.push({ key, pipelineName: latest.pipelineName || 'Unknown pipeline', projectName: latest.projectName || latest.projectId || 'Unknown project',
      repositoryName: latest.repositoryName || '', environment: latest.environmentGroup || 'Other', stageName: latest.stageName || '',
      sourceType: latest.sourceType, latest, totalRuns: events.length, failedRuns: failures.length,
      openFailures: failures.filter(item => !item.recovery).length, failures, events });
  }
  groups.sort((a, b) => time(b.latest) - time(a.latest) || a.key.localeCompare(b.key));
  return { groups, projects: buildProjects(groups, options.mappings || PROJECT_MAP), totalRuns: groups.reduce((sum, group) => sum + group.totalRuns, 0),
    failedRuns: groups.reduce((sum, group) => sum + group.failedRuns, 0),
    openFailures: groups.reduce((sum, group) => sum + group.openFailures, 0),
    scope: 'Stored hook events only; recovery is evaluated within each pipeline, branch, environment and stage.' };
}

function artifactIds(item) {
  try { const ids = JSON.parse(item.artifactBuildIds || '[]'); return Array.isArray(ids) ? ids.map(String) : []; } catch { return []; }
}
function sameProject(item, mapping) {
  if (item.projectId) return String(item.projectId).toLowerCase() === mapping.projectId.toLowerCase();
  return String(item.projectName || '').toLowerCase() === mapping.projectName.toLowerCase();
}
function pipelineMatches(item, pipeline) {
  // Never use name fallback when a conflicting ID is present.
  return item.pipelineId ? String(item.pipelineId) === pipeline.id : String(item.pipelineName || '').toLowerCase() === pipeline.name.toLowerCase();
}
function buildProjects(groups, mappings) {
  return mappings.map(mapping => {
    const ciGroups = groups.filter(group => group.sourceType === 'build' && sameProject(group.latest, mapping) && pipelineMatches(group.latest, mapping.ci) &&
      group.repositoryName.toLowerCase() === mapping.repositoryName.toLowerCase() &&
      (group.latest.targetBranch || group.latest.buildSourceBranch || group.latest.sourceBranch) === mapping.targetBranch);
    const cdGroups = groups.filter(group => mapping.cd && group.sourceType === 'classic-release' && sameProject(group.latest, mapping) && pipelineMatches(group.latest, mapping.cd) &&
      group.stageName === mapping.cd.stageName);
    const ciEvents = ciGroups.flatMap(group => group.events).sort((a,b) => time(b) - time(a));
    const cdEvents = cdGroups.flatMap(group => group.events).sort((a,b) => time(b) - time(a));
    const ci = ciEvents[0] || null;
    const latestDeployment = cdEvents[0] || null;
    // A later rollback supersedes an older successful deployment of latest CI.
    const cd = ci && latestDeployment && artifactIds(latestDeployment).includes(String(ci.runId)) ? latestDeployment : null;
    const ciFailed = ciGroups.reduce((sum, group) => sum + group.failedRuns, 0);
    const cdFailed = cdGroups.reduce((sum, group) => sum + group.failedRuns, 0);
    const openFailures = [...ciGroups, ...cdGroups].reduce((sum, group) => sum + group.openFailures, 0);
    let status = 'unknown';
    if (ci) {
      const result = String(ci.result || '').toLowerCase();
      if (result === 'failed') status = 'ci-failed';
      else if (result === 'succeeded') status = !cd ? 'awaiting-cd-evidence' : String(cd.result).toLowerCase() === 'succeeded' ? 'succeeded' : String(cd.result).toLowerCase() === 'failed' ? 'cd-failed' : 'cd-pending';
      else status = 'ci-pending';
    }
    const timeline = [...ciEvents, ...cdEvents].sort((a,b) => time(b) - time(a));
    const failures = [...ciGroups, ...cdGroups].flatMap(group => group.failures).sort((a,b) => time(b.failed) - time(a.failed));
    return { key: mapping.key, name: mapping.name, environment: mapping.environment, repositoryName: mapping.repositoryName,
      ci, cd, latestDeployment, status, ciFailed, cdFailed, openFailures, failures, timeline,
      ciPipeline: mapping.ci.name, cdPipeline: mapping.cd?.name || 'ยังไม่ได้เชื่อม CD',
      lineage: cd ? 'release-build-artifact' : 'unknown',
      reusedBuild: !!(latestDeployment && ci && artifactIds(latestDeployment).length && !artifactIds(latestDeployment).includes(String(ci.runId))) };
  }).sort((a,b) => time(b.timeline[0] || {}) - time(a.timeline[0] || {}) || a.key.localeCompare(b.key));
}
module.exports = { buildTracking, buildProjects };
