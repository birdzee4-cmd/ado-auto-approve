const test = require('node:test');
const assert = require('node:assert/strict');
const { createRepository, boundaries } = require('../shared/deployment-monitoring-sql');
const { codeLabel } = require('../shared/deployment-monitoring-provisional');
const { validateFilters } = require('../shared/deployment-monitoring-validation');
const now = () => new Date('2026-10-22T10:00:00Z');
const row = { ID: 10, ProjectName: 'Synthetic', Owner: null, Status: 411, IsPrepared: true,
  Priority: 0, DeployType: 0, GetType: 1, VersionNumber: null,
  TargetDate: '2026-10-22T00:00:00', CompletedDate: null, LastModifiedDate: '2026-10-22T15:00:00.123',
  Server: 'must-not-leak', Description: 'must-not-leak', BackupPath: 'must-not-leak' };
function setup(rows = [row], options = {}) {
  const calls = [];
  const repo = createRepository({ now, developmentEnabled: true, storageTimezone: 'Asia/Bangkok',
    authorizeSource: async () => true, execute: async q => { calls.push(q); return rows; }, ...options });
  return { repo, calls };
}

test('repository remains disabled and rejects missing source approval before querying', async () => {
  for (const options of [{ developmentEnabled: false }, { authorizeSource: undefined },
    { authorizeSource: async () => false }, { authorizeSource: async () => 'true' }, { storageTimezone: undefined }]) {
    const { repo, calls } = setup([], options);
    await assert.rejects(repo.detail('1'), { code: 'MONITORING_UNAVAILABLE' });
    assert.equal(calls.length, 0);
  }
});

test('Bangkok calendar range converts to explicit SQL wall-clock carriers for both storage assumptions', () => {
  const filters = validateFilters({ from: '2026-10-22', to: '2026-10-22' });
  const local = boundaries(filters, 'Asia/Bangkok'); const utc = boundaries(filters, 'UTC');
  assert.equal(local.from.toISOString(), '2026-10-22T00:00:00.000Z');
  assert.equal(local.toExclusive.toISOString(), '2026-10-23T00:00:00.000Z');
  assert.equal(utc.from.toISOString(), '2026-10-21T17:00:00.000Z');
  assert.equal(utc.toExclusive.toISOString(), '2026-10-22T17:00:00.000Z');
  const leap = boundaries(validateFilters({ from: '2024-02-29', to: '2024-02-29' }), 'UTC');
  assert.equal(leap.toExclusive.toISOString(), '2024-02-29T17:00:00.000Z');
  assert.throws(() => boundaries(validateFilters({ from: '1753-01-01', to: '1753-01-01' }), 'UTC'), { code: 'INVALID_QUERY' });
});

test('SQL injection, Thai, quotes and LIKE metacharacters remain bound data', async () => {
  const { repo, calls } = setup();
  const q = "ทดสอบ '%_[~; DROP TABLE x --";
  await repo.list({ q, project: "project'; --", status: '-110', pageSize: '1' });
  const call = calls[0];
  assert.ok(!call.text.includes(q)); assert.ok(!call.text.includes("project'; --"));
  assert.equal(call.parameters.find(p => p.name === 'search').value, "%ทดสอบ '~%~_~[~~; DROP TABLE x --%");
  assert.deepEqual(call.parameters.find(p => p.name === 'status'), { name: 'status', type: 'Int', value: -110 });
  assert.equal(call.parameters.find(p => p.name === 'take').value, 2);
  assert.equal(call.parameters.find(p => p.name === 'project').length, 100);
  assert.match(call.text, /TargetDate\] >= @from/);
  assert.match(call.text, /ORDER BY \[TargetDate\] DESC, \[ID\] DESC$/);
  assert.equal(call.timeoutMs, 10000);
});

test('list explicitly marks truncation, strips unapproved fields and preserves null dates', async () => {
  const { repo } = setup([row, { ...row, ID: 9 }]);
  const result = await repo.list({ pageSize: '1' });
  assert.equal(result.items.length, 1); assert.equal(result.page.hasMore, true);
  assert.equal(result.page.paginationAvailable, false);
  assert.equal(result.items[0].TargetDate, '2026-10-22T00:00:00+07:00');
  assert.equal(result.items[0].CompletedDate, null);
  assert.equal(result.items[0].priority.label, 'ไม่ทราบรหัส (0)');
  assert.equal(result.items[0].status.isTerminal, null);
  assert.equal(result.assumptions.timezoneConfirmed, false);
  assert.equal(result.assumptions.fieldAllowlistApproved, false);
  assert.ok(!JSON.stringify(result).includes('must-not-leak'));
  const utc = setup([row], { storageTimezone: 'UTC' });
  assert.equal((await utc.repo.detail('10')).item.TargetDate, '2026-10-22T00:00:00Z');
});

test('detail handles not found and invalid IDs without exposing a raw row', async () => {
  const { repo, calls } = setup([]);
  assert.equal(await repo.detail('10'), null);
  assert.equal(calls[0].parameters[0].value, 10);
  await assert.rejects(repo.detail('1 OR 1=1'), { code: 'INVALID_QUERY' });
  assert.equal(calls.length, 1);
  await assert.rejects(setup([row, row]).repo.detail('10'), { code: 'MONITORING_UNAVAILABLE' });
});

test('summary aggregates whole filtered range with no inferred business outcomes', async () => {
  const { repo, calls } = setup([
    { Status: 411, IsPrepared: true, recordCount: '7' },
    { Status: -110, IsPrepared: false, recordCount: '2' },
    { Status: 999, IsPrepared: true, recordCount: '3' },
    { Status: null, IsPrepared: false, recordCount: '1' }
  ]);
  const result = await repo.summary({ project: 'Synthetic', pageSize: '1' });
  assert.equal(result.total, 13); assert.equal(result.prepared, 10); assert.equal(result.unknown, 4);
  assert.equal(result.successRate, null); assert.equal(result.overdue, null);
  assert.ok(!calls[0].text.includes('TOP')); assert.match(calls[0].text, /GROUP BY \[Status\], \[IsPrepared\]/);
  await assert.rejects(setup([{ Status: 0, recordCount: '9007199254740992' }]).repo.summary(), { code: 'MONITORING_UNAVAILABLE' });
});

test('unknown filter agrees with provisional negative-code labels and null semantics', async () => {
  const { repo, calls } = setup([]); await repo.list({ status: 'unknown' });
  assert.match(calls[0].text, /IS NULL OR \(\[Status\] >= 0 AND/);
  assert.ok(calls[0].parameters.some(p => p.name.startsWith('known') && p.value === 0));
  assert.equal(codeLabel('Status', -110).label, 'Terminate');
  assert.equal(codeLabel('Status', null).label, 'ไม่ระบุ');
  assert.equal(codeLabel('GetType', 2).label, 'Resize');
  assert.equal(codeLabel('DeployType', 2).label, 'No Action');
  assert.throws(() => codeLabel('Status', '411'), TypeError);
});

test('driver and authorization errors are sanitized and never retried automatically', async () => {
  for (const [code, expected] of [['ETIMEOUT', 'MONITORING_TIMEOUT'], ['ELOGIN', 'MONITORING_UNAVAILABLE']]) {
    let attempts = 0;
    const { repo } = setup([], { execute: async () => { attempts++; throw Object.assign(new Error('secret SQL server password'), { code }); } });
    await assert.rejects(repo.list(), e => e.code === expected && !e.message.includes('secret'));
    assert.equal(attempts, 1);
  }
  await assert.rejects(setup([], { authorizeSource: async () => { throw new Error('secret'); } }).repo.detail('1'),
    e => e.code === 'MONITORING_UNAVAILABLE' && !e.message.includes('secret'));
});
