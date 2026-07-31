const auth = require('./auth');

function authorize(context, req, adminOnly) {
  return auth.requireAnyRole(context, req, adminOnly ? ['admin'] : ['it_support_approve', 'admin']);
}

function userOf(result) {
  return auth.getUserEmail(result && result.principal);
}

function json(context, status, body, headers) {
  context.res = {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {}),
    body: typeof body === 'string' ? body : JSON.stringify(body)
  };
}

function fail(context, error) {
  const status = Number(error && error.statusCode) || 500;
  if (context && context.log && context.log.error) context.log.error(error);
  json(context, status, {
    ok: false,
    error: status >= 500 ? 'Deployment service failed' : error.message,
    detail: status >= 500 ? error.message : undefined
  });
}

module.exports = { authorize, userOf, json, fail };
