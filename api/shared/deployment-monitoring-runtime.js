const { createExecutor } = require('./deployment-monitoring-executor');
const { createRepository } = require('./deployment-monitoring-sql');
const { createService } = require('./deployment-monitoring-service');
const { randomBytes } = require('node:crypto');

// Composition is deliberately lazy and feature-gated. Importing an endpoint
// must never load the driver or open a SQL connection.
let cached;
function truthy(value) { return value === 'true' || value === '1'; }
function resolveAuthConfig(env = process.env) {
  const mode = env.MONITORING_SQL_AUTH_MODE;
  if (mode !== 'sql' && mode !== 'entra') return null;
  const server = env.MONITORING_SQL_SERVER;
  const database = env.MONITORING_SQL_DATABASE;
  if (!server || !database) return null;
  if (mode === 'sql') {
    if (!env.MONITORING_SQL_USERNAME || !env.MONITORING_SQL_PASSWORD) return null;
    return { authMode: 'sql', server, database, user: env.MONITORING_SQL_USERNAME, password: env.MONITORING_SQL_PASSWORD };
  }
  if (!env.MONITORING_SQL_TENANT_ID || !env.MONITORING_SQL_CLIENT_ID) return null;
  return { authMode: 'entra', server, database,
    authentication: { type: 'azure-active-directory-default', options: {
      tenantId: env.MONITORING_SQL_TENANT_ID, clientId: env.MONITORING_SQL_CLIENT_ID
    } } };
}

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
    getConfig: async () => resolveAuthConfig()
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

module.exports = { createRuntime, resolveAuthConfig };
