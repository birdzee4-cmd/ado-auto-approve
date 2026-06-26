module.exports = async function (context, req) {
  const auth = require('../shared/auth');
  const delegated = require('../shared/ado-user-token');
  const principal = auth.parseClientPrincipal(req.headers);
  const clearCookie = await delegated.disconnect(req, principal);
  context.res = {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': clearCookie,
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify({ ok: true, connected: false })
  };
};
