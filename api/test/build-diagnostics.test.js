'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures/build-diagnostics');
const analyzer = require('../shared/build-diagnostics-analyzer');
const redactor = require('../shared/build-diagnostics-redactor');
const service = require('../shared/build-diagnostics-service');

test('BuildKit missing secret is the high-confidence root cause', () => {
  const result = analyzer.analyzeLog(fixtures.buildKitSecret);
  assert.equal(result.errorKey, 'DOCKER_BUILDKIT_SECRET_MISSING');
  assert.equal(result.status, 'classified');
  assert.equal(result.confidence, 'high');
  assert.equal(result.exactError.secretName, 'build_pat');
  assert.match(result.rootCauseSummary, /build_pat/);
  assert.equal(result.evidence[0].kind, 'root-cause');
  assert.ok(result.wrapperErrors.length > 0);
  assert.deepEqual(result.causalChain.slice(0, 2), [
    'build_pat was not mounted into Docker Build',
    '/run/secrets/build_pat was unavailable'
  ]);
});

test('known rule fixtures remain classified and Docker wrapper stays partial', () => {
  const expected = {
    nuget: 'NU3012',
    typescript: 'TS_COMPILE_ERROR',
    csharp: 'CS_COMPILE_ERROR',
    npmConflict: 'NPM_CONFLICT',
    eslint: 'ESLINT_ERROR',
    timeout: 'TIMEOUT',
    unitTest: 'UNIT_TEST_FAILURE'
  };
  Object.entries(expected).forEach(([fixture, errorKey]) => {
    const result = analyzer.analyzeLog(fixtures[fixture]);
    assert.equal(result.errorKey, errorKey, fixture);
    assert.equal(result.status, 'classified', fixture);
  });
  const wrapper = analyzer.analyzeLog(fixtures.dockerWrapper);
  assert.equal(wrapper.errorKey, 'DOCKER_BUILD_ERROR');
  assert.equal(wrapper.status, 'partial');
  assert.equal(wrapper.confidence, 'low');
});

test('unknown logs are honest unclassified results', () => {
  const result = analyzer.analyzeLog(fixtures.generic);
  assert.equal(result.status, 'unclassified');
  assert.equal(result.confidence, 'low');
  assert.match(result.rootCauseSummary, /ยังไม่พบสาเหตุหลัก/);
  assert.ok(result.missingInformation.length > 0);
});

test('redactor removes common credential forms and reports categories', () => {
  const source = [
    'Authorization: Bearer abcDEF1234567890.abcDEF1234567890.abcDEF1234567890',
    'API_KEY=sk_abcdefghijklmnopqrstuvwxyz123456',
    'Password=SuperSecret123!',
    'Server=db;AccountKey=AbCdEf0123456789+/AbCdEf0123456789+/;',
    '<add key="ClearTextPassword" value="NuGetSecret!" />',
    '{"password":"JsonSecret!"}',
    'https://build-user:my-private-password@feed.example/v3/index.json',
    '-----BEGIN PRIVATE KEY-----\nsecret-material\n-----END PRIVATE KEY-----'
  ].join('\n');
  const result = redactor.redactLog(source);
  assert.ok(result.summary.total >= 8);
  assert.doesNotMatch(result.text, /SuperSecret123|my-private-password|secret-material|abcdefghijklmnopqrstuvwxyz|NuGetSecret|JsonSecret/);
  assert.match(result.text, /\[REDACTED/);
});

test('multi-task service ranks root cause and tolerates an unavailable log', async () => {
  const records = [
    { id: 'wrapper', name: 'Docker wrapper', type: 'Task', state: 'completed', result: 'failed', log: { id: 1 } },
    { id: 'root', name: 'Docker build', type: 'Task', state: 'completed', result: 'failed', log: { id: 2 } },
    { id: 'missing', name: 'Publish', type: 'Task', state: 'completed', result: 'failed', log: { id: 3 } }
  ];
  const ado = {
    getBuildTimeline: async () => ({ ok: true, body: { records } }),
    getBuildLog: async (_buildId, logId) => {
      if (logId === 1) return { ok: true, body: fixtures.dockerWrapper };
      if (logId === 2) return { ok: true, body: fixtures.buildKitSecret };
      return { ok: false, status: 503 };
    }
  };
  const result = await service.collectBuildDiagnostics(ado, 563308, { concurrency: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.errorKey, 'DOCKER_BUILDKIT_SECRET_MISSING');
  assert.equal(result.diagnostics.primaryFailure.taskId, 'root');
  assert.equal(result.diagnostics.status, 'partial');
  assert.equal(result.failedTasks.length, 3);
  assert.ok(result.diagnostics.evidence.every((item) => item.taskId && item.logId));
  assert.match(result.diagnostics.missingInformation.join(' '), /Publish/);
});

test('GET build diagnostics is read-only and never checks or sends Teams notifications', async () => {
  const ado = require('../shared/ado-client');
  const sp = require('../shared/sharepoint-client');
  const originalTimeline = ado.getBuildTimeline;
  const originalLog = ado.getBuildLog;
  const originalDuplicateCheck = sp.getLogByEventKey;
  const originalTeamsUrl = process.env.TEAMS_WEBHOOK_URL;
  let duplicateChecks = 0;
  ado.getBuildTimeline = async () => ({
    ok: true,
    body: { records: [{ id: 'root', name: 'Docker build', type: 'Task', state: 'completed', result: 'failed', log: { id: 2 } }] }
  });
  ado.getBuildLog = async () => ({ ok: true, body: fixtures.buildKitSecret });
  sp.getLogByEventKey = async () => {
    duplicateChecks += 1;
    return { ok: true, body: { value: [] } };
  };
  process.env.TEAMS_WEBHOOK_URL = 'https://example.invalid/webhook';

  try {
    const handler = require('../build-diagnostics/index');
    const context = { log: Object.assign(() => {}, { warn: () => {}, error: () => {} }), res: null };
    await handler(context, {
      method: 'GET',
      headers: { 'x-ms-client-principal': 'test' },
      query: { buildId: '563308' },
      body: {}
    });
    assert.equal(context.res.status, 200);
    assert.equal(duplicateChecks, 0);
    const payload = JSON.parse(context.res.body);
    assert.equal(payload.diagnostics.errorKey, 'DOCKER_BUILDKIT_SECRET_MISSING');
  } finally {
    ado.getBuildTimeline = originalTimeline;
    ado.getBuildLog = originalLog;
    sp.getLogByEventKey = originalDuplicateCheck;
    if (originalTeamsUrl === undefined) delete process.env.TEAMS_WEBHOOK_URL;
    else process.env.TEAMS_WEBHOOK_URL = originalTeamsUrl;
  }
});

test('webhook preserves build notification deduplication', async () => {
  const ado = require('../shared/ado-client');
  const sp = require('../shared/sharepoint-client');
  const teams = require('../shared/teams-notifier');
  const originalTimeline = ado.getBuildTimeline;
  const originalLog = ado.getBuildLog;
  const originalDuplicateCheck = sp.getLogByEventKey;
  const originalNotify = teams.notifyTeams;
  const originalTeamsUrl = process.env.TEAMS_WEBHOOK_URL;
  let notifications = 0;
  ado.getBuildTimeline = async () => ({
    ok: true,
    body: { records: [{ id: 'root', name: 'Docker build', type: 'Task', state: 'completed', result: 'failed', log: { id: 2 } }] }
  });
  ado.getBuildLog = async () => ({ ok: true, body: fixtures.buildKitSecret });
  sp.getLogByEventKey = async () => ({ ok: true, body: { value: [{ Id: 1 }] } });
  teams.notifyTeams = async () => {
    notifications += 1;
    return { ok: true, status: 200 };
  };
  process.env.TEAMS_WEBHOOK_URL = 'https://example.invalid/webhook';

  try {
    delete require.cache[require.resolve('../webhook/index')];
    const handler = require('../webhook/index');
    const context = { log: Object.assign(() => {}, { warn: () => {}, error: () => {} }), res: null };
    await handler(context, {
      headers: {},
      body: {
        eventType: 'build.complete',
        resource: {
          id: 563308,
          result: 'failed',
          status: 'completed',
          buildNumber: '563308',
          definition: { name: 'stg-api' },
          repository: { name: 'sample' },
          sourceBranch: 'refs/heads/staging'
        }
      }
    });
    assert.equal(notifications, 0);
    assert.equal(context.res.status, 200);
  } finally {
    ado.getBuildTimeline = originalTimeline;
    ado.getBuildLog = originalLog;
    sp.getLogByEventKey = originalDuplicateCheck;
    teams.notifyTeams = originalNotify;
    delete require.cache[require.resolve('../webhook/index')];
    if (originalTeamsUrl === undefined) delete process.env.TEAMS_WEBHOOK_URL;
    else process.env.TEAMS_WEBHOOK_URL = originalTeamsUrl;
  }
});
