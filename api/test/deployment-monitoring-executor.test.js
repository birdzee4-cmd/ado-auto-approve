const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createExecutor } = require('../shared/deployment-monitoring-executor');
const permissions = { expectedDatabase: 1, canSelect: 1, canInsert: 0, canUpdate: 0,
  canDelete: 0, canAlter: 0, objectControl: 0, databaseControl: 0, isOwner: 0, isWriter: 0, isAdmin: 0 };
const query = { text: 'SELECT [ID] FROM dbo.Internal_ProjectPlanning WHERE [ID] = @id',
  parameters: [{ name: 'id', type: 'Int', value: 7 }] };
function fake(options = {}) {
  const pools = []; const requests = []; let loads = 0; let configs = 0;
  class Pool extends EventEmitter {
    constructor(config) { super(); this.config = config; this.closes = 0; pools.push(this); }
    async connect() { if (options.connect) await options.connect(this); return this; }
    async close() { this.closes++; }
  }
  class Request {
    constructor(pool, overrides) { this.pool = pool; this.overrides = overrides; this.inputs = []; this.cancelled = 0; requests.push(this); }
    input(...args) { this.inputs.push(args); return this; }
    async query(text) {
      this.text = text;
      if (text.includes('HAS_PERMS_BY_NAME')) return { recordset: [options.permissions || permissions] };
      return options.query ? options.query(this) : { recordset: [{ ID: 7 }] };
    }
    cancel() { this.cancelled++; }
  }
  const driver = { ConnectionPool: Pool, Request, Int: 'INT', DateTime: 'DATETIME', NVarChar: n => `NVARCHAR(${n})` };
  const executor = createExecutor({ enabled: () => true, authorizeConnection: async () => true,
    getConfig: async () => { configs++; return { server: 'synthetic.invalid', database: 'synthetic', user: 'fake', password: 'fake',
      options: { encrypt: false, trustServerCertificate: true }, pool: { max: 100 } }; },
    loadDriver: () => { loads++; return driver; }, ...options.factory });
  return { executor, pools, requests, get loads() { return loads; }, get configs() { return configs; } };
}

test('executor is lazy and fails closed before config or driver access without approval', async () => {
  for (const factory of [{ enabled: () => false }, { authorizeConnection: undefined },
    { authorizeConnection: async () => false }, { authorizeConnection: async () => 'true' }]) {
    const f = fake({ factory }); assert.equal(f.loads, 0);
    await assert.rejects(f.executor.execute(query), { code: 'MONITORING_UNAVAILABLE' });
    assert.equal(f.loads, 0); assert.equal(f.configs, 0);
  }
});

test('concurrent reads share one pool and permission probe, with fixed TLS/UTC/budgets', async () => {
  const f = fake(); const results = await Promise.all(Array.from({ length: 8 }, () => f.executor.execute(query)));
  assert.equal(results.length, 8); assert.equal(f.pools.length, 1);
  assert.equal(f.requests.filter(r => r.text.includes('HAS_PERMS_BY_NAME')).length, 1);
  assert.deepEqual(f.pools[0].config.options, { encrypt: true, trustServerCertificate: false, useUTC: true,
    readOnlyIntent: true, appName: 'DeploymentMonitoringReadOnly' });
  assert.equal(f.pools[0].config.pool.max, 5); assert.equal(f.pools[0].config.pool.min, 0);
  assert.equal(f.pools[0].config.connectionTimeout, 5000);
  assert.deepEqual(f.requests.at(-1).inputs, [['id', 'INT', 7]]);
  assert.equal(f.requests.at(-1).overrides.requestTimeout, 10000);
  await f.executor.close(); assert.equal(f.pools[0].closes, 1);
});

test('permission failure/unknown flag/wrong database prevent source reads and close pool', async () => {
  for (const override of [{ canSelect: 0 }, { canInsert: 1 }, { isOwner: 1 }, { isAdmin: null }, { expectedDatabase: 0 }]) {
    const f = fake({ permissions: { ...permissions, ...override } });
    await assert.rejects(f.executor.execute(query), { code: 'MONITORING_UNAVAILABLE' });
    assert.equal(f.requests.length, 1); assert.equal(f.pools[0].closes, 1);
  }
});

test('failed connect is redacted and a later independent request can reconnect', async () => {
  let attempts = 0;
  const f = fake({ connect: async () => { if (++attempts === 1) throw Object.assign(new Error('password secret'), { code: 'ELOGIN' }); } });
  await assert.rejects(f.executor.execute(query), e => e.code === 'MONITORING_UNAVAILABLE' && !e.message.includes('secret'));
  assert.equal(attempts, 1); // no automatic retry
  assert.deepEqual(await f.executor.execute(query), [{ ID: 7 }]);
  assert.equal(attempts, 2); assert.equal(f.pools[0].closes, 1); await f.executor.close();
});

test('pool errors are handled and invalidate only that pool for later reads', async () => {
  const f = fake(); await f.executor.execute(query);
  f.pools[0].emit('error', new Error('SQL secret'));
  await f.executor.execute(query);
  assert.equal(f.pools.length, 2); assert.equal(f.pools[0].closes, 1); await f.executor.close();
});

test('typed bindings include Unicode and wall-clock DateTime, malformed bindings fail safely', async () => {
  const f = fake(); const date = new Date('2026-10-22T00:00:00Z');
  await f.executor.execute({ ...query, parameters: [
    { name: 'text', type: 'NVarChar', length: 100, value: "ไทย'; --" },
    { name: 'from', type: 'DateTime', value: date }
  ] });
  assert.deepEqual(f.requests.at(-1).inputs, [['text', 'NVARCHAR(100)', "ไทย'; --"], ['from', 'DATETIME', date]]);
  for (const p of [{ name: 'id', type: 'Int', value: '1 OR 1=1' }, { name: 'x;', type: 'Int', value: 1 },
    { name: 'x', type: 'VarChar', value: 'x' }, { name: 'x', type: 'NVarChar', length: 1, value: 'long' }]) {
    await assert.rejects(f.executor.execute({ ...query, parameters: [p] }), { code: 'MONITORING_UNAVAILABLE' });
  }
  assert.equal(f.requests.length, 2); await f.executor.close();
});

test('abort cancels pending request, pre-abort never connects, deadline cancels and becomes timeout', async () => {
  const controller = new AbortController(); controller.abort(); const pre = fake();
  await assert.rejects(pre.executor.execute({ ...query, signal: controller.signal }), { code: 'MONITORING_UNAVAILABLE' });
  assert.equal(pre.pools.length, 0);
  let started; const ready = new Promise(resolve => { started = resolve; });
  const f = fake({ query: () => { started(); return new Promise(() => {}); } });
  const active = new AbortController();
  const read = f.executor.execute({ ...query, signal: active.signal });
  const rejected = assert.rejects(read, { code: 'MONITORING_UNAVAILABLE' });
  await ready; active.abort(); await rejected; assert.equal(f.requests.at(-1).cancelled, 1); await f.executor.close();
  const timeout = fake({ query: () => new Promise(() => {}) });
  await assert.rejects(timeout.executor.execute({ ...query, timeoutMs: 10 }), { code: 'MONITORING_TIMEOUT' });
  assert.equal(timeout.requests.at(-1).cancelled, 1); await timeout.executor.close();
});

test('shutdown during connect waits for connection then closes without querying metadata or data', async () => {
  let release; let started; const start = new Promise(resolve => { started = resolve; });
  const f = fake({ connect: () => { started(); return new Promise(resolve => { release = resolve; }); } });
  const read = f.executor.execute(query); const rejected = assert.rejects(read, { code: 'MONITORING_UNAVAILABLE' });
  await start; const closed = f.executor.close(); release(); await Promise.all([rejected, closed]);
  assert.equal(f.pools[0].closes, 1); assert.equal(f.requests.length, 0);
  await assert.rejects(f.executor.execute(query), { code: 'MONITORING_UNAVAILABLE' });
});

test('installed pinned driver can construct a request and typed inputs without connecting', async () => {
  const driver = require('mssql');
  assert.equal(require('mssql/package.json').version, '12.7.10');
  const pool = new driver.ConnectionPool({ server: 'synthetic.invalid', database: 'synthetic',
    options: { encrypt: true, trustServerCertificate: false, useUTC: true } });
  const request = new driver.Request(pool, { requestTimeout: 10000 });
  request.input('id', driver.Int, 7).input('project', driver.NVarChar(100), 'Synthetic');
  assert.equal(request.parameters.id.value, 7); assert.equal(request.overrides.requestTimeout, 10000);
  assert.equal(pool.connected, false); await pool.close();
});

test('diagnostics identify fixed failure stage and allowlisted cause codes without error text or secrets', async () => {
  const events = [];
  const failure = Object.assign(new Error('secret server password token'), { code: 'ESOCKET', number: 18456, state: 5,
    originalError: Object.assign(new Error('private TLS hostname'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID', class: 14 }) });
  const f = fake({ connect: async () => { throw failure; }, factory: { onDiagnostic: event => events.push(event) } });
  await assert.rejects(f.executor.execute(query), { code: 'MONITORING_UNAVAILABLE' });
  assert.deepEqual(events, [{ stage: 'CONNECT_FAILED', codes: ['ESOCKET', 'ERR_TLS_CERT_ALTNAME_INVALID'], sql: { number: 18456, state: 5, class: 14 } }]);
  assert.doesNotMatch(JSON.stringify(events), /secret|password|token|hostname/);
  const deniedEvents = [];
  const denied = fake({ permissions: { ...permissions, canUpdate: 1 }, factory: { onDiagnostic: event => deniedEvents.push(event) } });
  await assert.rejects(denied.executor.execute(query), { code: 'MONITORING_UNAVAILABLE' });
  assert.deepEqual(deniedEvents.map(e => e.stage), ['CONNECT_COMPLETE', 'PERMISSION_CHECK_FAILED']);
  assert.equal(denied.requests.length, 1);
  const ignored = fake({ factory: { onDiagnostic: () => { throw new Error('observer failed'); } } });
  assert.deepEqual(await ignored.executor.execute(query), [{ ID: 7 }]); await ignored.executor.close();
});
