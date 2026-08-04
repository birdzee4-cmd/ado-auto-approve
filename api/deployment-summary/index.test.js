const test = require('node:test');
const assert = require('node:assert/strict');
const summary = require('./index');

test('aggregates dashboard KPIs and chart series', () => {
  const records = [
    { lifecycleStatus: 'Completed', deployResult: '✅ Success', category: 'web-service', project: 'Alpha', plannedDeployAt: '2026-07-01T00:00:00.000Z' },
    { lifecycleStatus: 'Completed', deployResult: '⚠️ Success with Issue', category: 'web-service', project: 'Alpha', plannedDeployAt: '2026-07-02T00:00:00.000Z' },
    { lifecycleStatus: 'Completed', deployResult: '🔄 Rolled Back', category: 'mobile', project: 'Beta', plannedDeployAt: '2026-07-03T00:00:00.000Z' },
    { lifecycleStatus: 'Planned', deployResult: '', category: 'mobile', project: 'Beta', plannedDeployAt: '2026-07-31T00:00:00.000Z' }
  ];
  const result = summary.aggregateDeployments(records, new Date('2026-07-31T00:00:00.000Z'));
  assert.equal(result.counts.total, 4);
  assert.equal(result.counts.successful, 1);
  assert.equal(result.counts.successWithIssue, 1);
  assert.equal(result.counts.rolledBack, 1);
  assert.equal(result.counts.planned, 1);
  assert.equal(result.counts.successRate, 33.3);
  assert.equal(result.topProjects[0].name, 'Alpha');
  assert.equal(result.trend.length, 4);
});

test('resolves dashboard date presets', () => {
  const now = new Date('2026-07-31T12:00:00.000Z');
  assert.deepEqual(summary.resolveRange({ range: 'today' }, now), {
    preset: 'today', from: '2026-07-31', to: '2026-07-31'
  });
  assert.deepEqual(summary.resolveRange({ range: 'last-3-months' }, now), {
    preset: 'last-3-months', from: '2026-05-01', to: '2026-07-31'
  });
});

test('aggregates more than 1000 deployments without truncation', () => {
  const records = Array.from({ length: 1501 }, (_, index) => ({
    lifecycleStatus: 'Completed',
    deployResult: '✅ Success',
    category: index % 2 ? 'mobile' : 'web-service',
    project: 'Project ' + (index % 5),
    plannedDeployAt: '2026-07-01T00:00:00.000Z'
  }));
  const result = summary.aggregateDeployments(records, new Date('2026-07-31T00:00:00.000Z'));
  assert.equal(result.counts.total, 1501);
  assert.equal(result.counts.successful, 1501);
  assert.equal(result.counts.successRate, 100);
});
