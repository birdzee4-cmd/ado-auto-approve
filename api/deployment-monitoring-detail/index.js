const { createHandlers } = require('../shared/deployment-monitoring-http');
const { createRuntime } = require('../shared/deployment-monitoring-runtime');

module.exports = async function (context, req) {
  const runtime = createRuntime();
  return createHandlers(runtime).detail(context, req);
};
