// api/list-prs/index.js
// แก้ไข: เปลี่ยนจาก exact match เป็น prefix match
// รองรับ Staging/VN, Staging/api, staging, Staging ทุกรูปแบบ
const https = require('https');

module.exports = async function (context, req) {
    context.log('list-prs: called');

    const org    = process.env.ADO_ORGANIZATION;
    const project = process.env.ADO_PROJECT;
    const pat    = process.env.ADO_PAT;

    // --- แก้ไขตรงนี้ ---
    // ADO_TARGET_BRANCH เดิมใช้เป็น exact match
    // เปลี่ยนเป็น prefix match แทน
    // default prefix = 'refs/heads/staging' (lowercase)
    // รองรับทุก branch ที่ขึ้นต้นด้วย refs/heads/staging ไม่ว่าจะ case ใด
    const stagingPrefix = (
        process.env.ADO_TARGET_BRANCH || 'refs/heads/staging'
    ).toLowerCase();
    // -------------------

    if (!org || !project || !pat) {
        context.res = {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: 'Missing environment variables: ADO_ORGANIZATION, ADO_PROJECT หรือ ADO_PAT'
            })
        };
        return;
    }

    try {
        // ดึง PR ทั้งหมดที่ active (ไม่ filter branch ที่ API layer แล้ว)
        const allPRs = await fetchActivePRs(org, project, pat);

        // Filter เฉพาะ PR ที่ target branch ขึ้นต้นด้วย stagingPrefix
        const stagingPRs = allPRs.filter(pr => {
            const target = (pr.targetRefName || '').toLowerCase();
            return target.startsWith(stagingPrefix);
        });

        context.log(`list-prs: พบ PR ทั้งหมด ${allPRs.length} รายการ, ใน Staging ${stagingPRs.length} รายการ`);

        context.res = {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                count: stagingPRs.length,
                organization: org,
                project: project,
                stagingPrefix: stagingPrefix,
                pullRequests: stagingPRs.map(pr => ({
                    id:          pr.pullRequestId,
                    title:       pr.title,
                    sourceRef:   pr.sourceRefName,
                    targetRef:   pr.targetRefName,
                    repoName:    pr.repository ? pr.repository.name : '',
                    mergeStatus: pr.mergeStatus,
                    isDraft:     pr.isDraft || false,
                    createdBy:   pr.createdBy ? pr.createdBy.displayName : '',
                    createdDate: pr.creationDate,
                    url: `https://dev.azure.com/${org}/${project}/_git/` +
                         `${pr.repository ? pr.repository.name : ''}/pullrequest/${pr.pullRequestId}`
                }))
            })
        };

    } catch (err) {
        context.log.error('list-prs error:', err.message);
        context.res = {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: err.message })
        };
    }
};

// ดึง Active PR ทั้งหมดจาก ADO (ไม่ filter branch)
function fetchActivePRs(org, project, pat) {
    return new Promise((resolve, reject) => {
        const token = Buffer.from(`:${pat}`).toString('base64');

        // $top=200 เผื่อกรณีมี PR เปิดอยู่เยอะ
        const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}` +
                     `/_apis/git/pullrequests` +
                     `?searchCriteria.status=active&$top=200&api-version=7.1`;

        const options = {
            hostname: 'dev.azure.com',
            path:     path,
            method:   'GET',
            headers: {
                'Authorization': `Basic ${token}`,
                'Content-Type':  'application/json',
                'Accept':        'application/json'
            }
        };

        const httpReq = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const json = JSON.parse(data);
                        resolve(json.value || []);
                    } catch (e) {
                        reject(new Error('ADO API: parse JSON ไม่ได้'));
                    }
                } else if (res.statusCode === 401) {
                    reject(new Error('ADO API returned 401: PAT ผิดหรือหมดอายุ'));
                } else if (res.statusCode === 404) {
                    reject(new Error('ADO API returned 404: Organization หรือ Project ไม่ถูกต้อง'));
                } else {
                    reject(new Error(`ADO API returned ${res.statusCode}: ${data.substring(0, 200)}`));
                }
            });
        });

        httpReq.on('error', (e) => reject(new Error(`Network error: ${e.message}`)));
        httpReq.setTimeout(15000, () => {
            httpReq.abort();
            reject(new Error('ADO API timeout (15s)'));
        });
        httpReq.end();
    });
}
