module.exports = async function (context, req) {
  const handlers = require('../shared/appservice-portal-handlers');
  const roleCheck = handlers.requirePortalRole(context, req);
  if (!roleCheck.ok) {
    handlers.jsonResponse(context, roleCheck.status, roleCheck.body);
    return;
  }

  const proxy = require('../shared/appservice-proxy-client');
  if (proxy.isConfigured() && await proxy.forward(context, req, 'appservice-settings')) return;

  await handlers.handleSettings(context, req);
};
