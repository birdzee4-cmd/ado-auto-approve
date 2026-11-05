const SUPPORTED_EVENTS = new Set([
  'ms.azure-devops-release.deployment-started-event',
  'ms.azure-devops-release.deployment-completed-event',
  'ms.vss-pipelines.stage-state-changed-event'
]);

function text(value, maxLength = 500) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function date(value) {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : '';
}

function linkOf(resource, stage, run, release, environment) {
  const candidates = [stage, run, environment, release, resource];
  for (const candidate of candidates) {
    const links = candidate && candidate._links || {};
    const value = (links.web && links.web.href) || candidate && (candidate.webUrl || candidate.url);
    if (value) return text(value, 2000);
  }
  return '';
}

function inferEnvironmentGroup(...values) {
  const value = values.filter(Boolean).join(' ');
  if (/production|(^|[\W_])prd([\W_]|$)|(^|[\W_])prod([\W_]|$)/i.test(value)) return 'Production';
  if (/staging|stage|uat|preprod|(^|[\W_])stg([\W_]|$)/i.test(value)) return 'Staging';
  if (/development|develop|(^|[\W_])dev([\W_]|$)|test|qa/i.test(value)) return 'Development';
  return 'Other';
}

function normalizeDeploymentEvent(payload) {
  const body = payload || {};
  const eventType = text(body.eventType, 200);
  if (!SUPPORTED_EVENTS.has(eventType)) return null;

  const resource = body.resource || {};
  const deployment = resource.deployment || {};
  const environment = deployment.environment || resource.environment || resource.releaseEnvironment || {};
  const release = Object.assign({}, resource.release || {}, environment.release || {}, deployment.release || {});
  const stage = resource.stage || {};
  const run = resource.run || resource.pipelineRun || {};
  const pipeline = resource.pipeline || run.pipeline || resource.definition || release.releaseDefinition || {};
  const repository = resource.repository || run.repository || pipeline.repository || {};
  const pullRequest = resource.pullRequest || resource.pullRequestDetails || run.pullRequest || {};
  const requestedBy = resource.requestedBy || resource.requestedFor || run.requestedBy || run.requestedFor || {};
  const project = deployment.project || release.project || resource.project || resource.projectReference || {};
  const containerProject = body.resourceContainers && body.resourceContainers.project || {};
  const isClassic = eventType.includes('release.deployment');
  const rawStatus = text(
    deployment.status || resource.deploymentStatus || resource.status || environment.status || stage.state || run.state,
    100
  );
  const rawResult = text(
    deployment.result || resource.result || deployment.status || environment.status || stage.result || run.result,
    100
  );
  const eventId = text(body.id || body.notificationId, 300);
  const subscriptionId = text(body.subscriptionId, 200);
  const publisherId = text(body.publisherId, 200);
  const runId = text(isClassic ? (release.id || resource.releaseId) : (run.id || resource.runId), 200);
  const stageId = text(isClassic ? (environment.id || resource.environmentId) : (stage.id || stage.identifier), 200);
  const naturalKey = [eventType, runId, stageId, rawStatus, rawResult, date(body.createdDate)].join('|');
  const sourceBranch = text(pullRequest.sourceRefName || run.sourceBranch || resource.sourceBranch || deployment.sourceBranch, 500);
  const targetBranch = text(pullRequest.targetRefName || run.targetBranch || resource.targetBranch || deployment.targetBranch, 500);
  const pullRequestId = text(pullRequest.pullRequestId || resource.pullRequestId || ((sourceBranch.match(/refs\/pull\/(\d+)/i) || [])[1]), 100);
  const environmentName = text(environment.name || stage.name || stage.displayName || resource.environmentName || resource.stageName || targetBranch || sourceBranch, 200);
  const environmentGroup = inferEnvironmentGroup(environmentName, targetBranch, sourceBranch, pipeline.name, run.name, release.name);

  return {
    eventId: eventId || naturalKey,
    subscriptionId,
    publisherId,
    eventType,
    sourceType: isClassic ? 'classic-release' : 'yaml-pipeline',
    attemptId: text(deployment.attempt || deployment.id || resource.attempt || resource.attemptId, 100),
    artifactBuildIds: JSON.stringify((release.artifacts || resource.artifacts || []).filter(item => String(item.type || '').toLowerCase() === 'build').map(item => text(item.definitionReference && item.definitionReference.version && item.definitionReference.version.id, 100)).filter(Boolean)),
    projectId: text(project.id || resource.projectId || containerProject.id, 200),
    projectName: text(project.name || resource.projectName),
    environment: environmentName,
    environmentGroup,
    repositoryName: text(repository.name || repository.id, 300),
    sourceBranch,
    targetBranch,
    pullRequestId,
    pullRequestTitle: text(pullRequest.title || resource.pullRequestTitle, 500),
    pullRequestAuthor: text((pullRequest.createdBy || {}).displayName || (pullRequest.createdBy || {}).uniqueName, 300),
    requestedBy: text(requestedBy.displayName || requestedBy.uniqueName || requestedBy.id, 300),
    pullRequestUrl: linkOf(pullRequest),
    pipelineId: text(pipeline.id, 200),
    pipelineName: text(pipeline.name),
    runId,
    runName: text(isClassic ? (release.name || resource.releaseName) : (run.name || run.pipelineRunName)),
    stageId,
    stageName: text(isClassic ? (environment.name || resource.environmentName) : (stage.name || stage.displayName)),
    status: rawStatus,
    result: rawResult,
    startedAt: date(deployment.startedOn || resource.startedOn || resource.startTime || environment.deploySteps && environment.deploySteps[0] && environment.deploySteps[0].startedOn || run.createdDate || stage.startTime),
    completedAt: date(deployment.completedOn || resource.completedOn || resource.finishTime || environment.completedOn || run.finishedDate || stage.finishTime),
    eventCreatedAt: date(body.createdDate) || new Date().toISOString(),
    url: linkOf(resource, stage, run, release, environment),
    rawResourceVersion: text(body.resourceVersion, 100)
  };
}

function normalizeBuildEvent(payload) {
  const body = payload || {};
  if (text(body.eventType, 200) !== 'build.complete') return null;
  const resource = body.resource || {};
  const definition = resource.definition || {};
  const repository = resource.repository || {};
  const project = resource.project || definition.project || body.resourceContainers && body.resourceContainers.project || {};
  const requestedFor = Array.isArray(resource.requests) && resource.requests[0] && resource.requests[0].requestedFor || resource.requestedFor || {};
  const sourceBranch = text(resource.sourceBranch, 500);
  const triggerInfo = resource.triggerInfo || {};
  const pullRequestId = text(triggerInfo['pr.number'] || triggerInfo['MSTFS.PullRequestId'] || ((sourceBranch.match(/refs\/pull\/(\d+)/i) || [])[1]), 100);
  const environmentName = text(resource.environmentName || sourceBranch, 200);
  const environmentGroup = inferEnvironmentGroup(environmentName, sourceBranch, definition.name, resource.buildNumber);
  const eventId = text(body.id || resource.id || body.notificationId, 300);
  return {
    eventId: eventId || ['build.complete', resource.id, resource.buildNumber, date(body.createdDate)].join('|'),
    subscriptionId: text(body.subscriptionId, 200),
    publisherId: text(body.publisherId, 200),
    eventType: 'build.complete',
    sourceType: 'build',
    sourceVersion: text(resource.sourceVersion, 200),
    repositoryId: text(repository.id, 200),
    buildSourceBranch: sourceBranch,
    projectId: text(project.id || resource.projectId, 200),
    projectName: text(project.name || resource.projectName),
    environment: environmentName,
    environmentGroup,
    repositoryName: text(repository.name || repository.id, 300),
    sourceBranch,
    targetBranch: '',
    pullRequestId,
    pullRequestTitle: '',
    pullRequestAuthor: '',
    requestedBy: text(requestedFor.displayName || requestedFor.uniqueName || requestedFor.id, 300),
    pullRequestUrl: '',
    pipelineId: text(definition.id, 200),
    pipelineName: text(definition.name),
    runId: text(resource.id, 200),
    runName: text(resource.buildNumber),
    stageId: '',
    stageName: 'Build',
    status: text(resource.status, 100),
    result: text(resource.result, 100),
    startedAt: date(resource.startTime),
    completedAt: date(resource.finishTime),
    eventCreatedAt: date(body.createdDate) || new Date().toISOString(),
    url: linkOf(resource),
    rawResourceVersion: text(body.resourceVersion, 100)
  };
}

function isDeploymentEvent(eventType) {
  return SUPPORTED_EVENTS.has(text(eventType, 200));
}

module.exports = { SUPPORTED_EVENTS, isDeploymentEvent, normalizeDeploymentEvent, normalizeBuildEvent, inferEnvironmentGroup };

