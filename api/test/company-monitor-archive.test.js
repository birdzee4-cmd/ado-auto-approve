const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, validDay, today } = require('../shared/company-monitor-archive');
function memoryTable() {
  const entities = new Map(); let version = 0;
  const key = row => row.partitionKey + '/' + row.rowKey;
  const error = statusCode => Object.assign(new Error(String(statusCode)), { statusCode });
  const table = {
    entities, failChunk: false,
    async createTable() {},
    async getEntity(partitionKey, rowKey) { const row = entities.get(key({ partitionKey, rowKey })); if (!row) throw error(404); return { ...row }; },
    async createEntity(row) { if (entities.has(key(row))) throw error(409); return table.upsertEntity(row); },
    async updateEntity(row, mode, options) { if (entities.get(key(row))?.etag !== options.etag) throw error(412); return table.upsertEntity(row); },
    async upsertEntity(row) { if (table.failChunk && row.rowKey.startsWith('chunk-')) throw error(503); entities.set(key(row), { ...row, etag: String(++version) }); }
  };
  return table;
}
const source = changes => ({ BuildId: '100_M', CiName: 'example', Status: 'Building', Branch: 'staging', LastUpdate: '05/11/2026 23:55:00', TotalTime: '00:01:00.1234567', extraSourceField: { retained: true }, ...changes });
test('calendar validation and Bangkok midnight are correct', () => {
  assert.equal(validDay('2026-02-30'), false); assert.equal(validDay('2026-13-01'), false);
  assert.equal(validDay("2026-01-01'"), false); assert.equal(validDay('2028-02-29'), true);
  assert.equal(today(new Date('2026-11-05T17:00:00Z')), '2026-11-06');
});
test('keeps raw fields, module/plugin identities, unchanged snapshots and all observed revisions', async () => {
  const table = memoryTable(), store = createStore(table);
  const first = await store.collect([source(), source({ BuildId: '100_P' })], '2026-11-05T16:56:00Z');
  const initialId = first.days[0].snapshotId;
  const second = await store.collect([source(), source({ BuildId: '100_P' })], '2026-11-05T16:57:00Z');
  assert.equal(second.days[0].snapshotId, initialId);
  await store.collect([source({ Status: 'Build fail', LastUpdate: '05/11/2026 23:58:00' })], '2026-11-05T16:58:00Z');
  const history = await store.read('2026-11-05');
  assert.equal(history.items.length, 2); // Missing upstream rows are retained.
  assert.equal(history.items.find(item => item.id === '100_M').status, 'build fail');
  assert.equal(history.items.find(item => item.id === '100_M').firstObservedAt, first.observedAt);
  const old = await store.readSnapshot(initialId);
  assert.equal(old.records[0].item.status, 'building');
  assert.equal(old.records[0].raw.TotalTime, '00:01:00.1234567');
  assert.deepEqual(old.records[0].raw.extraSourceField, { retained: true });
  assert.equal([...table.entities.values()].filter(row => row.partitionKey.startsWith('polls-')).length, 3);
});
test('days remain isolated across midnight and unavailable history is explicit', async () => {
  const store = createStore(memoryTable());
  await store.collect([source()], '2026-11-05T16:59:00Z');
  await store.collect([source({ Status: 'Complete', LastUpdate: '06/11/2026 00:01:00' })], '2026-11-05T17:01:00Z');
  assert.equal((await store.read('2026-11-05')).items[0].status, 'building');
  assert.equal((await store.read('2026-11-06')).items[0].status, 'complete');
  assert.equal((await store.read('2026-11-04')).archive.snapshotId, '');
});
test('failed upstream and partial storage writes preserve the last published snapshot', async () => {
  const table = memoryTable(), store = createStore(table);
  const initial = await store.collect([source()], '2026-11-05T16:00:00Z');
  await assert.rejects(store.collect(async () => { throw new Error('upstream down'); }, '2026-11-05T16:01:00Z'));
  assert.equal((await store.read('2026-11-05')).archive.lastAttemptStatus, 'failed');
  table.failChunk = true;
  await assert.rejects(store.collect([source({ Status: 'Complete' })], '2026-11-05T16:02:00Z'));
  assert.equal((await store.read('2026-11-05')).archive.snapshotId, initial.days[0].snapshotId);
});
test('rejects invalid timestamps and duplicate identities before publishing', async () => {
  const store = createStore(memoryTable());
  await assert.rejects(store.collect([source({ LastUpdate: '31/02/2026 10:00:00' })]));
  await assert.rejects(store.collect([source(), source()]));
  assert.equal((await store.read('2026-11-05')).items.length, 0);
});
test('collector fails closed without a valid secret; read endpoint validates calendar dates', async () => {
  const collect = require('../company-monitor-collect');
  const context = { log: { warn() {}, error() {} } };
  await collect(context, { headers: {} }); assert.equal(context.res.status, 401);
  const handler = require('../company-deployment-monitor');
  const principal = Buffer.from(JSON.stringify({ userRoles: ['admin'] })).toString('base64');
  await handler(context, { headers: { 'x-ms-client-principal': principal }, query: { date: '2026-13-01' } });
  assert.equal(context.res.status, 400);
});
