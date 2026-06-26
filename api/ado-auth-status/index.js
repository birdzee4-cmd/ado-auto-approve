module.exports = async function (context, req) {
  function jsonResponse(status, payload, setCookie) {
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    };
    if (setCookie) headers['Set-Cookie'] = setCookie;
    context.res = { status, headers, body: JSON.stringify(payload) };
  }

  try {
    const auth = require('../shared/auth');
    const principal = auth.parseClientPrincipal(req.headers);
    if (!principal) {
      jsonResponse(401, { ok: false, connected: false, error: 'Authentication required' });
      return;
    }

    const delegated = require('../shared/ado-user-token');
    const token = await delegated.getValidAccessToken(req, principal);
    if (!token.ok) {
      jsonResponse(200, {
        ok: true,
        connected: false,
        reason: token.error || 'Not connected'
      });
      return;
    }

    jsonResponse(200, {
      ok: true,
      connected: true,
      user: token.record.userDetails || principal.userDetails || '',
      connectedAt: token.record.connectedAt || '',
      expiresAt: token.record.expiresAt ? new Date(token.record.expiresAt).toISOString() : '',
      tokenSource: token.tokenSource || 'unknown'
    }, token.setCookie);
  } catch (err) {
    context.log.error('ADO auth status failed:', err);
    jsonResponse(500, { ok: false, connected: false, error: 'Failed to read Azure DevOps connection', detail: err.message });
  }
};
