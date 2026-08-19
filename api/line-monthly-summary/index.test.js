const test = require('node:test');
const assert = require('node:assert/strict');
const lineMonthly = require('./index');

function sampleSummary() {
  return {
    monthKey: '2026-07',
    monthLabel: 'กรกฎาคม 2569',
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
      topFailedRepos: [{ repo: 'Node Web', count: 1 }]
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
      abandoned: { delta: -1, percent: -50 },
      autoApproved: { delta: 1, percent: 20 },
      failedBuilds: { delta: -1, percent: -50 }
    },
    topRepos: [{ repo: 'Net Project', count: 5 }],
    attentionItems: [{
      id: 123,
      repository: 'Node Web',
      url: 'https://example.test/pr/123',
      attention: { label: 'Waiting 4h+', ageLabel: '5h 10m' }
    }],
    dataQuality: {},
    reportUrl: 'https://example.test/report.html?type=monthly&year=2026&month=7'
  };
}

test('formats a compact LINE monthly summary without Markdown tables', () => {
  const text = lineMonthly.buildLineMonthlySummaryMessage(sampleSummary(), false);

  assert.match(text, /Monthly PR Summary - Staging \(LINE\)/);
  assert.match(text, /New PR: 10 \(▲ 25\.0%\)/);
  assert.match(text, /Failed: 1 \(▼ 50\.0%\)/);
  assert.match(text, /#123 Node Web — Waiting 4h\+/);
  assert.match(text, /เปิดรายงานประจำเดือน/);
  assert.doesNotMatch(text, /\| ---/);
  assert.ok(text.length < 5000);
});

test('marks test messages and warns when audit logs are truncated', () => {
  const summary = sampleSummary();
  summary.dataQuality.logsTruncated = true;
  const text = lineMonthly.buildLineMonthlySummaryMessage(summary, true);

  assert.match(text, /\[TEST\]/);
  assert.match(text, /10,000/);
});

test('parses Logic Apps LINE monthly request options', () => {
  assert.deepEqual(lineMonthly.parseRequestOptions(JSON.stringify({
    reportMonth: '2026-07',
    scheduledFor: '2026-08-01T08:05:00+07:00',
    source: 'Logic Apps'
  })), {
    reportMonth: '2026-07',
    scheduledFor: '2026-08-01T08:05:00+07:00',
    testMode: false,
    requestedBy: '',
    source: 'Logic Apps LINE Monthly Summary'
  });
});

test('rejects requests without a configured token', async () => {
  const names = [
    'LINE_MONTHLY_SUMMARY_TOKEN',
    'MONTHLY_SUMMARY_TOKEN',
    'LINE_DAILY_SUMMARY_TOKEN',
    'DAILY_SUMMARY_TOKEN'
  ];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  names.forEach(name => { delete process.env[name]; });
  const context = { log: { error() {}, warn() {} } };

  try {
    await lineMonthly(context, { headers: {} });
    assert.equal(context.res.status, 503);
    assert.equal(JSON.parse(context.res.body).ok, false);
  } finally {
    names.forEach(name => {
      if (typeof previous[name] === 'undefined') delete process.env[name];
      else process.env[name] = previous[name];
    });
  }
});
