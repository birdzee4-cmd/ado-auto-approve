/**
 * GET /api/list-prs
 *
 * ดึง active Pull Requests ที่ target = staging branch จาก Azure DevOps
 * โดยใช้ Personal Access Token (PAT)
 *
 * Environment variables:
 *   ADO_ORGANIZATION  =  ชื่อ organization (จาก URL: dev.azure.com/<org>)
 *   ADO_PROJECT       =  ชื่อ project
 *   ADO_PAT           =  Personal Access Token (scope: Code Read)
 *   ADO_TARGET_BRANCH =  (optional) default: refs/heads/staging
 *
 * รับประกัน: ตอบ JSON เสมอ มี Content-Type ชัดเจน
 */

const https = require('https');

module.exports = async function (context, req) {
  function jsonResponse(status, payload) {
    context.res = {
      status: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    };
  }

  try {
    // ---- 1) ตรวจ auth ----
    if (!req.headers || !req.headers['x-ms-client-principal']) {
      jsonResponse(401, {
        ok: false,
        error: 'Authentication required',
        hint: 'Refresh หน้า dashboard แล้วลองใหม่'
      });
      return;
    }

    // ---- 2) ตรวจ env vars ----
    const org = process.env.ADO_ORGANIZATION;
    const project = process.env.ADO_PROJECT;
    const pat = process.env.ADO_PAT;
    const targetBranch = process.env.ADO_TARGET_BRANCH || 'refs/heads/staging';

    const missing = [];
    if (!org)     missing.push('ADO_ORGANIZATION');
    if (!project) missing.push('ADO_PROJECT');
    if (!pat)     missing.push('ADO_PAT');
    if (missing.length > 0) {
      jsonResponse(500, {
        ok: false,
        error: 'Missing environment variables: ' + missing.join(', '),
        hint: 'เพิ่ม env vars ใน Azure Portal → Static Web App → Configuration'
      });
      return;
    }

    // ---- 3) เรียก ADO REST API ----
    const apiPath = '/' + encodeURIComponent(org) + '/' + encodeURIComponent(project) +
      '/_apis/git/pullrequests?api-version=7.0' +
      '&searchCriteria.status=active' +
      '&searchCriteria.targetRefName=' + encodeURIComponent(targetBranch) +
      '&$top=100';

    const result = await callAdoApi('dev.azure.com', apiPath, pat);

    if (!result.ok) {
      jsonResponse(result.status === 401 ? 401 : 502, {
        ok: false,
        error: 'ADO API returned ' + result.status,
        detail: (result.body || '').substring(0, 500),
        hint: result.status === 401
          ? 'PAT ไม่ถูกต้องหรือหมดอายุ — สร้างใหม่และอัปเดต ADO_PAT'
          : result.status === 404
          ? 'ตรวจ ADO_ORGANIZATION และ ADO_PROJECT ว่าสะกดถูก'
          : 'ดู detail ด้านบนเพื่อหาสาเหตุ'
      });
      return;
    }

    // ---- 4) Parse และ map ข้อมูล ----
    let data;
    try {
      data = JSON.parse(result.body);
    } catch (e) {
      jsonResponse(502, {
        ok: false,
        error: 'ADO API returned non-JSON',
        detail: (result.body || '').substring(0, 300)
      });
      return;
    }

    const prs = (data.value || []).map(pr => ({
      id: pr.pullRequestId,
      title: pr.title,
      createdBy: pr.createdBy && pr.createdBy.displayName,
      sourceBranch: pr.sourceRefName,
      targetBranch: pr.targetRefName,
      repository: pr.repository && pr.repository.name,
      status: pr.status,
      isDraft: pr.isDraft,
      creationDate: pr.creationDate,
      mergeStatus: pr.mergeStatus,
      url: pr.repository && pr.repository.project
        ? 'https://dev.azure.com/' + org + '/' + project +
          '/_git/' + pr.repository.name + '/pullrequest/' + pr.pullRequestId
        : null
    }));

    jsonResponse(200, {
      ok: true,
      count: prs.length,
      organization: org,
      project: project,
      targetBranch: targetBranch,
      fetchedAt: new Date().toISOString(),
      prs: prs
    });

  } catch (err) {
    context.log.error('Unexpected error:', err);
    jsonResponse(500, {
      ok: false,
      error: 'Unexpected server error',
      detail: err && err.message ? err.message : String(err)
    });
  }
};

/**
 * เรียก ADO REST API ด้วย Basic Auth (PAT)
 */
function callAdoApi(hostname, path, pat) {
  return new Promise((resolve, reject) => {
    const auth = 'Basic ' + Buffer.from(':' + pat).toString('base64');

    const options = {
      hostname: hostname,
      port: 443,
      path: path,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': auth
      },
      timeout: 15000
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body: body
        });
      });
    });

    req.on('error', err => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('ADO API request timeout (15s)'));
    });

    req.end();
  });
}
