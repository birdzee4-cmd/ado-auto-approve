function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function buildAnalytics(items) {
  const pipelines = new Map();
  const durations = [];
  const projects = new Set();
  const environments = {};
  const results = {};
  for (const item of items) {
    const pipeline = item.pipelineName || 'Unknown pipeline';
    const project = item.projectName || 'Unknown project';
    const status = String(item.result || 'unknown').toLowerCase() || 'unknown';
    projects.add(project);
    environments[item.environmentGroup || 'Other'] = (environments[item.environmentGroup || 'Other'] || 0) + 1;
    results[status] = (results[status] || 0) + 1;
    const started = Date.parse(item.startedAt || '');
    const completed = Date.parse(item.completedAt || '');
    const durationSeconds = started && completed && completed >= started ? Math.round((completed - started) / 1000) : null;
    if (durationSeconds != null) durations.push(durationSeconds);
    if (!pipelines.has(pipeline)) pipelines.set(pipeline, { name: pipeline, project, total: 0, failed: 0, succeeded: 0, durations: [] });
    const record = pipelines.get(pipeline); record.total += 1;
    if (status === 'failed') record.failed += 1;
    if (status === 'succeeded') record.succeeded += 1;
    if (durationSeconds != null) record.durations.push(durationSeconds);
  }
  const pipelineRows = [...pipelines.values()].map(row => ({ ...row, averageDurationSeconds: row.durations.length ? Math.round(row.durations.reduce((a, b) => a + b, 0) / row.durations.length) : null, p95DurationSeconds: percentile(row.durations, .95), successRate: row.total ? Number((row.succeeded / row.total * 100).toFixed(2)) : 0, durations: undefined })).sort((a, b) => b.failed - a.failed || b.total - a.total);
  return { totalEvents: items.length, projectCount: projects.size, pipelineCount: pipelines.size, results, environments, duration: { samples: durations.length, averageSeconds: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null, p50Seconds: percentile(durations, .5), p80Seconds: percentile(durations, .8), p95Seconds: percentile(durations, .95) }, pipelines: pipelineRows };
}

module.exports = { buildAnalytics, percentile };
