const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { createService } = require('../shared/deployment-monitoring-service');
const { createRepository } = require('../shared/deployment-monitoring-sql');
const { createCursorCodec } = require('../shared/deployment-monitoring-cursor');
const { validateFilters } = require('../shared/deployment-monitoring-validation');
const { createHandlers } = require('../shared/deployment-monitoring-http');
const now = () => new Date('2026-10-22T10:00:00Z');
const secret = 'synthetic-test-key-only-32-characters-or-more';
const rows = [4, 3, 2, 1].map(ID => ({ ID, ProjectName: 'Synthetic', Owner: null, Status: 400,
  DeployType: 0, GetType: 1, Priority: 0, IsPrepared: true,
  TargetDate: '2026-10-22T00:00:00', LastModifiedDate: null, CompletedDate: null }));
function setup() {
  const calls = [];
  const repository = createRepository({ developmentEnabled: true, storageTimezone: 'Asia/Bangkok', now,
    authorizeSource: async () => true, execute: async query => {
      calls.push(query);
      if (query.text.includes('COUNT_BIG')) return [{ Status: 400, IsPrepared: true, recordCount: '4' }];
      const after = query.parameters.find(p => p.name === 'afterId');
      const id = query.parameters.find(p => p.name === 'id');
      const take = query.parameters.find(p => p.name === 'take');
      if (id) return rows.filter(r => r.ID === id.value);
      return rows.filter(r => !after || r.ID < after.value).slice(0, take.value);
    } });
  const service = createService({ repository, cursorSecret: secret, storageTimezone: 'Asia/Bangkok', now });
  return { service, calls };
}

test('service pages equal timestamps by unique ID, signs cursor, and ends with null cursor', async () => {
  const { service, calls } = setup(); const filters = validateFilters({ pageSize: '2' }, now());
  const first = await service.list(filters);
  assert.deepEqual(first.items.map(r => r.ID), [4, 3]);
  assert.equal(first.consistency, 'live'); assert.equal(first.page.paginationAvailable, true);
  assert.ok(first.page.nextCursor);
  const second = await service.list({ ...filters, cursor: first.page.nextCursor });
  assert.deepEqual(second.items.map(r => r.ID), [2, 1]); assert.equal(second.page.nextCursor, null);
  assert.equal(second.page.hasMore, false);
  assert.match(calls[1].text, /\[TargetDate\] < @afterDate OR \(\[TargetDate\] = @afterDate AND \[ID\] < @afterId\)/);
  assert.equal(calls[1].parameters.find(p => p.name === 'afterId').value, 3);
  assert.equal(calls[1].parameters.find(p => p.name === 'afterDate').value.toISOString(), '2026-10-22T00:00:00.000Z');
  assert.ok(!calls[1].text.includes(first.page.nextCursor));
});

test('tampering and changed filters fail before repository access', async () => {
  const { service, calls } = setup(); const filters = validateFilters({ pageSize: '2' }, now());
  const token = (await service.list(filters)).page.nextCursor;
  const [body, signature] = token.split('.');
  for (const input of [{ ...filters, cursor: `${body}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}` },
    ...[{ pageSize: 3 }, { project: 'other' }, { q: 'other' }, { status: 0 }, { from: '2026-10-21' }]
      .map(change => ({ ...filters, ...change, cursor: token }))]) {
    await assert.rejects(service.list(input), { code: 'INVALID_QUERY' });
  }
  assert.equal(calls.length, 1);
});

test('cursor enforces expiry, timezone, secret and exact date/ID types without reflecting input', () => {
  const filters = validateFilters({}, now()); const codec = createCursorCodec({ secret, storageTimezone: 'Asia/Bangkok', now });
  const token = codec.encode({ targetDate: '2026-10-22T00:00:00', id: 3 }, filters);
  for (const options of [{ secret: secret + 'changed', now },
    { secret, now: () => new Date('2026-10-22T10:15:00Z') }]) {
    assert.throws(() => createCursorCodec({ storageTimezone: 'Asia/Bangkok', ...options }).decode(token, filters), { code: 'INVALID_QUERY' });
  }
  assert.throws(() => createCursorCodec({ secret, storageTimezone: 'UTC', now }).decode(token, filters), { code: 'INVALID_QUERY' });
  const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
  for (const after of [{ id: 0, targetDate: '2026-10-22T00:00:00' },
    { id: 3, targetDate: '2026-02-30T00:00:00' }, { id: 3, targetDate: 'SQL secret injection' }]) {
    const body = Buffer.from(JSON.stringify({ ...payload, after })).toString('base64url');
    const signed = `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
    assert.throws(() => codec.decode(signed, filters), e => e.code === 'INVALID_QUERY' && !e.message.includes('secret'));
  }
  assert.throws(() => createCursorCodec({ secret: 'short', storageTimezone: 'UTC', now }), { code: 'MONITORING_UNAVAILABLE' });
});

test('service summary stays whole-range and detail retains not-found behavior', async () => {
  const { service, calls } = setup(); const filters = validateFilters({ pageSize: '1' }, now());
  const page = await service.list(filters); const summary = await service.summary(filters);
  assert.equal(summary.total, 4); assert.equal(summary.successRate, null);
  await assert.rejects(async () => service.summary({ ...filters, cursor: page.page.nextCursor }), { code: 'INVALID_QUERY' });
  assert.equal((await service.detail(4)).item.ID, 4); assert.equal(await service.detail(99), null);
  assert.equal(calls.length, 4);
});

test('HTTP factory, service and repository compose with auth before source access', async () => {
  const { service, calls } = setup(); const handlers = createHandlers({ service, enabled: () => true, now });
  async function invoke(operation, roles, query = {}, id = '4') {
    const context = { log: { warn() {} } }; const headers = roles ? {
      'x-ms-client-principal': Buffer.from(JSON.stringify({ userRoles: roles })).toString('base64')
    } : {};
    await handlers[operation](context, { method: 'GET', headers, query, params: { id } });
    return { status: context.res.status, body: JSON.parse(context.res.body) };
  }
  assert.equal((await invoke('list', null)).status, 401);
  assert.equal((await invoke('list', ['authenticated'])).status, 403);
  assert.equal((await invoke('list', ['admin'], { cursor: 'malformed' })).status, 400);
  assert.equal(calls.length, 0);
  const first = await invoke('list', ['admin'], { pageSize: '2' });
  assert.equal(first.status, 200); assert.equal(first.body.items.length, 2);
  const next = await invoke('list', ['admin'], { pageSize: '2', cursor: first.body.page.nextCursor });
  assert.deepEqual(next.body.items.map(r => r.ID), [2, 1]);
  assert.equal((await invoke('detail', ['admin'], {}, '99')).status, 404);
  assert.equal((await invoke('summary', ['admin'])).body.total, 4);
});

test('repository rejects out-of-range and malformed keyset boundaries before querying', async () => {
  let calls = 0;
  const repository = createRepository({ now, developmentEnabled: true, storageTimezone: 'Asia/Bangkok',
    authorizeSource: async () => true, execute: async () => { calls++; return []; } });
  for (const after of [{ id: 3, targetDate: '2026-10-21T00:00:00' },
    { id: 3, targetDate: '2026-10-23T00:00:00' }, { id: '3', targetDate: '2026-10-22T00:00:00' }]) {
    await assert.rejects(repository.list({}, after), { code: 'INVALID_QUERY' });
  }
  assert.equal(calls, 0);
});
