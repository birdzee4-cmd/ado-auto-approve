const test = require('node:test');
const assert = require('node:assert/strict');

const reportSummary = require('../report-summary');
const {
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
    successRate: 50,
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
  assert.equal(outcome.successRate, 100);
  assert.equal(outcome.coverageRate, 66.67);
  assert.equal(outcome.completedPrs, 1);
  assert.equal(outcome.inProgressPrs, 1);
  assert.equal(outcome.unmatchedPrs, 1);
});

function buildRow(prId, status, buildNumber) {
  return {
    PrId: String(prId),
    Status: status,
    BuildNumber: buildNumber
  };
}
