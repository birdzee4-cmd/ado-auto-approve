const https = require('https');
const profileCache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

async function getUserProfile(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;

  const cached = profileCache.get(normalizedEmail);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const sp = require('./sharepoint-client');
  const token = await sp.getAccessToken();
  const path = '/v1.0/users/' + encodeURIComponent(normalizedEmail) +
    '?$select=displayName,givenName,surname,mail,userPrincipalName,jobTitle,department';
  const result = await graphRequest(path, token);
  if (!result.ok) {
    const error = new Error('Graph user profile lookup returned HTTP ' + result.status);
    error.status = result.status;
    throw error;
  }

  const profile = {
    displayName: result.body.displayName || '',
    givenName: result.body.givenName || '',
    surname: result.body.surname || '',
    email: result.body.mail || result.body.userPrincipalName || normalizedEmail,
    jobTitle: result.body.jobTitle || '',
    department: result.body.department || ''
  };
  profileCache.set(normalizedEmail, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: profile
  });
  return profile;
}

function graphRequest(path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'graph.microsoft.com',
      port: 443,
      path: path,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      timeout: 10000
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = body ? JSON.parse(body) : null; } catch (e) {}
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body: parsed || {}
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Graph user profile lookup timeout'));
    });
    req.end();
  });
}

module.exports = { getUserProfile };
