const { createExecutor } = require('./deployment-monitoring-executor');
const { createRepository } = require('./deployment-monitoring-sql');
const { createService } = require('./deployment-monitoring-service');
const { randomBytes } = require('node:crypto');

// Composition is deliberately lazy and feature-gated. Importing an endpoint
// must never load the driver or open a SQL connection.
let cached;
function truthy(value) { return value === 'true' || value === '1'; }

function createRuntime() {
  if (cached) return cached;
  const enabled = () => truthy(process.env.MONITORING_SQL_ENABLED);
  const timezone = process.env.MONITORING_SQL_STORAGE_TIMEZONE || 'Asia/Bangkok';
  const configuredSecret = process.env.MONITORING_CURSOR_SECRET || '';
  // A disposable placeholder keeps the feature-off composition constructible;
  // it is never used for an enabled runtime without an explicitly configured
  // secret below.
  const secret = configuredSecret || randomBytes(32).toString('base64url');
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
  const service = createService({ repository, cursorSecret: secret, storageTimezone: timezone });
  cached = {
    enabled,
    service: configuredSecret ? service : {
      async list() { throw Object.assign(new Error('Deployment monitoring is unavailable'), { code: 'MONITORING_UNAVAILABLE' }); },
      async detail() { throw Object.assign(new Error('Deployment monitoring is unavailable'), { code: 'MONITORING_UNAVAILABLE' }); },
      async summary() { throw Object.assign(new Error('Deployment monitoring is unavailable'), { code: 'MONITORING_UNAVAILABLE' }); }
    }
  };
  return cached;
}

module.exports = { createRuntime };
