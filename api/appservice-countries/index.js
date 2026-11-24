module.exports = async function (context, req) {
  const handlers = require('../shared/appservice-portal-handlers');
  const roleCheck = handlers.requirePortalRole(context, req);
  if (!roleCheck.ok) return handlers.jsonResponse(context, roleCheck.status, roleCheck.body);
  const client = require('../shared/appservice-client');
  handlers.jsonResponse(context, 200, { ok: true, countries: client.getCountries() });
};
