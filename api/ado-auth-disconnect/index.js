module.exports = async function (context, req) {
  const delegated = require('../shared/ado-user-token');
  context.res = {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': delegated.clearCookie(delegated.TOKEN_COOKIE),
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify({ ok: true, connected: false })
  };
};
