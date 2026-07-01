module.exports = async function (context, req) {
  const internalAuth = require('../shared/appservice-internal-auth');
  if (!internalAuth.requireProxySecret(context, req)) return;

  const handlers = require('../shared/appservice-portal-handlers');
  await handlers.handleList(context, req);
};
