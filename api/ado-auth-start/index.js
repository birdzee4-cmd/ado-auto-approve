module.exports = async function (context, req) {
  try {
    const auth = require('../shared/auth');
    const principal = auth.parseClientPrincipal(req.headers);
    if (!principal) {
      context.res = {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        body: { ok: false, error: 'Authentication required' }
      };
      return;
    }

    const delegated = require('../shared/ado-user-token');
    const redirect = delegated.buildStartRedirect(req, principal);
    context.res = {
      status: 302,
      headers: {
        Location: redirect.location,
        'Set-Cookie': redirect.setCookie,
        'Cache-Control': 'no-store'
      }
    };
  } catch (err) {
    context.log.error('ADO auth start failed:', err);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: false, error: 'Failed to start Azure DevOps connection', detail: err.message }
    };
  }
};
