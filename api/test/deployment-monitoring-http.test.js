const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandlers } = require('../shared/deployment-monitoring-http');

function request(roles = ['it_support_approve'], overrides = {}) {
  return {
    method: 'GET', query: {}, params: { id: '17' },
    headers: { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userRoles: roles })).toString('base64') },
    ...overrides
  };
}

async function invoke(handler, req) {
  const logs = [];
  const log = Object.assign((...args) => logs.push(args), {
    warn: (...args) => logs.push(args), error: (...args) => logs.push(args)
  });
  const context = { log };
  await handler(context, req);
  const body = JSON.parse(context.res.body);
  assert.equal(context.res.headers['Cache-Control'], 'private, no-store');
  assert.match(context.res.headers['Content-Type'], /^application\/json/);
  assert.equal(context.res.headers['X-Request-ID'], body.requestId);
  assert.match(body.requestId, /^[0-9a-f-]{36}$/);
  return { ...context.res, body, logs };
}

test('all monitoring operations authorize before feature configuration or service access', async () => {
  let touched = 0;
  const handlers = createHandlers({
    enabled() { touched++; throw new Error('must not access configuration'); },
    service: new Proxy({}, { get() { touched++; throw new Error('must not access service'); } })
  });
  for (const operation of ['list', 'detail', 'summary']) {
    for (const headers of [{}, { 'x-ms-client-principal': 'not base64 json' }]) {
      const result = await invoke(handlers[operation], request([], { headers }));
      assert.equal(result.status, 401);
      assert.equal(result.body.error.code, 'AUTH_REQUIRED');
    }
    const forbidden = await invoke(handlers[operation], request(['authenticated']));
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.error.code, 'FORBIDDEN');
  }
  assert.equal(touched, 0);
});

test('monitoring is disabled by default, including when a service is supplied', async () => {
  let calls = 0;
  const handlers = createHandlers({ service: { list() { calls++; } } });
  const result = await invoke(handlers.list, request());
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, 'MONITORING_DISABLED');
  assert.equal(calls, 0);
  for (const flag of ['true', 'false', 1, null]) {
    const result = await invoke(createHandlers({ enabled: () => flag }).list, request());
    assert.equal(result.body.error.code, 'MONITORING_DISABLED');
  }
});

test('monitoring rejects write/unsupported methods before configuration and service', async () => {
  const handlers = createHandlers({ enabled() { throw new Error('configuration accessed'); } });
  for (const operation of ['list', 'detail', 'summary']) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      const result = await invoke(handlers[operation], request(['admin'], { method }));
      assert.equal(result.status, 405);
      assert.equal(result.headers.Allow, 'GET');
    }
  }
});

test('invalid query/ID never reaches the service and never reflects supplied text', async () => {
  let calls = 0;
  const service = Object.fromEntries(['list', 'detail', 'summary'].map(key => [key, () => { calls++; }]));
  const handlers = createHandlers({ service, enabled: () => true });
  for (const [operation, overrides] of [
    ['list', { query: { q: 'sensitive-input'.repeat(20) } }],
    ['summary', { query: { status: 'sensitive-input' } }],
    ['detail', { params: { id: 'sensitive-input' } }],
    ['detail', { query: { extra: 'sensitive-input' } }]
  ]) {
    const result = await invoke(handlers[operation], request(undefined, overrides));
    assert.equal(result.status, 400);
    assert.equal(JSON.stringify(result).includes('sensitive-input'), false);
  }
  assert.equal(calls, 0);
});

test('authorized roles reach fake list/detail/summary with validated inputs', async () => {
  const inputs = [];
  const handlers = createHandlers({
    enabled: () => true, now: () => new Date('2026-10-21T17:00:00Z'),
    service: {
      async list(input) { inputs.push(input); return { items: [], page: { nextCursor: null } }; },
      async detail(input) { inputs.push(input); return { item: { ID: input, ProjectName: 'Synthetic only' } }; },
      async summary(input) { inputs.push(input); return { total: 0, unknown: 0 }; }
    }
  });
  assert.equal((await invoke(handlers.list, request())).status, 200);
  assert.equal((await invoke(handlers.detail, request(['admin']))).body.item.ID, 17);
  assert.equal((await invoke(handlers.summary, request())).body.total, 0);
  assert.equal(inputs[0].from, '2026-10-22');
  assert.equal(inputs[1], 17);
  assert.deepEqual(inputs[0], inputs[2]);
});

test('missing detail is 404 while missing service is 503, never a successful empty dataset', async () => {
  const handlers = createHandlers({ enabled: () => true, service: { detail: async () => null } });
  assert.equal((await invoke(handlers.detail, request())).status, 404);
  assert.equal((await invoke(handlers.list, request())).body.error.code, 'MONITORING_UNAVAILABLE');
});

test('SQL/configuration exceptions are redacted from responses and logs', async () => {
  for (const [code, expectedStatus] of [
    ['MONITORING_TIMEOUT', 504], ['MONITORING_UNAVAILABLE', 503],
    ['ETIMEOUT', 500], ['INVALID_QUERY', 500], ['ELOGIN', 500]
  ]) {
    const handlers = createHandlers({ enabled: () => true, service: {
      async list() { throw Object.assign(new Error('SELECT secret FROM private_server password=do-not-expose'), { code }); }
    } });
    const result = await invoke(handlers.list, request());
    assert.equal(result.status, expectedStatus);
    assert.doesNotMatch(JSON.stringify(result), /SELECT|secret|private_server|password|do-not-expose/);
    assert.equal(result.logs.length, 0);
  }
  const result = await invoke(createHandlers({ enabled() { throw new Error('password=do-not-expose'); } }).list, request());
  assert.equal(result.status, 500);
  assert.doesNotMatch(JSON.stringify(result), /password|do-not-expose/);
});

test('server assigns request IDs instead of trusting request headers', async () => {
  const req = request();
  req.headers['x-request-id'] = 'untrusted secret';
  const handler = createHandlers().list;
  const first = await invoke(handler, req);
  const second = await invoke(handler, req);
  assert.notEqual(first.body.requestId, second.body.requestId);
  assert.doesNotMatch(JSON.stringify(first), /untrusted secret/);
});
