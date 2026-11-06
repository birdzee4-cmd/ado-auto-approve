const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnalytics } = require('../shared/deployment-analytics');

test('deployment analytics normalizes read-only event metrics and percentiles', () => {
  const result = buildAnalytics([
    { projectName: 'A', pipelineName: 'Build A', environmentGroup: 'Staging', result: 'succeeded', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:00Z' },
    { projectName: 'A', pipelineName: 'Build A', environmentGroup: 'Staging', result: 'failed', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:02:00Z' },
    { projectName: 'B', pipelineName: 'Build B', environmentGroup: 'Production', result: 'succeeded' }
  ]);
  assert.equal(result.projectCount, 2);
  assert.equal(result.pipelineCount, 2);
  assert.equal(result.results.failed, 1);
  assert.equal(result.duration.p50Seconds, 60);
  assert.equal(result.duration.p95Seconds, 120);
  assert.equal(result.pipelines[0].name, 'Build A');
  assert.equal(Object.hasOwn(result.pipelines[0], 'durations'), false);
});
