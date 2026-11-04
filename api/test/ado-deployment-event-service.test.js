const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../shared/ado-deployment-event-service');

test('normalizes a Classic Release deployment completed event', () => {
  const event = service.normalizeDeploymentEvent({
    id: 'evt-classic-1',
    eventType: 'ms.azure-devops-release.deployment-completed-event',
    createdDate: '2026-11-03T01:02:03Z',
    resource: {
      deployment: {
        status: 'succeeded',
        completedOn: '2026-11-03T01:01:59Z',
        release: {
          id: 44,
          name: 'Release-44',
          project: { id: 'project-1', name: 'BuzzeBees' },
          releaseDefinition: { id: 7, name: 'Production CD' },
          _links: { web: { href: 'https://dev.azure.com/example/release/44' } }
        },
        environment: { id: 9, name: 'Production' }
      }
    }
  });
  assert.equal(event.sourceType, 'classic-release');
  assert.equal(event.projectName, 'BuzzeBees');
  assert.equal(event.pipelineName, 'Production CD');
  assert.equal(event.runId, '44');
  assert.equal(event.stageName, 'Production');
  assert.equal(event.result, 'succeeded');
});

test('normalizes a YAML stage state change event', () => {
  const event = service.normalizeDeploymentEvent({
    id: 'evt-yaml-1',
    eventType: 'ms.vss-pipelines.stage-state-changed-event',
    resource: {
      pipeline: { id: 12, name: 'deploy.yml' },
      run: { id: 101, name: '20261103.1', state: 'completed', result: 'succeeded' },
      stage: { id: 'prod', name: 'Deploy Production', state: 'completed', result: 'succeeded' }
    },
    resourceContainers: { project: { id: 'project-2' } }
  });
  assert.equal(event.sourceType, 'yaml-pipeline');
  assert.equal(event.pipelineId, '12');
  assert.equal(event.runId, '101');
  assert.equal(event.stageId, 'prod');
  assert.equal(event.status, 'completed');
  assert.equal(event.result, 'succeeded');
});

test('normalizes a completed build event for the deployment archive', () => {
  const event = service.normalizeBuildEvent({
    id: 'evt-build-1',
    eventType: 'build.complete',
    createdDate: '2026-11-04T01:02:03Z',
    resource: {
      id: 9001,
      buildNumber: '20261104.1',
      status: 'completed',
      result: 'succeeded',
      sourceBranch: 'refs/heads/staging',
      definition: { id: 22, name: 'Store CI' },
      repository: { name: 'Store' },
      project: { id: 'project-1', name: 'Buzzebees' },
      requests: [{ requestedFor: { displayName: 'Operator One' } }]
    }
  });
  assert.equal(event.sourceType, 'build');
  assert.equal(event.pipelineName, 'Store CI');
  assert.equal(event.runId, '9001');
  assert.equal(event.environmentGroup, 'Staging');
  assert.equal(event.requestedBy, 'Operator One');
  assert.equal(event.result, 'succeeded');
});

test('normalizes the different Classic Release deployment started payload shape', () => {
  const event = service.normalizeDeploymentEvent({
    id: 'evt-classic-started',
    eventType: 'ms.azure-devops-release.deployment-started-event',
    resource: {
      environment: {
        id: 5,
        name: 'UAT',
        status: 'queued',
        release: { id: 55, name: 'Release-55', _links: { web: { href: 'https://dev.azure.com/example/release/55' } } }
      },
      release: { releaseDefinition: { id: 8, name: 'UAT CD' } },
      project: { id: 'project-uat', name: 'UAT Project' }
    }
  });
  assert.equal(event.runId, '55');
  assert.equal(event.runName, 'Release-55');
  assert.equal(event.stageName, 'UAT');
  assert.equal(event.pipelineName, 'UAT CD');
  assert.equal(event.projectId, 'project-uat');
  assert.equal(event.status, 'queued');
});

test('ignores unrelated Azure DevOps events', () => {
  assert.equal(service.normalizeDeploymentEvent({ eventType: 'git.push', resource: {} }), null);
});

function context() {
  const log = () => {};
  log.warn = () => {};
  log.error = () => {};
  return { log };
}

test('webhook rejects an incorrect Basic Auth credential', { concurrency: false }, async () => {
  const previousUser = process.env.WEBHOOK_USERNAME;
  const previousPassword = process.env.WEBHOOK_PASSWORD;
  process.env.WEBHOOK_USERNAME = 'uat-hook';
  process.env.WEBHOOK_PASSWORD = 'secret';
  try {
    const handler = require('../webhook/index');
    const ctx = context();
    await handler(ctx, { headers: { authorization: 'Basic incorrect' }, body: {} });
    assert.equal(ctx.res.status, 401);
    assert.equal(ctx.res.body, 'Unauthorized');
  } finally {
    if (previousUser === undefined) delete process.env.WEBHOOK_USERNAME; else process.env.WEBHOOK_USERNAME = previousUser;
    if (previousPassword === undefined) delete process.env.WEBHOOK_PASSWORD; else process.env.WEBHOOK_PASSWORD = previousPassword;
  }
});

test('webhook accepts a deployment event without writing when feature flag is disabled', { concurrency: false }, async () => {
  const previousUser = process.env.WEBHOOK_USERNAME;
  const previousPassword = process.env.WEBHOOK_PASSWORD;
  const previousFlag = process.env.ADO_DEPLOYMENT_EVENTS_ENABLED;
  process.env.WEBHOOK_USERNAME = 'uat-hook';
  process.env.WEBHOOK_PASSWORD = 'secret';
  delete process.env.ADO_DEPLOYMENT_EVENTS_ENABLED;
  try {
    const authorization = 'Basic ' + Buffer.from('uat-hook:secret').toString('base64');
    const handler = require('../webhook/index');
    const ctx = context();
    await handler(ctx, {
      headers: { authorization },
      body: {
        id: 'evt-disabled',
        eventType: 'ms.azure-devops-release.deployment-completed-event',
        resource: {}
      }
    });
    assert.equal(ctx.res.status, 200);
    assert.match(ctx.res.body, /persistence disabled/);
  } finally {
    if (previousUser === undefined) delete process.env.WEBHOOK_USERNAME; else process.env.WEBHOOK_USERNAME = previousUser;
    if (previousPassword === undefined) delete process.env.WEBHOOK_PASSWORD; else process.env.WEBHOOK_PASSWORD = previousPassword;
    if (previousFlag === undefined) delete process.env.ADO_DEPLOYMENT_EVENTS_ENABLED; else process.env.ADO_DEPLOYMENT_EVENTS_ENABLED = previousFlag;
  }
});

