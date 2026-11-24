const DEFAULT_SUBSCRIPTION_ID = 'f9bca0f4-1e5b-487f-a2ef-a6578a936ef1';
const DEFAULT_RESOURCE_GROUP = 'Default-STG-TH-ServicesBackEnd-All-Group';
const DEFAULT_NAME_PREFIX = 'stg-';

const cachedClients = new Map();
let cachedApps = null;
let cachedAppsAt = 0;
const restartCooldowns = new Map();

function parseTargetConfig() {
  const raw = String(process.env.APP_SERVICE_TARGETS_JSON || '').trim();
  if (!raw) {
    try { return require('../../config/appservice-targets.json'); } catch (err) { return null; }
  }
  try { return JSON.parse(raw); } catch (err) {
    throw createPublicError(503, 'APP_SERVICE_TARGETS_JSON is invalid');
  }
}

function normalizeCountry(value) { return String(value || '').trim().toUpperCase(); }
function normalizeEnvironment(value) { return String(value || '').trim().toUpperCase(); }

function getTarget(country, environment, subscriptionId) {
  const cfg = getConfig();
  const targets = cfg.targets;
  if (!targets) return { country: 'TH', environment: normalizeEnvironment(environment) || 'STG', subscriptionId: subscriptionId || cfg.subscriptionId, tenantId: cfg.tenantId, resourceGroup: cfg.resourceGroup, allResourceGroups: cfg.allResourceGroups, namePrefix: cfg.namePrefix, allowedNames: cfg.allowedNames, allowAll: cfg.allowAll };
  const c = normalizeCountry(country) || inferCountryFromSubscription(subscriptionId, targets) || 'TH';
  const e = normalizeEnvironment(environment) || inferEnvironmentFromName('', cfg) || 'STG';
  const target = targets[c] && targets[c].environments && targets[c].environments[e];
  if (!target && c === 'TH') return { country: 'TH', environment: e, subscriptionId: subscriptionId || (e === 'PRD' ? cfg.productionSubscriptionId : cfg.subscriptionId), tenantId: cfg.tenantId, resourceGroup: cfg.resourceGroup, allResourceGroups: cfg.allResourceGroups, namePrefix: cfg.namePrefix, allowedNames: cfg.allowedNames, allowAll: cfg.allowAll };
  if (!target) throw createPublicError(400, `Unsupported Azure target: ${c}/${e}`);
  return { ...target, country: c, environment: e, subscriptionId: target.subscriptionId, tenantId: target.tenantId || cfg.tenantId, resourceGroup: target.resourceGroup || 'ALL', allResourceGroups: isAllResourceGroupsScope(target.resourceGroup || 'ALL'), namePrefix: target.namePrefix || '', allowedNames: target.allowedNames || [], allowAll: target.allowAll === true };
}

function inferCountryFromSubscription(subscriptionId, targets) {
  const id = String(subscriptionId || '').toLowerCase();
  for (const [country, value] of Object.entries(targets || {})) for (const target of Object.values(value.environments || {})) if (String(target.subscriptionId || '').toLowerCase() === id) return country;
  return '';
}

function inferEnvironmentFromName(name, cfg) {
  const value = String(name || '').toLowerCase();
  if (value.startsWith('prd-')) return 'PRD';
  if (value.startsWith('stg-')) return 'STG';
  return '';
}

function getConfig() {
  const subscriptionId = process.env.APP_SERVICE_SUBSCRIPTION_ID || DEFAULT_SUBSCRIPTION_ID;
  const productionSubscriptionId = String(process.env.APP_SERVICE_PROD_SUBSCRIPTION_ID || '').trim();
  const resourceGroup = process.env.APP_SERVICE_RESOURCE_GROUP || DEFAULT_RESOURCE_GROUP;
  const namePrefix = process.env.APP_SERVICE_NAME_PREFIX || DEFAULT_NAME_PREFIX;
  const allowedNames = String(process.env.APP_SERVICE_ALLOWED_NAMES || '')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const allowAll = String(process.env.APP_SERVICE_ALLOW_ALL || '').trim().toLowerCase() === 'true';
  const allResourceGroups = isAllResourceGroupsScope(resourceGroup);
  const tenantId = process.env.AZURE_TENANT_ID || '36f04887-ce29-484c-900e-f23ad3f60b77';
  const targets = parseTargetConfig();
  const cacheTtlMs = Math.max(5000, Number(process.env.APP_SERVICE_CACHE_TTL_SECONDS || 60) * 1000);
  const restartCooldownMs = Math.max(0, Number(process.env.APP_SERVICE_RESTART_COOLDOWN_SECONDS || 300) * 1000);
  if (!subscriptionId) throw new Error('Missing APP_SERVICE_SUBSCRIPTION_ID');
  if (!resourceGroup) throw new Error('Missing APP_SERVICE_RESOURCE_GROUP');
  return {
    subscriptionId,
    productionSubscriptionId,
    resourceGroup,
    allResourceGroups,
    namePrefix,
    allowedNames,
    allowAll,
    tenantId,
    targets,
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

function getClient(subscriptionId, target) {
  const cfg = getConfig();
  const clientKey = subscriptionId || cfg.subscriptionId;
  if (cachedClients.has(clientKey)) return cachedClients.get(clientKey);
  const { WebSiteManagementClient } = require('@azure/arm-appservice');
  const credential = getCredential(cfg, clientKey, target);
  const client = new WebSiteManagementClient(credential, clientKey);
  cachedClients.set(clientKey, client);
  return client;
}

function getCredential(cfg, subscriptionId, targetConfig) {
  const configuredSecret = targetConfig && targetConfig.clientSecretEnv ? process.env[targetConfig.clientSecretEnv] : targetConfig && targetConfig.clientSecret;
  if (targetConfig && targetConfig.clientId && configuredSecret) {
    const { ClientSecretCredential } = require('@azure/identity');
    return new ClientSecretCredential(targetConfig.tenantId, targetConfig.clientId, configuredSecret);
  }
  if (subscriptionId === cfg.productionSubscriptionId) {
    const tenantId = String(process.env.AZURE_PROD_TENANT_ID || '').trim();
    const clientId = String(process.env.AZURE_PROD_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.AZURE_PROD_CLIENT_SECRET || '').trim();
    if (!tenantId || !clientId || !clientSecret) {
      throw createPublicError(503, 'Production Azure credential is not configured');
    }
    const { ClientSecretCredential } = require('@azure/identity');
    return new ClientSecretCredential(tenantId, clientId, clientSecret);
  }
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

async function listAllowedAppServices(forceRefresh, country, environment) {
  const cfg = getConfig();
  if (cfg.targets && !normalizeEnvironment(environment)) {
    const selectedCountry = normalizeCountry(country) || 'TH';
    const environments = Object.keys((cfg.targets[selectedCountry] || {}).environments || {});
    if (selectedCountry === 'TH' && environments.length === 0) environments.push('STG', 'PRD');
    const results = [];
    for (const env of environments) results.push(...await listAllowedAppServices(forceRefresh, country, env));
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }
  const target = getTarget(country, environment);
  const cacheKey = `${target.country}:${target.environment}`;
  const now = Date.now();
  if (!forceRefresh && cachedApps && cachedApps.cacheKey === cacheKey && now - cachedAppsAt < cfg.cacheTtlMs) {
    return cachedApps.apps;
  }

  const apps = target.allResourceGroups
    ? await listSubscriptionAppServices({ ...cfg, ...target })
    : await listResourceGroupAppServices({ ...cfg, ...target });
  apps.sort((a, b) => a.name.localeCompare(b.name));
  cachedApps = { cacheKey, apps: apps.map(app => ({ ...app, country: target.country, environment: target.environment, subscriptionId: target.subscriptionId })) };
  cachedAppsAt = now;
  return cachedApps.apps;
}

async function listResourceGroupAppServices(cfg) {
  const client = getClient(cfg.subscriptionId, cfg);
  const apps = [];
  for await (const app of client.webApps.listByResourceGroup(cfg.resourceGroup)) {
    const row = mapApp(app, cfg.resourceGroup);
    if (isAllowedAppName(row.name, cfg.namePrefix, cfg.allowedNames, cfg.allowAll)) apps.push(row);
  }
  return apps;
}

async function listSubscriptionAppServices(cfg) {
  try {
    return await listSubscriptionAppServicesFromResourceGraph(cfg);
  } catch (err) {
    if (String(process.env.APP_SERVICE_ENABLE_SLOW_LIST_FALLBACK || '').toLowerCase() === 'true') {
      const fallback = await listSubscriptionAppServicesFromArmResources(cfg);
      if (fallback.length) return fallback;
    }
    throw err;
  }
}

async function listSubscriptionAppServicesFromResourceGraph(cfg) {
  const token = await getArmAccessToken(cfg);
  const apps = [];
  let skipToken = '';
  const seenSkipTokens = new Set();
  let pageCount = 0;

  do {
    const body = {
      subscriptions: [cfg.subscriptionId],
      query: [
        "Resources",
        "| where type =~ 'microsoft.web/sites'",
        // Fetch App Service resources first, then apply the explicit local allow-list.
        // This avoids Resource Graph name-filter edge cases for approved production names.
        "| project id, name, resourceGroup, location, kind, state=tostring(properties.state), defaultHostName=tostring(properties.defaultHostName)",
        "| order by name asc"
      ].join(' '),
      options: {
        resultFormat: 'objectArray',
        '$top': 1000
      }
    };
    if (skipToken) body.options.$skipToken = skipToken;

    const response = await requestArmJson('POST',
      'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01',
      token,
      body);
    const rows = Array.isArray(response.data) ? response.data : [];
    rows.forEach(row => {
      const app = mapResourceGraphApp(row);
      if (isAllowedAppName(app.name, cfg.namePrefix, cfg.allowedNames, cfg.allowAll)) apps.push(app);
    });
    skipToken = response.skipToken || response.$skipToken || '';
    pageCount += 1;
    if (pageCount > 20) {
      const err = new Error('Azure Resource Graph returned too many pages');
      err.name = 'ResourceGraphPagingError';
      throw err;
    }
    if (skipToken && seenSkipTokens.has(skipToken)) {
      const err = new Error('Azure Resource Graph returned a repeated skip token');
      err.name = 'ResourceGraphPagingError';
      throw err;
    }
    if (skipToken) seenSkipTokens.add(skipToken);
  } while (skipToken);

  return apps;
}

async function listSubscriptionAppServicesFromArmResources(cfg) {
  const token = await getArmAccessToken(cfg);
  const apps = [];
  let url = 'https://management.azure.com/subscriptions/' + encodeURIComponent(cfg.subscriptionId)
    + '/resources?api-version=2021-04-01&$filter='
    + encodeURIComponent("resourceType eq 'Microsoft.Web/sites'");

  while (url) {
    const response = await requestArmJson('GET', url, token);
    const rows = Array.isArray(response.value) ? response.value : [];
    rows.forEach(row => {
      const app = mapResourceApp(row);
      if (isAllowedAppName(app.name, cfg.namePrefix, cfg.allowedNames, cfg.allowAll)) apps.push(app);
    });
    url = response.nextLink || '';
  }

  return apps;
}

async function getArmAccessToken(cfg) {
  const credential = getCredential(cfg, cfg.subscriptionId, cfg);
  const token = await credential.getToken('https://management.azure.com/.default');
  if (!token || !token.token) {
    const err = new Error('Managed Identity did not return an ARM access token');
    err.name = 'ManagedIdentityTokenError';
    throw err;
  }
  return token.token;
}

function requestArmJson(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = require('https').request(url, {
      method,
      timeout: getArmRequestTimeoutMs(),
      headers: Object.assign({
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + token
      }, payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      } : {})
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        let parsed = {};
        try {
          parsed = responseBody ? JSON.parse(responseBody) : {};
        } catch (parseErr) {
          parseErr.name = 'ArmResponseParseError';
          reject(parseErr);
          return;
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(parsed.error && parsed.error.message || 'Azure ARM request failed with status ' + res.statusCode);
          err.name = parsed.error && parsed.error.code || 'ArmRequestError';
          err.statusCode = res.statusCode;
          reject(err);
          return;
        }

        resolve(parsed);
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      const err = new Error('Azure ARM request timeout');
      err.name = 'ArmRequestTimeout';
      err.statusCode = 504;
      req.destroy(err);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function getArmRequestTimeoutMs() {
  const seconds = Number(process.env.APP_SERVICE_ARM_REQUEST_TIMEOUT_SECONDS || 30);
  return Math.max(5, seconds) * 1000;
}

async function getAllowedApp(name, requestedResourceGroup, requestedSubscriptionId, targetOverride) {
  const target = normalizeName(name);
  if (!target) {
    throw createPublicError(400, 'Missing app service name');
  }

  const cfg = getConfig();
  const targetCfg = targetOverride || getTarget('', '', requestedSubscriptionId);
  const subscriptionId = requestedSubscriptionId || cfg.subscriptionId;
  const configuredSubscriptions = cfg.targets ? Object.values(cfg.targets).flatMap(value => Object.values(value.environments || {}).map(target => target.subscriptionId)) : [];
  if (![cfg.subscriptionId, cfg.productionSubscriptionId, ...configuredSubscriptions].filter(Boolean).includes(subscriptionId)) {
    throw createPublicError(403, 'Subscription is outside the configured allow-list');
  }
  if (!isAllowedAppName(target, targetCfg.namePrefix, targetCfg.allowedNames, targetCfg.allowAll)) {
    throw createPublicError(403, 'App Service is outside the configured allow-list scope');
  }

  if (requestedResourceGroup) {
    const direct = await getClient(subscriptionId, targetCfg).webApps.get(String(requestedResourceGroup), target);
    if (direct) return mapApp(direct, String(requestedResourceGroup));
  }
  const apps = await listAllowedAppServices(false, targetCfg.country, targetCfg.environment);
  const found = apps.find(app => app.name.toLowerCase() === target.toLowerCase());
  if (found) return found;

  const refreshed = await listAllowedAppServices(true, targetCfg.country, targetCfg.environment);
  const fresh = refreshed.find(app => app.name.toLowerCase() === target.toLowerCase());
  if (fresh) return fresh;
  if (requestedResourceGroup) {
    const direct = await getClient(subscriptionId, targetCfg).webApps.get(String(requestedResourceGroup), target);
    if (direct) return mapApp(direct, String(requestedResourceGroup));
  }

  throw createPublicError(404, 'App Service not found in allowed staging scope');
}

async function getAppSettings(name, country, environment, resourceGroup) {
  const cfg = getConfig();
  const target = getTarget(country, environment);
  const app = await getAllowedApp(name, resourceGroup, target.subscriptionId, target);
  const client = getClient(target.subscriptionId, target);
  const result = await client.webApps.listApplicationSettings(app.resourceGroup || target.resourceGroup, app.name);
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

async function restartAppService(name, actor, resourceGroup, subscriptionId, country, environment) {
  const cfg = getConfig();
  const target = getTarget(country, environment, subscriptionId);
  const app = await getAllowedApp(name, resourceGroup, target.subscriptionId, target);
  const key = [target.country, target.environment, target.subscriptionId, app.resourceGroup, app.name].join(':').toLowerCase();
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
    const client = getClient(target.subscriptionId, target);
    await client.webApps.restart(app.resourceGroup || cfg.resourceGroup, app.name);
    return {
      app,
      subscriptionId: target.subscriptionId,
      country: target.country,
      environment: target.environment || resolveEnvironment(target.subscriptionId, cfg),
      cooldownSeconds: Math.ceil(cfg.restartCooldownMs / 1000)
    };
  } catch (err) {
    restartCooldowns.delete(key);
    throw err;
  }
}

function resolveEnvironment(subscriptionId, cfg = getConfig()) {
  if (subscriptionId && subscriptionId === cfg.productionSubscriptionId) return 'PRD';
  if (subscriptionId && subscriptionId === cfg.subscriptionId) return 'STG';
  return 'UNKNOWN';
}

function normalizeName(name) {
  return String(name || '').trim();
}

function isAllowedAppName(name, prefix, allowedNames = [], allowAll = false) {
  const value = normalizeName(name).toLowerCase();
  const targetPrefix = String(prefix || DEFAULT_NAME_PREFIX).trim().toLowerCase();
  return !!value && (allowAll || (!!targetPrefix && value.startsWith(targetPrefix)) || allowedNames.includes(value));
}

function isAllResourceGroupsScope(resourceGroup) {
  const value = String(resourceGroup || '').trim().toLowerCase();
  return value === '*' || value === 'all' || value === 'subscription';
}

function getResourceGroupFromId(id) {
  const match = String(id || '').match(/\/resourceGroups\/([^/]+)/i);
  return match ? decodeURIComponent(match[1]) : '';
}

function escapeKustoString(value) {
  return String(value || '').replace(/'/g, "''");
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

function mapResourceGraphApp(row) {
  const state = row.state || '';
  return {
    id: row.id || '',
    name: row.name || '',
    resourceGroup: row.resourceGroup || getResourceGroupFromId(row.id),
    location: row.location || '',
    status: state || 'Unknown',
    state: state || 'Unknown',
    kind: row.kind || '',
    defaultHostName: row.defaultHostName || '',
    appType: row.kind && String(row.kind).toLowerCase().includes('functionapp')
      ? 'Function App'
      : 'Web App'
  };
}

function mapResourceApp(resource) {
  const properties = resource && resource.properties || {};
  const state = properties.state || properties.status || '';
  const kind = resource && resource.kind || '';
  return {
    id: resource && resource.id || '',
    name: resource && resource.name || '',
    resourceGroup: getResourceGroupFromId(resource && resource.id),
    location: resource && resource.location || '',
    status: state || 'Unknown',
    state: state || 'Unknown',
    kind,
    defaultHostName: properties.defaultHostName || '',
    appType: kind && String(kind).toLowerCase().includes('functionapp')
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
    allowedNames: cfg.allowedNames,
    tenantId: cfg.tenantId
  };
}

function getCountries() {
  const cfg = getConfig();
  if (!cfg.targets) return [{ code: 'TH', name: 'Thailand', environments: ['STG', 'PRD'] }];
  const countries = Object.entries(cfg.targets).map(([code, value]) => ({ code, name: value.displayName || code, environments: Object.keys(value.environments || {}) }));
  if (!countries.some(item => item.code === 'TH')) countries.unshift({ code: 'TH', name: 'Thailand', environments: ['STG', 'PRD'] });
  return countries;
}

module.exports = {
  getConfig,
  getScope,
  getTarget,
  getCountries,
  listAllowedAppServices,
  getAllowedApp,
  getAppSettings,
  restartAppService,
  resolveEnvironment,
  isAllowedAppName,
  isAllResourceGroupsScope
};
