/**
 * ============================================
 * SharePoint Client (via Microsoft Graph API)
 * ============================================
 *
 * เขียน/อ่าน SharePoint List items ผ่าน Graph API
 *
 * Env vars ที่ต้องการ:
 *   AAD_TENANT_ID         (มีอยู่แล้วใน Phase 1)
 *   AAD_CLIENT_ID         (มีอยู่แล้วใน Phase 1)
 *   AAD_CLIENT_SECRET     (มีอยู่แล้วใน Phase 1)
 *   SHAREPOINT_HOSTNAME   = yourorg.sharepoint.com
 *   SHAREPOINT_SITE_PATH  = /sites/IT-Support  (path หลัง hostname)
 *   SHAREPOINT_LIST_NAME  = ADO Auto-Approve Log
 *
 * ต้องการ Graph API permission: Sites.ReadWrite.All (admin consent)
 */

const https = require('https');

let cachedToken = null;
let tokenExpiresAt = 0;
let cachedSiteId = null;
let cachedListId = null;

function getConfig() {
  const required = {
    tenant: process.env.AAD_TENANT_ID,
    clientId: process.env.AAD_CLIENT_ID,
    clientSecret: process.env.AAD_CLIENT_SECRET,
    hostname: process.env.SHAREPOINT_HOSTNAME,
    sitePath: process.env.SHAREPOINT_SITE_PATH,
    listName: process.env.SHAREPOINT_LIST_NAME || 'ADO Auto-Approve Log'
  };
  const missing = Object.keys(required).filter(k => k !== 'listName' && !required[k]);
  if (missing.length) {
    throw new Error('Missing SharePoint env vars: ' + missing.join(', '));
  }
  return required;
}

/**
 * HTTPS helper
 */
function httpRequest(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const options = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: method,
      headers: Object.assign({ 'Accept': 'application/json' }, headers || {}),
      timeout: 15000
    };
    if (data) {
      if (!options.headers['Content-Type']) options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = https.request(options, (res) => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = resBody ? JSON.parse(resBody) : null; } catch (e) {}
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body: parsed || resBody
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Graph API timeout (15s)')); });
    if (data) req.write(data);
    req.end();
  });
}

/**
 * ขอ access token จาก Entra ID (Client Credentials Flow)
 */
async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60000) {
    return cachedToken;
  }
  const cfg = getConfig();
  const tokenUrl = `https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/token`;
  const body = `client_id=${encodeURIComponent(cfg.clientId)}` +
    `&client_secret=${encodeURIComponent(cfg.clientSecret)}` +
    `&scope=${encodeURIComponent('https://graph.microsoft.com/.default')}` +
    `&grant_type=client_credentials`;
  const result = await httpRequest('POST', tokenUrl,
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  );
  if (!result.ok) {
    throw new Error('Failed to get token: HTTP ' + result.status + ' ' + JSON.stringify(result.body));
  }
  cachedToken = result.body.access_token;
  tokenExpiresAt = now + (result.body.expires_in * 1000);
  return cachedToken;
}

/**
 * หา Site ID จาก hostname + site path
 */
async function getSiteId() {
  if (cachedSiteId) return cachedSiteId;
  const cfg = getConfig();
  const token = await getAccessToken();
  const url = `https://graph.microsoft.com/v1.0/sites/${cfg.hostname}:${cfg.sitePath}`;
  const result = await httpRequest('GET', url, { 'Authorization': 'Bearer ' + token });
  if (!result.ok) {
    throw new Error('Failed to find SharePoint site: HTTP ' + result.status + ' — ตรวจ SHAREPOINT_HOSTNAME / SHAREPOINT_SITE_PATH');
  }
  cachedSiteId = result.body.id;
  return cachedSiteId;
}

/**
 * หา List ID จากชื่อ list
 */
async function getListId() {
  if (cachedListId) return cachedListId;
  const cfg = getConfig();
  const siteId = await getSiteId();
  const token = await getAccessToken();
  const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists?$select=id,displayName,name`;
  const result = await httpRequest('GET', url, { 'Authorization': 'Bearer ' + token });
  if (!result.ok) {
    throw new Error('Failed to list SharePoint lists: HTTP ' + result.status);
  }
  const list = (result.body.value || []).find(l =>
    l.displayName === cfg.listName || l.name === cfg.listName
  );
  if (!list) {
    throw new Error('SharePoint List not found: ' + cfg.listName);
  }
  cachedListId = list.id;
  return cachedListId;
}

/**
 * เพิ่ม log entry ใน SharePoint List
 * @param {object} fields - { Title, PR_ID, Action, User, Repository, ... }
 */
async function addLogItem(fields) {
  const siteId = await getSiteId();
  const listId = await getListId();
  const token = await getAccessToken();
  const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items`;
  const result = await httpRequest('POST', url,
    { 'Authorization': 'Bearer ' + token },
    { fields: fields }
  );
  return result;
}

/**
 * Query items สำหรับ PR ID ที่ระบุ (เรียงล่าสุดก่อน)
 */
async function getLogForPR(prId) {
  const siteId = await getSiteId();
  const listId = await getListId();
  const token = await getAccessToken();
  const filter = `fields/PR_ID eq ${parseInt(prId, 10) || 0}`;
  const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?expand=fields&$filter=${encodeURIComponent(filter)}&$orderby=createdDateTime desc&$top=50`;
  const result = await httpRequest('GET', url, {
    'Authorization': 'Bearer ' + token,
    'Prefer': 'HonorNonIndexedQueriesWarningMayFailRandomly'
  });
  return result;
}

/**
 * Helper: สร้าง log entry มาตรฐาน
 */
function buildLogFields(opts) {
  return {
    Title: `${opts.action} PR #${opts.prId}`,
    PR_ID: opts.prId,
    Action: opts.action,         // "Approved" | "Rejected" | "Failed"
    User: opts.user || 'Unknown',
    Repository: opts.repository || '',
    PR_Title: opts.prTitle || '',
    Target_Branch: opts.targetBranch || '',
    Result: opts.result || 'Success',
    Reason: opts.reason || ''
  };
}

module.exports = {
  getAccessToken,
  getSiteId,
  getListId,
  addLogItem,
  getLogForPR,
  buildLogFields
};
