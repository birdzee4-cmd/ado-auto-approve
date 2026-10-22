const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, runUat, tokenPreflight } = require('../../scripts/deployment-monitoring/run-uat-driver.cjs');
const config = { connectApproved: true, readApproved: true, server: 'synthetic.invalid', database: 'synthetic',
  day: '2026-10-22', storageTimezone: 'Asia/Bangkok', clientId: '00000000-0000-0000-0000-000000000000', tenantId: 'common' };
function token(overrides = {}) {
  const payload = { tid: config.tenantId, aud: 'https://database.windows.net/', exp: 2000000000, ...overrides };
  return `e.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
}

test('UAT runner defaults to plan only and never loads credentials or executor', async () => {
  const dependencies = { getToken: () => { throw new Error('must not authenticate'); }, executorFactory: () => { throw new Error('must not connect'); } };
  const result = await runUat(parseArgs([]), dependencies);
  assert.equal(result.mode, 'plan-only'); assert.equal(result.connected, false);
  assert.equal((await runUat({ ...config, readApproved: false }, dependencies)).sourceRead, false);
  assert.throws(() => parseArgs(['--connect-approved']));
  assert.throws(() => parseArgs(['--read-approved']));
  assert.throws(() => parseArgs(['--sql', 'SELECT *']));
  assert.throws(() => parseArgs(['--day', '2026-02-30']));
});

test('approved runner reads at most two list rows, one detail, and day summary without logging rows or token', async () => {
  const calls = []; const emitted = []; let closes = 0; let settings;
  const result = await runUat(config, {
    now: () => new Date('2026-10-22T10:00:00Z'), emit: value => emitted.push(value), getToken: async () => token(),
    executorFactory: options => { settings = options; return {
      close: async () => { closes++; }, execute: async query => {
        calls.push(query);
        if (query.text.includes('COUNT_BIG')) return [{ Status: 400, IsPrepared: true, recordCount: '4' }];
        return [{ ID: 7, ProjectName: 'private-project', Owner: 'private-person', Status: 400, DeployType: 0,
          GetType: 1, Priority: 0, TargetDate: '2026-10-22T00:00:00', IsPrepared: true }];
      }
    }; }
  });
  assert.equal(calls.length, 3); assert.equal(closes, 1);
  assert.equal(calls[0].parameters.find(p => p.name === 'take').value, 2);
  assert.equal(calls[1].parameters.find(p => p.name === 'id').value, 7);
  for (const index of [0, 2]) {
    assert.equal(calls[index].parameters.find(p => p.name === 'from').value.toISOString(), '2026-10-22T00:00:00.000Z');
    assert.equal(calls[index].parameters.find(p => p.name === 'toExclusive').value.toISOString(), '2026-10-23T00:00:00.000Z');
  }
  assert.equal(result.detail, 'matched-id'); assert.equal(result.summary.total, 4);
  assert.match((await settings.getConfig()).authentication.options.token, /^e\..+\.s$/);
  assert.doesNotMatch(JSON.stringify({ result, emitted }), /private-person|private-project/);
});

test('empty UAT list skips detail and makes no extra lookup or paging query', async () => {
  let reads = 0;
  const result = await runUat(config, { getToken: async () => token(), executorFactory: () => ({
    close: async () => {}, execute: async query => { reads++; return query.text.includes('COUNT_BIG') ? [] : []; }
  }) });
  assert.equal(reads, 2); assert.equal(result.detail, 'not-tested-empty-list'); assert.equal(result.summary.total, 0);
});

test('UAT runner stops on failed read, closes pool, and does not retry or continue to detail/summary', async () => {
  let reads = 0; let closes = 0;
  await assert.rejects(runUat(config, { getToken: async () => token(), executorFactory: () => ({
    close: async () => { closes++; }, execute: async () => { reads++; throw Object.assign(new Error('safe'), { code: 'MONITORING_UNAVAILABLE' }); }
  }) }), { code: 'MONITORING_UNAVAILABLE' });
  assert.equal(reads, 1); assert.equal(closes, 1);
});

test('invalid UAT configuration is rejected before sign-in', async () => {
  let signIns = 0;
  await assert.rejects(runUat({ ...config, storageTimezone: undefined }, { getToken: async () => { signIns++; } }));
  assert.equal(signIns, 0);
});

test('token preflight rejects malformed, wrong tenant/audience, expired and not-yet-valid tokens', () => {
  const now = () => new Date('2026-10-22T10:00:00Z');
  assert.throws(() => tokenPreflight('bad', 'common', now), { code: 'TOKEN_INVALID' });
  assert.throws(() => tokenPreflight(token({ tid: 'other' }), 'common', now), { code: 'TOKEN_TENANT_MISMATCH' });
  assert.throws(() => tokenPreflight(token({ aud: 'https://graph.microsoft.com/' }), 'common', now), { code: 'TOKEN_AUDIENCE_MISMATCH' });
  assert.throws(() => tokenPreflight(token({ exp: 1 }), 'common', now), { code: 'TOKEN_EXPIRED' });
  assert.throws(() => tokenPreflight(token({ nbf: 2000000000 }), 'common', now), { code: 'TOKEN_NOT_YET_VALID' });
});

test('token preflight runs before executor creation', async () => {
  let created = 0;
  await assert.rejects(runUat(config, { getToken: async () => token({ aud: 'wrong' }), executorFactory: () => { created++; } }), { code: 'TOKEN_AUDIENCE_MISMATCH' });
  assert.equal(created, 0);
});
