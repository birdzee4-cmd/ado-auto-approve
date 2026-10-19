const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport } = require('../shared/operations-report');
const incident = (id, firstSeen, extra = {}) => ({ incidentId: id, firstSeen, resource: 'app-a', status: 'FIRING', ...extra });
test('weekly report uses Bangkok Monday boundaries and distinct incidents rather than alert occurrence count', () => {
  const report = buildReport([
    incident('before', '2026-10-18T16:59:59Z'),
    incident('one', '2026-10-18T17:00:00Z', { occurrenceCount: 99 }),
    incident('two', '2026-10-25T16:59:59Z', { status: 'RESOLVED', resource: 'APP-A' }),
    incident('after', '2026-10-25T17:00:00Z'),
    incident('invalid', 'invalid')
  ], { date: '2026-10-21', period: 'week' });
  assert.equal(report.start, '2026-10-19'); assert.equal(report.end, '2026-10-25');
  assert.equal(report.total, 2); assert.equal(report.resources.length, 1);
  assert.equal(report.resources[0].total, 2); assert.equal(report.active, 1); assert.equal(report.recovered, 1);
  assert.equal(report.daily.reduce((sum, row) => sum + row.count, 0), 2);
  assert.equal(report.unknownDates, 1);
});
test('monthly report handles leap month and separates identical names across resource groups', () => {
  const report = buildReport([
    incident('one', '2024-02-28T17:00:00Z', { resourceGroup: 'group-a' }),
    incident('two', '2024-02-29T16:59:59Z', { resourceGroup: 'group-b' }),
    incident('outside', '2024-02-29T17:00:00Z')
  ], { date: '2024-02-10', period: 'month' });
  assert.equal(report.end, '2024-02-29'); assert.equal(report.daily.length, 29);
  assert.equal(report.total, 2); assert.equal(report.resources.length, 2);
});
test('empty periods, date fallback, year crossover and invalid input', () => {
  assert.equal(buildReport([], { date: '2026-01-01' }).start, '2025-12-29');
  assert.equal(buildReport([], { date: '2026-01-01' }).total, 0);
  assert.equal(buildReport([incident('fallback', '', { receivedAt: '2026-01-01T00:00:00Z' })], { date: '2026-01-01' }).total, 1);
  for (const query of [{ date: '2026-02-30' }, { period: 'year' }, { date: 'oops' }]) assert.throws(() => buildReport([], query), { status: 400 });
});
test('report endpoint uses existing role authorization and returns the report envelope', async () => {
  const operations = require('../operations');
  const sp = require('../shared/operations-sharepoint-client');
  const original = sp.listReportIncidents;
  sp.listReportIncidents = async () => [incident('one', '2026-10-19T00:00:00Z')];
  try {
    const denied = {};
    await operations(denied, { headers: {}, params: { path: 'reports' }, query: {} });
    assert.equal(denied.res.status, 401);
    const context = { log: { error() {}, warn() {} } };
    await operations(context, { headers: { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userId: 'report-reader', userRoles: ['it_support_approve'] })).toString('base64') }, params: { path: 'reports' }, query: { period: 'week', date: '2026-10-19' } });
    assert.equal(context.res.status, 200);
    const body = typeof context.res.body === 'string' ? JSON.parse(context.res.body) : context.res.body;
    assert.equal(body.data.total, 1);
  } finally { sp.listReportIncidents = original; }
});
