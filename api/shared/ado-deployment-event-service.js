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
  const runId = text(isClassic ? (release.id || resource.releaseId) : (run.id || resource.runId), 200);
  const stageId = text(isClassic ? (environment.id || resource.environmentId) : (stage.id || stage.identifier), 200);
  const naturalKey = [eventType, runId, stageId, rawStatus, rawResult, date(body.createdDate)].join('|');

  return {
    eventId: eventId || naturalKey,
    eventType,
    sourceType: isClassic ? 'classic-release' : 'yaml-pipeline',
    projectId: text(project.id || resource.projectId || containerProject.id, 200),
    projectName: text(project.name || resource.projectName),
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

function isDeploymentEvent(eventType) {
  return SUPPORTED_EVENTS.has(text(eventType, 200));
}

module.exports = { SUPPORTED_EVENTS, isDeploymentEvent, normalizeDeploymentEvent };

