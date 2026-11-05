const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deploymentVersions } = require('../shared/deployment-versions');
const { buildTracking } = require('../shared/pr-build-tracking');
const sha = 'a'.repeat(40);
const item = (id, extra = {}) => ({ projectId: 'project', repositoryId: 'repo-id', repositoryName: 'Repository', sourceVersion: sha,
  sourceType: 'build', pipelineId: 'ci', pipelineName: 'CI', stageName: 'Build', environmentGroup: 'Staging',
  runId: String(id), eventId: `event-${id}`, result: 'succeeded', eventCreatedAt: `2026-11-05T0${id}:00:00Z`, ...extra });
const versions = (items, options) => deploymentVersions(buildTracking(items, { mappings: [] }), options);

test('one commit with multiple builds is one version; release artifact is compared by Build ID', () => {
  const result = versions([item(1), item(2), item(3, { sourceType: 'classic-release', pipelineId: 'cd', artifactBuildIds: '["1"]' })]);
  assert.equal(result.rows.length, 1); assert.equal(result.buildCount, 2); assert.equal(result.deploymentCount, 1);
  assert.equal(result.rows[0].environments.Staging.status, 'succeeded');
  assert.equal(result.rows[0].environments.Staging.sameBuildAsLatestCI, false);
  assert.equal(result.rows[0].environments.Production.status, 'not-checked');
  assert.equal(result.runtimeVerified, false);
});
test('pipeline stages do not count as verified deployments or duplicate Build runs', () => {
  const result = versions([item(1), item(1, { sourceType: 'yaml-pipeline', eventId: 'stage', stageName: 'BuildAndPush' })]);
  assert.equal(result.buildCount, 1); assert.equal(result.deploymentCount, 0);
  assert.equal(result.rows[0].pipelineStages.length, 1);
});
test('short hash ambiguity and repository scope are preserved', () => {
  const result = versions([item(1), item(2, { sourceVersion: 'a'.repeat(8) + 'b'.repeat(32) }),
    item(3, { repositoryId: 'other', repositoryName: 'Other' })], { commit: 'aaaaaaaa' });
  assert.equal(result.rows.length, 3); assert.equal(result.ambiguous, true);
  assert.equal(versions([item(1)], { commit: 'bbbbbbb' }).matchedCount, 0);
});
test('latest successful deployment badge moves after newer commit deploys; unknown coverage stays unknown', () => {
  const result = versions([item(1, { sourceType: 'classic-release', pipelineId: 'cd' }),
    item(2, { sourceType: 'classic-release', pipelineId: 'cd', sourceVersion: 'b'.repeat(40) })], { checkedEnvironments: ['Staging'] });
  assert.equal(result.rows.find(row => row.commit === sha).environments.Staging.latestSuccessful, false);
  assert.equal(result.rows[0].environments.Staging.latestSuccessful, true);
  assert.equal(versions([item(1)], { checkedEnvironments: ['Staging'] }).rows[0].environments.Staging.status, 'not-found');
});
test('case aliases group exact repository and full hash consistently', () => {
  const result = versions([item(1), item(2, { repositoryId: '', repositoryName: 'repository', sourceVersion: sha.toUpperCase() })]);
  assert.equal(result.rows.length, 1); assert.equal(result.buildCount, 2);
});

test('STG and PRD compare the exact build artifact, not just source commit', () => {
  const stg = item(2, { sourceType: 'classic-release', pipelineId: 'stg', environmentGroup: 'Staging', artifactBuildIds: '["1"]' });
  const prd = item(3, { sourceType: 'classic-release', pipelineId: 'prd', environmentGroup: 'Production', artifactBuildIds: '["1"]' });
  assert.equal(versions([item(1), stg, prd]).rows[0].comparison, 'same-build');
  assert.equal(versions([item(1), stg, { ...prd, artifactBuildIds: '["99"]' }]).rows[0].comparison, 'same-source-different-build');
  assert.equal(versions([item(1), stg, { ...prd, result: 'failed' }]).rows[0].comparison, 'not-verified');
});
test('same commit separates latest CI and run counts by environment and pipeline', () => {
  const result = versions([item(1), item(2), item(3, { environmentGroup: 'Production', pipelineId: 'prd-ci', result: 'failed' })]);
  const lanes = result.rows[0].buildLanes;
  assert.equal(lanes.length, 2);
  assert.equal(lanes.find(lane => lane.environment === 'Staging').builds.length, 2);
  assert.equal(lanes.find(lane => lane.environment === 'Staging').latest.result, 'succeeded');
  assert.equal(lanes.find(lane => lane.environment === 'Production').latest.result, 'failed');
});
