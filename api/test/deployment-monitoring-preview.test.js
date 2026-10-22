const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createPreviewServer } = require('../../scripts/preview-deployment-monitoring.cjs');
const fixtureModule = import('../../docs/prototypes/deployment-monitoring-fixtures.mjs');

test('synthetic filters preserve raw zero/null and Bangkok date boundaries', async () => {
  const { bangkokToday, makeFixtures, filterFixtures } = await fixtureModule;
  const day = bangkokToday(new Date('2026-10-21T17:00:00Z'));
  assert.equal(day, '2026-10-22');
  assert.equal(bangkokToday(new Date('2026-10-21T16:59:59Z')), '2026-10-21');
  const rows = makeFixtures(day);
  const filters = { from: day, to: day, project: '', q: '', status: '' };
  assert.equal(filterFixtures(rows, filters).length, 4);
  assert.deepEqual(filterFixtures(rows, { ...filters, status: '0' }).map(row => row.Status), [0]);
  assert.equal(filterFixtures(rows, { ...filters, status: 'unknown' }).length, 4);
  assert.equal(filterFixtures(rows, { ...filters, q: 'DEMO-1.8.2' })[0].ID, 902);
  assert.equal(filterFixtures(rows, { ...filters, project: rows[0].ProjectName }).length, 2);
  assert.equal(filterFixtures(rows, { ...filters, from: '2026-10-23', to: '2026-10-24' }).length, 0);
  assert.equal(filterFixtures(rows, { ...filters, q: '<script>alert(1)</script>' }).length, 0);
});

test('local preview serves only allowlisted assets and cannot expose repo/API/credentials', async () => {
  const server = createPreviewServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  function read(path, method = 'GET') {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method }, res => {
        let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', reject); req.end();
    });
  }
  try {
    const page = await read('/');
    assert.equal(page.status, 200);
    assert.match(page.body, /ข้อมูลสังเคราะห์/);
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.match(page.headers['content-security-policy'], /connect-src 'none'/);
    assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
    for (const path of ['/AGENTS.md', '/.git/config', '/api/deploy-history', '/../AGENTS.md', '/%2e%2e/AGENTS.md', '/local.settings.json', '/deployment-monitoring.html?path=../../.git/config']) {
      const response = await read(path);
      assert.equal(response.status, 404, path);
      assert.equal(response.body, '');
    }
    assert.match((await read('/deployment-monitoring-preview.mjs')).headers['content-type'], /javascript/);
    assert.equal((await read('/', 'HEAD')).body, '');
    const unsupported = await read('/', 'POST');
    assert.equal(unsupported.status, 405);
    assert.equal(unsupported.headers.allow, 'GET, HEAD');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
