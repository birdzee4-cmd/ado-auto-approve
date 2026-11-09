const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, load } = require('../shared/company-deployment-monitor');
const { enrich } = require('../shared/company-monitor-ado-enrichment');
const row = overrides => ({ BuildId: '615209_M', CiName: 'service', Status: 'Complete', Branch: 'staging', LastUpdate: '05/11/2026 20:06:13', ...overrides });
test('preserves module/plugin identities and separates environment from Git branch', () => {
  const items = normalize([row({ BranchName: 'refs/heads/main' }), row({ BuildId: '615209_P', Status: 'Build fail' })]);
  assert.equal(items.length, 2); assert.notEqual(items[0].id, items[1].id);
  assert.equal(items[0].azureBuildId, '615209'); assert.equal(items[0].environment, 'Staging');
  assert.equal(items[0].branch, 'refs/heads/main'); assert.equal(items[1].terminal, true);
  assert.equal(items[0].updatedAt, '2026-11-05T20:06:13+07:00');
});
test('terminal rules include failure and cancellation; unknown environment stays Other', () => {
  const items = normalize(['Complete', 'Build fail', 'Deploy fail', 'Cancel Deploy', 'Building'].map(Status => row({ Status, Branch: 'unmapped' })));
  assert.equal(items.filter(item => item.terminal).length, 4); assert.ok(items.every(item => item.environment === 'Other'));
});
test('sorts newest first and rejects malformed upstream without returning partial counts', () => {
  assert.equal(normalize([row({ LastUpdate: '05/11/2026 09:00:00' }), row({ BuildId: '2' })])[0].id, '2');
  assert.throws(() => normalize({})); assert.throws(() => normalize([row({}), {}]));
});
test('upstream errors and HTML login responses are rejected', async () => {
  await assert.rejects(load(async () => ({ ok: false })));
  await assert.rejects(load(async () => ({ ok: true, headers: new Headers({ 'content-type': 'text/html' }) })));
});
test('normalizes lineage identifiers and marks incomplete lineage', () => {
  const [complete, incomplete] = normalize([
    row({ PipelineId: '42', RepositoryId: 'repo-1', Commit: 'C6B4C1A1', BranchName: 'refs/heads/Staging/Api' }),
    row({ BuildId: '2', PipelineId: '43', Repository: '', Commit: '' })
  ]);
  assert.equal(complete.pipelineId, '42');
  assert.equal(complete.repositoryId, 'repo-1');
  assert.equal(complete.commitId, 'c6b4c1a1');
  assert.equal(complete.lineageUnavailable, false);
  assert.equal(incomplete.lineageUnavailable, true);
});
test('uses Service Hook build lineage before Azure DevOps API enrichment', async () => {
  const [item] = normalize([row({ BuildId: '616170', Repository: '', Commit: '' })]);
  const [enriched] = await enrich([item], { lineageByBuildId: { '616170': {
    runId: '616170', sourceVersion: 'C6B4C1A1', repositoryId: 'repo-1', repositoryName: 'Net_Project.Sika', sourceBranch: 'refs/heads/Staging/Api', result: 'succeeded', url: 'hook-url'
  } } });
  assert.equal(enriched.commitId, 'c6b4c1a1');
  assert.equal(enriched.repository, 'Net_Project.Sika');
  assert.equal(enriched.lineageSource, 'service-hook');
});
test('HTTP handler requires dashboard roles before accessing upstream', async () => {
  const handler = require('../company-deployment-monitor');
  const context = { log: { warn() {}, error() {} } };
  await handler(context, { headers: {} }); assert.equal(context.res.status, 401);
  const principal = Buffer.from(JSON.stringify({ userRoles: ['authenticated'] })).toString('base64');
  await handler(context, { headers: { 'x-ms-client-principal': principal } }); assert.equal(context.res.status, 403);
});
