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
  const allResourceGroups = isAllResourceGroupsScope(resourceGroup);
  const tenantId = process.env.AZURE_TENANT_ID || '36f04887-ce29-484c-900e-f23ad3f60b77';
  const cacheTtlMs = Math.max(5000, Number(process.env.APP_SERVICE_CACHE_TTL_SECONDS || 60) * 1000);
  const restartCooldownMs = Math.max(0, Number(process.env.APP_SERVICE_RESTART_COOLDOWN_SECONDS || 300) * 1000);
  if (!subscriptionId) throw new Error('Missing APP_SERVICE_SUBSCRIPTION_ID');
  if (!resourceGroup) throw new Error('Missing APP_SERVICE_RESOURCE_GROUP');
  return {
    subscriptionId,
    resourceGroup,
    allResourceGroups,
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
  const { WebSiteManagementClient } = require('@azure/arm-appservice');
  const cfg = getConfig();
  const credential = getCredential(cfg);
  cachedClient = new WebSiteManagementClient(credential, cfg.subscriptionId);
  return cachedClient;
}

function getCredential(cfg) {
  const rawManagedIdentity = createRawManagedIdentityCredential();
  if (rawManagedIdentity) return rawManagedIdentity;

  const { DefaultAzureCredential } = require('@azure/identity');
  return new DefaultAzureCredential({ tenantId: cfg.tenantId });
}

function createRawManagedIdentityCredential() {
  const identityEndpoint = process.env.IDENTITY_ENDPOINT;
  const identityHeader = process.env.IDENTITY_HEADER;
  const msiEndpoint = process.env.MSI_ENDPOINT;
  const msiSecret = process.env.MSI_SECRET;

  if (identityEndpoint && identityHeader) {
    return {
      getToken: async (scopes) => getManagedIdentityToken({
        endpoint: identityEndpoint,
        headerName: 'X-IDENTITY-HEADER',
        headerValue: identityHeader,
        apiVersion: '2019-08-01',
        scopes
      })
    };
  }

  if (identityEndpoint) {
    return {
      getToken: async (scopes) => getManagedIdentityToken({
        endpoint: identityEndpoint,
        apiVersion: '2019-08-01',
        scopes
      })
    };
  }

  if (msiEndpoint && msiSecret) {
    return {
      getToken: async (scopes) => getManagedIdentityToken({
        endpoint: msiEndpoint,
        headerName: 'secret',
        headerValue: msiSecret,
        apiVersion: '2017-09-01',
        scopes
      })
    };
  }

  if (msiEndpoint) {
    return {
      getToken: async (scopes) => getManagedIdentityToken({
        endpoint: msiEndpoint,
        apiVersion: '2017-09-01',
        scopes
      })
    };
  }

  return null;
}

async function getManagedIdentityToken(options) {
  const resource = getResourceFromScopes(options.scopes);
  const tokenUrl = new URL(options.endpoint);
  tokenUrl.searchParams.set('api-version', options.apiVersion);
  tokenUrl.searchParams.set('resource', resource);

  const headers = { 'Accept': 'application/json' };
  if (options.headerName && options.headerValue) {
    headers[options.headerName] = options.headerValue;
  }

  const response = await requestJson(tokenUrl, headers);

  if (!response || !response.access_token) {
    const err = new Error('Managed Identity endpoint did not return an access token');
    err.name = 'ManagedIdentityTokenError';
    throw err;
  }

  return {
    token: response.access_token,
    expiresOnTimestamp: getExpiresOnTimestamp(response)
  };
}

function getResourceFromScopes(scopes) {
  const first = Array.isArray(scopes) ? scopes[0] : scopes;
  const value = String(first || 'https://management.azure.com/.default');
  return value.endsWith('/.default') ? value.slice(0, -'/.default'.length) + '/' : value;
}

function getExpiresOnTimestamp(response) {
  if (response.expires_on) {
    const numeric = Number(response.expires_on);
    if (Number.isFinite(numeric)) return numeric * 1000;
    const parsed = Date.parse(response.expires_on);
    if (Number.isFinite(parsed)) return parsed;
  }

  const expiresIn = Number(response.expires_in || 3600);
  return Date.now() + Math.max(60, expiresIn) * 1000;
}

function requestJson(url, headers) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'http:' ? require('http') : require('https');
    const req = transport.request(url, {
      method: 'GET',
      headers
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error('Managed Identity token request failed with status ' + res.statusCode);
          err.name = 'ManagedIdentityTokenError';
          err.statusCode = res.statusCode;
          reject(err);
          return;
        }

        try {
          resolve(JSON.parse(body || '{}'));
        } catch (parseErr) {
          parseErr.name = 'ManagedIdentityTokenParseError';
          reject(parseErr);
        }
      });
    });

    req.on('error', (err) => {
      err.name = err.name || 'ManagedIdentityTokenRequestError';
      reject(err);
    });
    req.end();
  });
}

async function listAllowedAppServices(forceRefresh) {
  const cfg = getConfig();
  const now = Date.now();
  if (!forceRefresh && cachedApps && now - cachedAppsAt < cfg.cacheTtlMs) {
    return cachedApps;
  }

  const client = getClient();
  const apps = [];
  const source = cfg.allResourceGroups
    ? client.webApps.list()
    : client.webApps.listByResourceGroup(cfg.resourceGroup);
  for await (const app of source) {
    const row = mapApp(app, cfg.allResourceGroups ? getResourceGroupFromId(app.id) : cfg.resourceGroup);
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
  const result = await client.webApps.listApplicationSettings(app.resourceGroup || cfg.resourceGroup, app.name);
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
    await client.webApps.restart(app.resourceGroup || cfg.resourceGroup, app.name);
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

function isAllResourceGroupsScope(resourceGroup) {
  const value = String(resourceGroup || '').trim().toLowerCase();
  return value === '*' || value === 'all' || value === 'subscription';
}

function getResourceGroupFromId(id) {
  const match = String(id || '').match(/\/resourceGroups\/([^/]+)/i);
  return match ? decodeURIComponent(match[1]) : '';
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
    resourceGroup: cfg.allResourceGroups ? 'All resource groups' : cfg.resourceGroup,
    configuredResourceGroup: cfg.resourceGroup,
    resourceGroupMode: cfg.allResourceGroups ? 'subscription' : 'resourceGroup',
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
  isAllowedAppName,
  isAllResourceGroupsScope
};
