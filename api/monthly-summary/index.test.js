const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = require('./helpers');
const monthly = require('./index');

test('defaults to the previous Bangkok calendar month', () => {
  const range = helpers.getBangkokMonthRange('', new Date('2026-08-07T12:00:00Z'));
  assert.equal(range.monthKey, '2026-07');
  assert.equal(range.startIso, '2026-06-30T17:00:00.000Z');
  assert.equal(range.endIso, '2026-07-31T17:00:00.000Z');
});

test('handles previous month across a year boundary', () => {
  const range = helpers.getBangkokMonthRange('', new Date('2026-01-01T01:00:00Z'));
  assert.equal(range.monthKey, '2025-12');
});

test('calculates monthly PR counts using a half-open Bangkok range', () => {
  const range = helpers.getBangkokMonthRange('2026-07');
  const prs = [
    { status: 'completed', creationDate: range.startIso, closedDate: '2026-07-10T00:00:00Z' },
    { status: 'abandoned', creationDate: '2026-07-20T00:00:00Z', closedDate: '2026-07-25T00:00:00Z' },
    { status: 'completed', creationDate: range.endIso, closedDate: range.endIso }
  ];
  const stats = helpers.calculatePrStats(prs, range);
  assert.equal(stats.created, 2);
  assert.equal(stats.completed, 1);
  assert.equal(stats.abandoned, 1);
  assert.equal(stats.completionRate, 50);
});

test('calculates approval actions without system marker rows', () => {
  const items = [
    { fields: { PR_ID: 101, Action: 'Auto Approved' } },
    { fields: { PR_ID: 101, Action: 'Approved' } },
    { fields: { PR_ID: 102, Action: 'Rejected' } },
    { fields: { PR_ID: 0, Action: 'Notification Sent' } }
  ];
  assert.deepEqual(helpers.calculateApprovalStats(items), {
    uniquePrs: 2,
    totalActions: 3,
    autoApproved: 1,
    manualApproved: 1,
    rejected: 1,
    onHold: 0,
    autoApproveRate: 50
  });
});

test('formats a compact Teams monthly summary', () => {
  const text = monthly.buildMonthlySummaryMessage({
    monthLabel: 'กรกฎาคม 2569',
    range: {
      start: '2026-06-30T17:00:00.000Z',
      end: '2026-07-31T17:00:00.000Z'
    },
    pr: {
      created: 10,
      completed: 8,
      abandoned: 1,
      completionRate: 80,
      activeNow: 2,
      activeMerge: 1
    },
    approval: {
      uniquePrs: 8,
      autoApproved: 6,
      manualApproved: 2,
      rejected: 0,
      onHold: 0,
      autoApproveRate: 75
    },
    build: {
      total: 9,
      succeeded: 8,
      failed: 1,
      successRate: 88.89,
      topFailedRepos: []
    },
    attention: {
      critical: 0,
      warning: 1,
      stale: 0,
      rejected: 0,
      failedOrPolicyFailed: 1
    },
    comparison: {
      created: { delta: 2, percent: 25 },
      completed: { delta: 0, percent: 0 },
      abandoned: { delta: -1, percent: -50 }
    },
    topRepos: [],
    attentionItems: [],
    dataQuality: {},
    reportUrl: 'https://example.test/report.html'
  }, false);

  assert.match(text, /Monthly PR Summary - Staging/);
  assert.match(text, /New PR \| 10 \| ▲ 25\.0%/);
  assert.match(text, /เปิดรายงานประจำเดือน/);
});

test('parses Logic Apps request options', () => {
  assert.deepEqual(monthly.parseRequestOptions(JSON.stringify({
    reportMonth: '2026-07',
    source: 'Logic Apps'
  })), {
    reportMonth: '2026-07',
    scheduledFor: '',
    testMode: false,
    requestedBy: '',
    source: 'Logic Apps Monthly Summary'
  });
});
