const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadProjectHistory } = require('../shared/pr-build-live');
const { buildTracking } = require('../shared/pr-build-tracking');
const [mapping] = require('../shared/pr-build-project-map.json');

test('delegated history links old build artifact to PR and preserves release retries', async () => {
  const sha = 'a'.repeat(40);
  const ado = {
    getConfig: () => ({ org: 'Buzzebees', project: 'Buzzebees' }),
    listBuilds: async options => { assert.equal(options.accessToken, 'user-token'); return { ok: true, body: { value: [{ id: 608087,
      definition: { id: 11169, name: mapping.ci.name, project: { id: mapping.projectId, name: mapping.projectName } },
      repository: { id: 'repo', name: mapping.repositoryName }, sourceBranch: mapping.targetBranch, sourceVersion: sha,
      result: 'succeeded', finishTime: '2026-10-27T06:24:00Z' }] } }; },
    releaseRequest: async (method, url, body, options) => { assert.equal(method, 'GET'); assert.equal(options.accessToken, 'user-token'); assert.match(url, /definitionId=10239/);
      return { ok: true, body: { value: [{ id: 426752, name: 'Release', project: { id: mapping.projectId }, releaseDefinition: { id: 10239, name: mapping.cd.name },
        artifacts: [{ type: 'Build', definitionReference: { version: { id: '608087' } } }], environments: [{ id: 123, name: mapping.cd.stageName, status: 'succeeded',
          deploySteps: [{ attempt: 1, status: 'failed', completedOn: '2026-11-05T10:00:00Z' }, { attempt: 2, status: 'succeeded', completedOn: '2026-11-05T11:00:00Z' }] }] }] } }; },
    getPullRequestsForTargetBranch: async (repo, branch, top, options) => { assert.equal(options.accessToken, 'user-token'); return { ok: true, body: { value: [{ pullRequestId: 375391, lastMergeCommit: { commitId: sha } }] } }; }
  };
  const history = await loadProjectHistory(mapping, 'user-token', ado);
  const project = buildTracking(history.items).projects[0];
  assert.equal(project.status, 'succeeded'); assert.equal(project.ci.pullRequestId, '375391');
  assert.equal(project.cd.pullRequestId, '375391'); assert.equal(project.cdFailed, 1); assert.equal(project.openFailures, 0);
  assert.equal(project.ci.sourceVersion, sha); assert.equal(project.cd.sourceVersion, sha);
  assert.equal(project.cd.repositoryId, 'repo');
});
test('history rejects API failures and never falls back to the service PAT', async () => {
  const ado = { getConfig: () => ({ org: 'Buzzebees', project: 'Buzzebees' }),
    listBuilds: async () => ({ ok: false, status: 401 }), releaseRequest: async () => ({ ok: true, body: { value: [] } }) };
  await assert.rejects(loadProjectHistory(mapping, 'user-token', ado), error => error.status === 401);
});
