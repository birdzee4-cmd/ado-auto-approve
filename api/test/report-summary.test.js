const test = require('node:test');
const assert = require('node:assert/strict');

const reportSummary = require('../report-summary');
const {
  classifyDeploymentStatus,
  commitIdsMatch,
  isDeploymentRelatedToReport,
  matchBuildsByMergeCommit,
  recordAutoApprovedPr,
  recordLatestAutoApproveBuild,
  summarizeAutoApproveOutcome
} = reportSummary._test;

test('auto-approve outcome uses the latest completed build after approval per PR', () => {
  const approved = new Map();
  const builds = new Map();
  recordAutoApprovedPr(approved, 101, 'repo-a', '2026-08-01T03:00:00.000Z');
  recordAutoApprovedPr(approved, 102, 'repo-b', '2026-08-01T04:00:00.000Z');

  recordLatestAutoApproveBuild(approved, builds, buildRow(101, 'Succeeded', '1001'), Date.parse('2026-08-01T02:00:00.000Z'));
  recordLatestAutoApproveBuild(approved, builds, buildRow(101, 'Succeeded', '1002'), Date.parse('2026-08-01T05:00:00.000Z'));
  recordLatestAutoApproveBuild(approved, builds, buildRow(101, 'Failed', '1003'), Date.parse('2026-08-01T06:00:00.000Z'));
  recordLatestAutoApproveBuild(approved, builds, buildRow(102, 'Succeeded', '1004'), Date.parse('2026-08-01T07:00:00.000Z'));
  recordLatestAutoApproveBuild(approved, builds, buildRow(999, 'Succeeded', '1005'), Date.parse('2026-08-01T08:00:00.000Z'));

  assert.deepEqual(summarizeAutoApproveOutcome(approved, builds), {
    totalAutoApprovedPrs: 2,
    matchedPrs: 2,
    completedPrs: 2,
    succeededPrs: 1,
    failedPrs: 1,
    inProgressPrs: 0,
    unmatchedPrs: 0,
    mergedPrs: 0,
    awaitingMergePrs: 0,
    notMergedPrs: 0,
    unknownMergePrs: 2,
    matchedMergedPrs: 0,
    unmatchedMergedPrs: 0,
    mergedBuildCoverageRate: 0,
    matchMethods: {
      prId: 2,
      mergeCommit: 0,
      buildChanges: 0
    },
    observationEnd: '',
    observationWindowHours: 0,
    successRate: 50,
    endToEndSuccessRate: 50,
    coverageRate: 100
  });
});

test('auto-approve outcome separates build coverage from completed-build success', () => {
  const approved = new Map();
  const builds = new Map();
  recordAutoApprovedPr(approved, 201, 'repo-a', '2026-08-01T03:00:00.000Z');
  recordAutoApprovedPr(approved, 202, 'repo-b', '2026-08-01T03:00:00.000Z');
  recordAutoApprovedPr(approved, 203, 'repo-c', '2026-08-01T03:00:00.000Z');
  recordLatestAutoApproveBuild(approved, builds, buildRow(201, 'Succeeded', '2001'), Date.parse('2026-08-01T04:00:00.000Z'));
  recordLatestAutoApproveBuild(approved, builds, buildRow(202, 'InProgress', '2002'), Date.parse('2026-08-01T05:00:00.000Z'));

  const outcome = summarizeAutoApproveOutcome(approved, builds);
  assert.equal(outcome.endToEndSuccessRate, 33.33);
  assert.equal(outcome.successRate, 100);
  assert.equal(outcome.coverageRate, 66.67);
  assert.equal(outcome.completedPrs, 1);
  assert.equal(outcome.inProgressPrs, 1);
  assert.equal(outcome.unmatchedPrs, 1);
});

test('deployment statuses are grouped into mutually exclusive report categories', () => {
  assert.equal(classifyDeploymentStatus('Succeeded'), 'succeeded');
  assert.equal(classifyDeploymentStatus('success'), 'succeeded');
  assert.equal(classifyDeploymentStatus('Failed'), 'failed');
  assert.equal(classifyDeploymentStatus('Canceled'), 'canceled');
  assert.equal(classifyDeploymentStatus('Partially Succeeded'), 'partial');
  assert.equal(classifyDeploymentStatus('inProgress'), 'inProgress');
  assert.equal(classifyDeploymentStatus('notStarted'), 'queued');
  assert.equal(classifyDeploymentStatus('queued'), 'queued');
  assert.equal(classifyDeploymentStatus('postponed'), 'queued');
  assert.equal(classifyDeploymentStatus('custom-status'), 'unknown');
});

test('related build scope requires a matching PR ID unless repository fallback is enabled', () => {
  const relatedPrIds = new Set(['301']);
  const relatedRepos = new Set(['repo a']);

  assert.equal(isDeploymentRelatedToReport(
    { PrId: '301', RepoName: 'repo-a' },
    relatedPrIds,
    relatedRepos,
    false
  ), true);
  assert.equal(isDeploymentRelatedToReport(
    { PrId: '', RepoName: 'repo-a' },
    relatedPrIds,
    relatedRepos,
    false
  ), false);
  assert.equal(isDeploymentRelatedToReport(
    { PrId: '', RepoName: 'repo-a' },
    relatedPrIds,
    relatedRepos,
    true
  ), true);
  assert.equal(isDeploymentRelatedToReport(
    { PrId: '999', RepoName: 'repo-a' },
    relatedPrIds,
    relatedRepos,
    true
  ), false);
});

test('merge commit matching links a staging build without a PR ID', () => {
  const approved = new Map();
  const builds = new Map();
  const evidence = new Map();
  recordAutoApprovedPr(approved, 401, 'repo-a', '2026-08-01T03:00:00.000Z');
  evidence.set('401', {
    state: 'merged',
    mergeCommit: 'abcdef1234567890',
    repoKey: 'repo a'
  });

  matchBuildsByMergeCommit(approved, evidence, builds, [{
    PrId: '',
    RepoName: 'repo-a',
    CommitHash: 'abcdef1234567890',
    Status: 'Succeeded',
    BuildNumber: '4001',
    FinishedTime: '2026-08-01T04:00:00.000Z'
  }]);

  assert.equal(builds.get('401').status, 'succeeded');
  assert.equal(builds.get('401').matchMethod, 'mergeCommit');
  const outcome = summarizeAutoApproveOutcome(approved, builds, evidence);
  assert.equal(outcome.mergedPrs, 1);
  assert.equal(outcome.unmatchedMergedPrs, 0);
  assert.deepEqual(outcome.matchMethods, {
    prId: 0,
    mergeCommit: 1,
    buildChanges: 0
  });
});

test('commit matching accepts normal SHA prefixes but rejects ambiguous short values', () => {
  assert.equal(commitIdsMatch('abcdef1234567890', 'abcdef1'), true);
  assert.equal(commitIdsMatch('abcdef1234567890', 'abc'), false);
  assert.equal(commitIdsMatch('abcdef1234567890', '9999999999999999'), false);
});

function buildRow(prId, status, buildNumber) {
  return {
    PrId: String(prId),
    Status: status,
    BuildNumber: buildNumber
  };
}
