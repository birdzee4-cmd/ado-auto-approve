module.exports = async function (context, req) {
  try {
    const auth = require('../shared/auth');
    const delegated = require('../shared/ado-user-token');
    const principal = auth.parseClientPrincipal(req.headers);
    if (!principal) {
      context.res = {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        body: { ok: false, error: 'Authentication required' }
      };
      return;
    }

    const code = req.query && req.query.code;
    const state = req.query && req.query.state;
    const error = req.query && req.query.error;
    if (error) {
      context.res = {
        status: 302,
        headers: { Location: '/dashboard.html?adoConnected=0&adoError=' + encodeURIComponent(error) }
      };
      return;
    }
    if (!code || !state) {
      context.res = {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { ok: false, error: 'Missing OAuth code or state' }
      };
      return;
    }

    const statePayload = delegated.readState(req, state);
    if (!statePayload) {
      context.res = {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { ok: false, error: 'Invalid or expired OAuth state' }
      };
      return;
    }
    if (statePayload.userId && principal.userId && statePayload.userId !== principal.userId) {
      context.res = {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { ok: false, error: 'OAuth state belongs to another user' }
      };
      return;
    }

    const tokenResult = await delegated.exchangeCode(req, code);
    if (!tokenResult.ok || !tokenResult.body || !tokenResult.body.access_token) {
      context.res = {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
        body: {
          ok: false,
          error: 'Failed to exchange Azure DevOps token',
          detail: 'HTTP ' + tokenResult.status
        }
      };
      return;
    }

    const record = delegated.buildTokenRecord(tokenResult.body, principal);
    const tokenCookie = await delegated.createTokenCookie(record, principal);
    const returnLocation = appendQuery(statePayload.returnTo || '/dashboard.html', 'adoConnected=1');
    context.res = {
      status: 302,
      headers: {
        Location: returnLocation,
        'Set-Cookie': [
          tokenCookie,
          delegated.clearCookie(delegated.STATE_COOKIE)
        ],
        'Cache-Control': 'no-store'
      }
    };
  } catch (err) {
    context.log.error('ADO auth callback failed:', err);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: false, error: 'Azure DevOps connection failed', detail: err.message }
    };
  }
};

function appendQuery(url, query) {
  return String(url || '/dashboard.html') + (String(url || '').includes('?') ? '&' : '?') + query;
}
