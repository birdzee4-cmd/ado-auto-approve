const test = require('node:test');
const assert = require('node:assert/strict');

const controllerModule = import('../../docs/prototypes/deployment-monitoring-controller.mjs');
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const filters = { from: '2026-10-22', to: '2026-10-22' };
function sample(items = [{ ID: 17, ProjectName: 'Synthetic only' }]) {
  return { ok: true, items, fetchedAt: '2026-10-22T02:00:00Z' };
}

test('UI prototype distinguishes initial loading, successful rows and empty data', async () => {
  const { createMonitoringController } = await controllerModule;
  const phases = [];
  let response = sample();
  const controller = createMonitoringController({ load: async () => response, render: state => phases.push(state.phase) });
  await controller.refresh(filters);
  assert.deepEqual(phases, ['loading', 'ready']);
  assert.equal(controller.getState().data.fetchedAt, response.fetchedAt);
  response = sample([]);
  await controller.refresh(filters);
  assert.equal(controller.getState().phase, 'empty');
  assert.deepEqual(controller.getState().data.items, []);
});

test('failed refresh keeps prior rows and their fetchedAt as stale, never false zero', async () => {
  const { createMonitoringController } = await controllerModule;
  let fail = false;
  const controller = createMonitoringController({
    async load() { if (fail) throw new Error('SQL sensitive detail'); return sample(); }, render() {}
  });
  await controller.refresh(filters);
  fail = true;
  await controller.refresh(filters);
  const state = controller.getState();
  assert.equal(state.phase, 'stale');
  assert.equal(state.data.items.length, 1);
  assert.equal(state.data.fetchedAt, sample().fetchedAt);
  assert.doesNotMatch(JSON.stringify(state), /SQL sensitive detail/);
  await controller.refresh({ ...filters, project: 'another' });
  assert.equal(controller.getState().phase, 'error');
  assert.equal(controller.getState().data, null);
});

test('old responses cannot replace a newer filter, even if the loader ignores abort', async () => {
  const { createMonitoringController } = await controllerModule;
  const calls = [];
  const controller = createMonitoringController({ load(selected, { signal }) {
    const call = { ...deferred(), selected, signal }; calls.push(call); return call.promise;
  }, render() {} });
  const first = controller.refresh(filters);
  const second = controller.refresh({ ...filters, project: 'new' });
  assert.equal(calls[0].signal.aborted, true);
  calls[1].resolve(sample([{ ID: 18 }]));
  await second;
  calls[0].resolve(sample());
  await first;
  assert.equal(controller.getState().data.items[0].ID, 18);
  assert.equal(controller.getState().filters.project, 'new');
});

test('auth failures discard prior protected rows; initial 503 and HTML-shaped responses stay errors', async () => {
  const { createMonitoringController } = await controllerModule;
  let response = sample();
  const controller = createMonitoringController({ async load() {
    if (response instanceof Error) throw response;
    return response;
  }, render() {} });
  for (const [status, phase] of [[401, 'unauthorized'], [403, 'forbidden']]) {
    response = sample();
    await controller.refresh(filters);
    response = Object.assign(new Error('private details'), { status });
    await controller.refresh(filters);
    assert.equal(controller.getState().phase, phase);
    assert.equal(controller.getState().data, null);
  }
  response = Object.assign(new Error('unavailable'), { status: 503 });
  await controller.refresh(filters);
  assert.equal(controller.getState().phase, 'error');
  assert.equal(controller.getState().errorCode, 'UNAVAILABLE');
  response = Object.assign(new Error('disabled'), { status: 503, code: 'MONITORING_DISABLED' });
  await controller.refresh(filters);
  assert.equal(controller.getState().phase, 'disabled');
  response = '<html>login</html>';
  await controller.refresh(filters);
  assert.equal(controller.getState().phase, 'error');
  assert.equal(controller.getState().data, null);
});

test('disposing aborts in-flight requests and prevents subsequent rendering or loading', async () => {
  const { createMonitoringController } = await controllerModule;
  const pending = deferred();
  let signal, loads = 0, renders = 0;
  const controller = createMonitoringController({ load(_filters, options) {
    loads++; signal = options.signal; return pending.promise;
  }, render() { renders++; } });
  const running = controller.refresh(filters);
  controller.dispose();
  assert.equal(signal.aborted, true);
  pending.resolve(sample());
  await running;
  await controller.refresh(filters);
  assert.equal(loads, 1);
  assert.equal(renders, 1);
  assert.equal(controller.getState().data, null);
});

test('invalid or offset-less fetchedAt never replaces the last successful dataset', async () => {
  const { createMonitoringController } = await controllerModule;
  let response = sample();
  const controller = createMonitoringController({ load: async () => response, render() {} });
  await controller.refresh(filters);
  for (const fetchedAt of ['', 'not-a-date', '2026-10-22T12:00:00', '2026-13-99T12:00:00Z']) {
    response = { ...sample([{ ID: 999 }]), fetchedAt };
    await controller.refresh(filters);
    assert.equal(controller.getState().phase, 'stale');
    assert.equal(controller.getState().data.items[0].ID, 17);
    assert.equal(controller.getState().data.fetchedAt, sample().fetchedAt);
  }
});
