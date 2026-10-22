const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual legacy handler with synthetic CSV; never contact SharePoint.
async function history(query, response) {
  const downloads = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../deploy-history/index.js'), 'utf8'), {
    module,
    require(name) {
      assert.equal(name, '../shared/sharepoint-client');
      return { async downloadArchiveFile(file) { downloads.push(file); return response; } };
    }
  });
  const log = Object.assign(() => {}, { warn() {}, error() {} });
  const context = { log };
  await module.exports(context, { query });
  return { downloads, status: context.res.status, body: JSON.parse(context.res.body) };
}

test('legacy history preserves annual CSV selection and quoted multiline values', async () => {
  const result = await history({ year: '2026' }, {
    ok: true, status: 200,
    body: '\uFEFFBuildNumber,Status,CommitMessage\r\n42,Succeeded,"synthetic, first\nsecond ""quoted"""\r\n'
  });
  assert.deepEqual(result.downloads, ['deploy-history/stg-deployments-2026.csv']);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ok: true, count: 1,
    deployments: [{ BuildNumber: '42', Status: 'Succeeded', CommitMessage: 'synthetic, first\nsecond "quoted"' }]
  });
});

test('legacy history keeps default CSV and successful empty response for missing archive', async () => {
  const result = await history({}, { ok: false, status: 404 });
  assert.deepEqual(result.downloads, ['deploy-history/stg-deployments.csv']);
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.count, 0);
  assert.deepEqual(result.body.deployments, []);
});

test('legacy history does not interpolate invalid year into archive path', async () => {
  const result = await history({ year: '../other' }, { ok: true, status: 200, body: '' });
  assert.deepEqual(result.downloads, ['deploy-history/stg-deployments.csv']);
  assert.equal(result.body.count, 0);
});
