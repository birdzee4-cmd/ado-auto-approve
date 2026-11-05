const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildTracking } = require('../shared/pr-build-tracking');
const event = (id, result, extra = {}) => ({ eventId: String(id), projectId: 'project', repositoryName: 'repo',
  sourceType: 'build', pipelineId: 'ci', pipelineName: 'oceanlife-web-stg-ci', sourceBranch: 'refs/heads/staging',
  environmentGroup: 'Staging', stageName: 'Build', runId: String(id), pullRequestId: String(id),
  eventCreatedAt: `2026-11-05T0${id}:00:00Z`, result, ...extra });
const mapping = { key: 'sample-stg', name: 'sample-stg', projectId: 'project', projectName: 'Project',
  repositoryName: 'repo', targetBranch: 'refs/heads/staging', environment: 'Staging',
  ci: { id: 'ci', name: 'CI' }, cd: { id: 'cd', name: 'CD', stageName: 'Deploy STG' } };
const cdEvent = (id, result, buildId) => event(id, result, { sourceType: 'classic-release', pipelineId: 'cd',
  pipelineName: 'CD', stageName: 'Deploy STG', repositoryName: '', sourceBranch: '', pullRequestId: '', artifactBuildIds: JSON.stringify([buildId]) });

test('project status requires the exact CI artifact; redeploying an old build does not deploy latest PR', () => {
  const items = [event(1, 'succeeded'), event(2, 'succeeded'), cdEvent(3, 'succeeded', '1')];
  let project = buildTracking(items, { mappings: [mapping] }).projects[0];
  assert.equal(project.status, 'awaiting-cd-evidence'); assert.equal(project.reusedBuild, true);
  assert.equal(project.latestDeployment.pullRequestId, '1');
  project = buildTracking([...items, cdEvent(4, 'succeeded', '2')], { mappings: [mapping] }).projects[0];
  assert.equal(project.status, 'succeeded'); assert.equal(project.cd.pullRequestId, '2');
  project = buildTracking([...items, cdEvent(4, 'succeeded', '2'), cdEvent(5, 'succeeded', '1')], { mappings: [mapping] }).projects[0];
  assert.equal(project.status, 'awaiting-cd-evidence'); assert.equal(project.reusedBuild, true);
});
test('project combines CI/CD failures and exposes the next successful PR in each stage', () => {
  const project = buildTracking([event(1, 'failed'), event(2, 'succeeded'), cdEvent(3, 'failed', '2'), cdEvent(4, 'succeeded', '2')], { mappings: [mapping] }).projects[0];
  assert.equal(project.ciFailed, 1); assert.equal(project.cdFailed, 1); assert.equal(project.openFailures, 0);
  assert.equal(project.failures[0].recovery.pullRequestId, '2'); assert.equal(project.status, 'succeeded');
});
test('project mapping rejects conflicting IDs and other branches despite similar names', () => {
  const items = [event(1, 'succeeded', { pipelineId: 'wrong', pipelineName: 'CI' }), event(2, 'succeeded', { sourceBranch: 'refs/heads/main' })];
  assert.equal(buildTracking(items, { mappings: [mapping] }).projects[0].status, 'unknown');
});

test('post-merge CI resolves PR by exact merge commit and preserves built branch', async () => {
  const { enrichBuildPullRequest } = require('../shared/build-pr-lineage');
  const sourceVersion = 'a'.repeat(40);
  const item = event(1, 'succeeded', { pullRequestId: '', repositoryId: 'repo-id', sourceVersion, buildSourceBranch: 'refs/heads/staging' });
  const ado = { getConfig: () => ({ org: 'org', project: 'Project' }), getPullRequestsForTargetBranch: async () => ({ ok: true, body: { value: [
    { pullRequestId: 321, lastMergeCommit: { commitId: sourceVersion }, sourceRefName: 'refs/heads/development', targetRefName: 'refs/heads/staging' },
    { pullRequestId: 322, lastMergeCommit: { commitId: 'b'.repeat(40) } }
  ] } }) };
  const enriched = await enrichBuildPullRequest(item, ado);
  assert.equal(enriched.pullRequestId, '321'); assert.equal(enriched.prLinkEvidence, 'merge-commit');
  assert.equal(enriched.sourceBranch, 'refs/heads/staging'); assert.match(enriched.pullRequestUrl, /pullrequest\/321$/);
  ado.getPullRequestsForTargetBranch = async () => ({ ok: false });
  const unknown = await enrichBuildPullRequest({ ...item, pullRequestId: '' }, ado);
  assert.equal(unknown.pullRequestId, '');
});
test('next PR in the same lane recovers failures without erasing failed runs', () => {
  const result = buildTracking([event(1, 'failed'), event(2, 'failed'), event(3, 'succeeded')]);
  assert.equal(result.failedRuns, 2); assert.equal(result.openFailures, 0);
  assert.equal(result.groups[0].failures[0].recovery.pullRequestId, '3');
});
test('CI, CD, stage, project, repository and branch cannot close one another', () => {
  for (const extra of [{ sourceType: 'classic-release' }, { stageName: 'Deploy' }, { projectId: 'other' },
    { repositoryName: 'other' }, { pipelineId: 'other' }, { sourceBranch: 'refs/heads/main' }, { environmentGroup: 'Production' }]) {
    assert.equal(buildTracking([event(1, 'failed'), event(2, 'succeeded', extra)]).openFailures, 1);
  }
});
test('duplicate hooks count once; separate retry attempts count separately', () => {
  const failed = event(1, 'failed');
  assert.equal(buildTracking([failed, { ...failed, eventId: 'duplicate' }]).failedRuns, 1);
  const retry = event(2, 'succeeded', { runId: '1', attemptId: '2' });
  assert.equal(buildTracking([{ ...failed, attemptId: '1' }, retry]).totalRuns, 2);
});
test('canceled, missing timestamps and equal timestamps do not prove recovery', () => {
  assert.equal(buildTracking([event(1, 'failed'), event(2, 'canceled')]).openFailures, 1);
  assert.equal(buildTracking([event(1, 'failed'), event(2, 'succeeded', { eventCreatedAt: '2026-11-05T01:00:00Z' })]).openFailures, 1);
});
test('classic release uses its explicit old artifact rather than latest build PR', () => {
  const result = buildTracking([event(1, 'succeeded'), event(2, 'succeeded'),
    event(3, 'failed', { sourceType: 'classic-release', pipelineId: 'cd', pullRequestId: '', artifactBuildIds: '["1"]' })]);
  assert.equal(result.groups.find(group => group.sourceType === 'classic-release').latest.pullRequestId, '1');
});
test('missing or ambiguous artifact lineage stays unknown', () => {
  for (const artifactBuildIds of ['invalid', '["1","2"]', '["999"]']) {
    const result = buildTracking([event(1, 'succeeded'), event(3, 'failed', { sourceType: 'classic-release', pipelineId: 'cd', pullRequestId: '', artifactBuildIds })]);
    assert.equal(result.groups.find(group => group.sourceType === 'classic-release').latest.pullRequestId, '');
  }
});

test('tracking endpoint authorizes before storage and does not filter out successful events', async () => {
  const auth = require('../shared/auth');
  const store = require('../shared/ado-deployment-event-store');
  const handler = require('../ado-pr-build-tracking');
  const originalAuth = auth.requireAnyRole, originalList = store.listAll;
  let calls = 0;
  try {
    auth.requireAnyRole = () => ({ ok: false, status: 403, body: 'Forbidden' });
    store.listAll = async options => { calls++; assert.equal(options.result, undefined); return [event(1, 'failed'), event(2, 'succeeded')]; };
    const context = { log: { error() {} } };
    await handler(context, { query: {} });
    assert.equal(context.res.status, 403); assert.equal(calls, 0);
    auth.requireAnyRole = () => ({ ok: true });
    await handler(context, { query: { result: 'failed' } });
    assert.equal(context.res.status, 200); assert.equal(context.res.body.tracking.openFailures, 0);
    assert.equal(context.res.headers['Cache-Control'], 'private, no-store');
    await handler(context, { query: { from: 'invalid' } });
    assert.equal(context.res.status, 400); assert.equal(calls, 1);
    store.listAll = async () => { throw new Error('private connection detail'); };
    await handler(context, { query: {} });
    assert.equal(context.res.status, 503);
    assert.ok(!JSON.stringify(context.res.body).includes('private connection'));
  } finally { auth.requireAnyRole = originalAuth; store.listAll = originalList; }
});
