const service = require('./ado-deployment-event-service');

// Read-only, per-request delegated access. Never persist a user's token or
// copy live records into the shared webhook archive.
async function loadProjectHistory(mapping, accessToken, ado) {
  const config = ado.getConfig();
  if (String(config.project).toLowerCase() !== mapping.projectName.toLowerCase()) throw new Error('Project scope mismatch');
  const options = { accessToken };
  const root = `/${encodeURIComponent(config.org)}/${encodeURIComponent(config.project)}`;
  const [buildResponse, releaseResponse] = await Promise.all([
    ado.listBuilds({ definitions: mapping.ci.id, branchName: mapping.targetBranch, top: 20, accessToken }),
    ado.releaseRequest('GET', `${root}/_apis/release/releases?definitionId=${encodeURIComponent(mapping.cd.id)}&$top=20&$expand=environments,artifacts&queryOrder=descending&api-version=7.1`, null, options)
  ]);
  if (!buildResponse.ok || !releaseResponse.ok) {
    const error = new Error('Azure DevOps history unavailable');
    error.status = !buildResponse.ok ? buildResponse.status : releaseResponse.status;
    throw error;
  }
  const builds = Array.isArray(buildResponse.body?.value) ? buildResponse.body.value : [];
  const releases = Array.isArray(releaseResponse.body?.value) ? releaseResponse.body.value : [];
  let prs = [];
  const repositoryId = builds[0]?.repository?.id;
  if (repositoryId) {
    const response = await ado.getPullRequestsForTargetBranch(repositoryId, mapping.targetBranch, 100, options);
    if (response.ok && Array.isArray(response.body?.value)) prs = response.body.value;
  }
  const items = builds.map(build => {
    const item = service.normalizeBuildEvent({ eventType: 'build.complete', id: `live-build-${build.id}`, createdDate: build.finishTime || build.queueTime,
      resource: build });
    const matches = prs.filter(pr => pr.lastMergeCommit?.commitId && String(pr.lastMergeCommit.commitId).toLowerCase() === String(build.sourceVersion).toLowerCase());
    if (!item.pullRequestId && matches.length === 1) {
      const pr = matches[0];
      item.pullRequestId = String(pr.pullRequestId); item.pullRequestTitle = pr.title || '';
      item.pullRequestUrl = pr._links?.web?.href || `https://dev.azure.com/${encodeURIComponent(config.org)}/${encodeURIComponent(config.project)}/_git/${encodeURIComponent(repositoryId)}/pullrequest/${pr.pullRequestId}`;
      item.prLinkEvidence = 'merge-commit';
    }
    return item;
  });
  for (const release of releases) {
    for (const environment of release.environments || []) {
      if (environment.name !== mapping.cd.stageName) continue;
      const steps = environment.deploySteps?.length ? environment.deploySteps : [null];
      for (const step of steps) {
        items.push(service.normalizeDeploymentEvent({ id: `live-release-${release.id}-${environment.id}-${step?.attempt || step?.id || 'latest'}`,
          eventType: 'ms.azure-devops-release.deployment-completed-event', createdDate: step?.completedOn || environment.modifiedOn || release.modifiedOn || release.createdOn,
          resource: { deployment: { release, environment, project: release.project || { id: mapping.projectId, name: mapping.projectName },
            attempt: step?.attempt, id: step?.id, status: step?.status || environment.status,
            startedOn: step?.startedOn, completedOn: step?.completedOn } } }));
      }
    }
  }
  return { items, buildCount: builds.length, releaseCount: releases.length,
    limited: builds.length >= 20 || releases.length >= 20 };
}
module.exports = { loadProjectHistory };
