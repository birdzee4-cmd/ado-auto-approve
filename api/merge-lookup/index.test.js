const test = require('node:test');
const assert = require('node:assert/strict');
const lookup = require('./index');
const ado = require('../shared/ado-client');

const helpers = lookup._test;

test('buildIdsFromStatuses extracts and deduplicates Azure DevOps build links', () => {
  assert.deepEqual(helpers.buildIdsFromStatuses([
    { targetUrl: 'https://dev.azure.com/example/_build/results?buildId=524855&view=results' },
    { targetUrl: 'https://dev.azure.com/example/_apis/build/builds/524523' },
    { targetUrl: 'https://dev.azure.com/example/_build/results?buildId=524855' }
  ]), ['524855', '524523']);
});

test('buildMatchesComponent recognizes BuzzPosPilot historical builds', () => {
  assert.equal(helpers.buildMatchesComponent({
    sourceBranch: 'refs/heads/MergeCodeProduction/TH/2026/ModuleandPlugin/BuzzPosPilot/20260519',
    definition: { name: 'STG_Service_Module_BuzzPosPilot-CI' }
  }, ['buzzpospilot']), true);
  assert.equal(helpers.buildMatchesComponent({
    sourceBranch: 'refs/heads/Helpdesk/release',
    definition: { name: 'STG_Net_Api_Helpdesk_docker-CI' }
  }, ['buzzpospilot']), false);
});

test('closestCompletedPr links each historical build to the latest preceding PR', () => {
  const result = helpers.closestCompletedPr({
    sourceBranch: 'refs/heads/target/buzzpospilot',
    queueTime: '2026-05-20T04:27:03Z'
  }, [
    { pullRequestId: 340731, targetRefName: 'refs/heads/target/buzzpospilot', closedDate: '2026-05-19T09:58:19Z' },
    { pullRequestId: 340856, targetRefName: 'refs/heads/target/buzzpospilot', closedDate: '2026-05-20T04:26:13Z' }
  ]);
  assert.equal(result.pullRequestId, 340856);
});

test('historical recommendation has its own result status', () => {
  assert.equal(helpers.classify({ ciName: 'STG_Service_Module_BuzzPosPilot-CI' }, null), 'mapped-only');
});

test('historical evidence excludes the current branch and links older builds to PRs', async () => {
  const originalListBuilds = ado.listBuilds;
  const originalListPrs = ado.getPullRequestsForTargetBranch;
  ado.listBuilds = async () => ({
    ok: true,
    body: {
      value: [
        {
          id: 562134,
          queueTime: '2026-08-10T08:00:00Z',
          sourceBranch: 'refs/heads/MergeCodeProduction/BuzzPosPilot/current',
          definition: { id: 7093, name: 'STG_Service_Module_BuzzPosPilot-CI' }
        },
        {
          id: 524855,
          queueTime: '2026-05-20T04:27:03Z',
          sourceBranch: 'refs/heads/MergeCodeProduction/BuzzPosPilot/previous',
          definition: { id: 7093, name: 'STG_Service_Module_BuzzPosPilot-CI' }
        },
        {
          id: 524523,
          queueTime: '2026-05-19T09:59:59Z',
          sourceBranch: 'refs/heads/MergeCodeProduction/BuzzPosPilot/previous',
          definition: { id: 7093, name: 'STG_Service_Module_BuzzPosPilot-CI' }
        }
      ]
    }
  });
  ado.getPullRequestsForTargetBranch = async () => ({
    ok: true,
    body: {
      value: [
        { pullRequestId: 340731, targetRefName: 'refs/heads/MergeCodeProduction/BuzzPosPilot/previous', closedDate: '2026-05-19T09:58:19Z' },
        { pullRequestId: 340856, targetRefName: 'refs/heads/MergeCodeProduction/BuzzPosPilot/previous', closedDate: '2026-05-20T04:26:13Z' }
      ]
    }
  });

  try {
    const result = await helpers.getHistoricalEvidence('repo-id', {
      pullRequestId: 355289,
      title: 'BuzzPosPilot merge',
      creationDate: '2026-08-10T06:00:00Z',
      repository: { name: 'Net' },
      sourceRefName: 'refs/heads/Merge/BuzzPosPilot/current',
      targetRefName: 'refs/heads/MergeCodeProduction/BuzzPosPilot/current'
    }, {
      ciName: 'STG_Service_Module_BuzzPosPilot-CI',
      ciId: '7093'
    }, { accessToken: 'test-token' });

    assert.equal(result.count, 2);
    assert.equal(result.confidence, 'high');
    assert.deepEqual(result.evidence.map(item => item.pr && item.pr.id), [340856, 340731]);
    assert.equal(result.evidence.some(item => item.build.id === 562134), false);
  } finally {
    ado.listBuilds = originalListBuilds;
    ado.getPullRequestsForTargetBranch = originalListPrs;
  }
});
