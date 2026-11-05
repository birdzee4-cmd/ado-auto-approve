const { test } = require('node:test');
const assert = require('node:assert/strict');
test('live commit endpoint uses caller token, validates input, and returns coverage without reading shared storage', async () => {
  const auth = require('../shared/auth'), delegated = require('../shared/ado-user-token'), ado = require('../shared/ado-client');
  const originals = { auth: auth.requireAnyRole, token: delegated.getValidAccessToken, config: ado.getConfig, builds: ado.listBuilds, release: ado.releaseRequest };
  let tokenCalls = 0;
  try {
    const principal = { userId: 'caller' };
    auth.requireAnyRole = () => ({ ok: true, principal });
    delegated.getValidAccessToken = async (req, received) => { tokenCalls++; assert.equal(received, principal); return { ok: true, accessToken: 'caller-token', setCookie: 'ref=updated' }; };
    ado.getConfig = () => ({ org: 'Buzzebees', project: 'Buzzebees' });
    ado.listBuilds = async options => { assert.equal(options.accessToken, 'caller-token'); return { ok: true, body: { value: [] } }; };
    ado.releaseRequest = async (method,path,body,options) => { assert.equal(options.accessToken, 'caller-token'); return { ok: true, body: { value: [] } }; };
    const handler = require('../ado-pr-build-tracking'); const context = { log: { error() {} } };
    await handler(context, { query: { liveProject: 'oceanlife-web-stg', commit: '<script>' } });
    assert.equal(context.res.status, 400); assert.equal(tokenCalls, 0);
    await handler(context, { query: { liveProject: 'oceanlife-web-stg', commit: '859a8141' } });
    assert.equal(context.res.status, 200); assert.equal(context.res.headers['Set-Cookie'], 'ref=updated');
    assert.equal(context.res.body.versions.matchedCount, 0); assert.equal(context.res.body.versions.runtimeVerified, false);
    assert.equal(context.res.body.history.source, 'azure-devops'); assert.ok(!JSON.stringify(context.res.body).includes('caller-token'));
    delegated.getValidAccessToken = async () => ({ ok: false });
    await handler(context, { query: { liveProject: 'oceanlife-web-stg' } });
    assert.equal(context.res.status, 428);
  } finally {
    auth.requireAnyRole = originals.auth; delegated.getValidAccessToken = originals.token; ado.getConfig = originals.config;
    ado.listBuilds = originals.builds; ado.releaseRequest = originals.release;
  }
});
