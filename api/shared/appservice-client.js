const DEFAULT_SUBSCRIPTION_ID = 'f9bca0f4-1e5b-487f-a2ef-a6578a936ef1';
const DEFAULT_RESOURCE_GROUP = 'Default-STG-TH-ServicesBackEnd-All-Group';
const DEFAULT_NAME_PREFIX = 'stg-';

let cachedClient = null;
let cachedApps = null;
let cachedAppsAt = 0;
const restartCooldowns = new Map();

function getConfig() {
  const subscriptionId = process.env.APP_SERVICE_SUBSCRIPTION_ID || DEFAULT_SUBSCRIPTION_ID;
  const resourceGroup = process.env.APP_SERVICE_RESOURCE_GROUP || DEFAULT_RESOURCE_GROUP;
  const namePrefix = process.env.APP_SERVICE_NAME_PREFIX || DEFAULT_NAME_PREFIX;
  const tenantId = process.env.AZURE_TENANT_ID || '36f04887-ce29-484c-900e-f23ad3f60b77';
  const cacheTtlMs = Math.max(5000, Number(process.env.APP_SERVICE_CACHE_TTL_SECONDS || 60) * 1000);
  const restartCooldownMs = Math.max(0, Number(process.env.APP_SERVICE_RESTART_COOLDOWN_SECONDS || 300) * 1000);
  if (!subscriptionId) throw new Error('Missing APP_SERVICE_SUBSCRIPTION_ID');
  if (!resourceGroup) throw new Error('Missing APP_SERVICE_RESOURCE_GROUP');
  return {
    subscriptionId,
    resourceGroup,
    namePrefix,
    tenantId,
    cacheTtlMs,
    restartCooldownMs
  };
}

function createPublicError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.expose = true;
  return err;
}

function getClient() {
  if (cachedClient) return cachedClient;
  const { DefaultAzureCredential } = require('@azure/identity');
  const { WebSiteManagementClient } = require('@azure/arm-appservice');
  const cfg = getConfig();
  const credential = new DefaultAzureCredential({ tenantId: cfg.tenantId });
  cachedClient = new WebSiteManagementClient(credential, cfg.subscriptionId);
  return cachedClient;
}

async function listAllowedAppServices(forceRefresh) {
  const cfg = getConfig();
  const now = Date.now();
  if (!forceRefresh && cachedApps && now - cachedAppsAt < cfg.cacheTtlMs) {
    return cachedApps;
  }

  const client = getClient();
  const apps = [];
  for await (const app of client.webApps.listByResourceGroup(cfg.resourceGroup)) {
    const row = mapApp(app, cfg.resourceGroup);
    if (isAllowedAppName(row.name, cfg.namePrefix)) apps.push(row);
  }
  apps.sort((a, b) => a.name.localeCompare(b.name));
  cachedApps = apps;
  cachedAppsAt = now;
  return apps;
}

async function getAllowedApp(name) {
  const target = normalizeName(name);
  if (!target) {
    throw createPublicError(400, 'Missing app service name');
  }

  const cfg = getConfig();
  if (!isAllowedAppName(target, cfg.namePrefix)) {
    throw createPublicError(403, 'App Service is outside the allowed staging scope');
  }

  const apps = await listAllowedAppServices(false);
  const found = apps.find(app => app.name.toLowerCase() === target.toLowerCase());
  if (found) return found;

  const refreshed = await listAllowedAppServices(true);
  const fresh = refreshed.find(app => app.name.toLowerCase() === target.toLowerCase());
  if (fresh) return fresh;

  throw createPublicError(404, 'App Service not found in allowed staging scope');
}

async function getAppSettings(name) {
  const cfg = getConfig();
  const app = await getAllowedApp(name);
  const client = getClient();
  const result = await client.webApps.listApplicationSettings(cfg.resourceGroup, app.name);
  const properties = result && result.properties || {};
  const settings = Object.keys(properties)
    .sort((a, b) => a.localeCompare(b))
    .map(key => ({ name: key, value: properties[key] == null ? '' : String(properties[key]) }));
  return {
    app,
    settings,
    settingKeys: settings.map(item => item.name)
  };
}

async function restartAppService(name, actor) {
  const cfg = getConfig();
  const app = await getAllowedApp(name);
  const key = app.name.toLowerCase();
  const now = Date.now();
  const cooldown = restartCooldowns.get(key);
  if (cooldown && cooldown.until > now) {
    const err = createPublicError(429, 'Restart cooldown is active');
    err.retryAfterSeconds = Math.ceil((cooldown.until - now) / 1000);
    throw err;
  }

  restartCooldowns.set(key, {
    until: now + cfg.restartCooldownMs,
    actor: actor || '',
    startedAt: new Date(now).toISOString()
  });

  try {
    const client = getClient();
    await client.webApps.restart(cfg.resourceGroup, app.name);
    return {
      app,
      cooldownSeconds: Math.ceil(cfg.restartCooldownMs / 1000)
    };
  } catch (err) {
    restartCooldowns.delete(key);
    throw err;
  }
}

function normalizeName(name) {
  return String(name || '').trim();
}

function isAllowedAppName(name, prefix) {
  const value = normalizeName(name).toLowerCase();
  const targetPrefix = String(prefix || DEFAULT_NAME_PREFIX).trim().toLowerCase();
  return !!value && !!targetPrefix && value.startsWith(targetPrefix);
}

function mapApp(app, resourceGroup) {
  const state = app.state || app.status || '';
  return {
    id: app.id || '',
    name: app.name || '',
    resourceGroup: resourceGroup,
    location: app.location || '',
    status: state || 'Unknown',
    state: state || 'Unknown',
    kind: app.kind || '',
    defaultHostName: app.defaultHostName || '',
    appType: app.kind && String(app.kind).toLowerCase().includes('functionapp')
      ? 'Function App'
      : 'Web App'
  };
}

function getScope() {
  const cfg = getConfig();
  return {
    subscriptionId: cfg.subscriptionId,
    resourceGroup: cfg.resourceGroup,
    namePrefix: cfg.namePrefix,
    tenantId: cfg.tenantId
  };
}

module.exports = {
  getConfig,
  getScope,
  listAllowedAppServices,
  getAllowedApp,
  getAppSettings,
  restartAppService,
  isAllowedAppName
};
