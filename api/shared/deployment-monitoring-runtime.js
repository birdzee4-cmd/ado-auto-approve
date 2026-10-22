const { createExecutor } = require('./deployment-monitoring-executor');
const { createRepository } = require('./deployment-monitoring-sql');
const { createService } = require('./deployment-monitoring-service');

// Composition is deliberately lazy and feature-gated. Importing an endpoint
// must never load the driver or open a SQL connection.
let cached;
function truthy(value) { return value === 'true' || value === '1'; }

function createRuntime() {
  if (cached) return cached;
  const enabled = () => truthy(process.env.MONITORING_SQL_ENABLED);
  const timezone = process.env.MONITORING_SQL_STORAGE_TIMEZONE || 'Asia/Bangkok';
  const secret = process.env.MONITORING_CURSOR_SECRET || '';
  const executor = createExecutor({
    enabled,
    authorizeConnection: () => truthy(process.env.MONITORING_SQL_CONNECTION_APPROVED),
    getConfig: async () => {
      const server = process.env.MONITORING_SQL_SERVER;
      const database = process.env.MONITORING_SQL_DATABASE;
      const tenantId = process.env.MONITORING_SQL_TENANT_ID;
      const clientId = process.env.MONITORING_SQL_CLIENT_ID;
      if (!server || !database || !tenantId || !clientId) return null;
      return {
        server, database,
        authentication: { type: 'azure-active-directory-default', options: { tenantId, clientId } }
      };
    }
  });
  const repository = createRepository({
    enabled,
    developmentEnabled: enabled,
    authorizeSource: () => truthy(process.env.MONITORING_SQL_CONNECTION_APPROVED),
    storageTimezone: timezone,
    execute: (sql, params) => executor.execute(sql, params)
  });
  cached = { enabled, service: createService({ repository, cursorSecret: secret, storageTimezone: timezone }) };
  return cached;
}

module.exports = { createRuntime };
