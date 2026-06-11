// api/webhook/index.js
// แก้ไข: เปลี่ยนจาก exact match เป็น prefix match
// รองรับ Staging/VN, Staging/api, staging, Staging ทุกรูปแบบ
const { notifyTeams } = require('../shared/teams-notifier');
const sp = require('../shared/sharepoint-client');

module.exports = async function (context, req) {
    context.log('webhook: called');

    // --- Basic Auth guard ---
    const webhookUser = process.env.WEBHOOK_USERNAME;
    const webhookPass = process.env.WEBHOOK_PASSWORD;

    if (webhookUser && webhookPass) {
        const authHeader = req.headers['authorization'] || '';
        const expected = 'Basic ' + Buffer.from(`${webhookUser}:${webhookPass}`).toString('base64');
        if (authHeader !== expected) {
            context.log.warn('webhook: 401 - Basic Auth ไม่ถูกต้อง');
            context.res = { status: 401, body: 'Unauthorized' };
            return;
        }
    }

    // --- Parse payload ---
    const body = req.body || {};
    const eventType   = body.eventType || '';
    const resourceData = body.resource || {};

    // ดึงข้อมูล PR จาก payload
    const pr           = resourceData.pullRequest || resourceData || {};
    const targetRef    = pr.targetRefName || resourceData.targetRefName || '';
    const sourceRef    = pr.sourceRefName || resourceData.sourceRefName || '';
    const prId         = pr.pullRequestId  || resourceData.pullRequestId  || '';
    const prTitle      = pr.title          || resourceData.title          || '(ไม่มีชื่อ)';
    const repoName     = (pr.repository    || {}).name || '';
    const createdBy    = (pr.createdBy     || {}).displayName || '';

    context.log(`webhook: eventType=${eventType}, PR#${prId}, target=${targetRef}`);

    // --- แก้ไขตรงนี้ ---
    // เดิม: เช็ค STAGING_BRANCH_REF ด้วย exact match
    // ใหม่: เช็คด้วย prefix match (startsWith) case-insensitive
    const stagingPrefix = (
        process.env.STAGING_BRANCH_REF || 'refs/heads/staging'
    ).toLowerCase();

    const isTargetStaging = targetRef.toLowerCase().startsWith(stagingPrefix);
    // -------------------

    // เฉพาะ event ที่เกี่ยวกับ PR created / updated / reviewersvoted
    const isRelevantEvent = (
        eventType === 'git.pullrequest.created' ||
        eventType === 'git.pullrequest.updated' ||
        eventType === 'git.pullrequest.reviewersvoted'
    );

    if (!isRelevantEvent || !isTargetStaging) {
        context.log(`webhook: ignored — isRelevantEvent=${isRelevantEvent}, isTargetStaging=${isTargetStaging}`);
        context.res = { status: 200, body: 'OK (ignored)' };
        return;
    }

    // --- บันทึก Log ลง SharePoint ---
    try {
        let action = 'Webhook Received';
        let result = `Webhook event: ${eventType}`;
        let userEmail = createdBy || 'System';

        if (eventType === 'git.pullrequest.reviewersvoted') {
            const reviewer = resourceData.reviewer || {};
            userEmail = reviewer.uniqueName || reviewer.displayName || userEmail;
            const vote = Number(resourceData.vote);
            if (vote === 10) {
                action = 'External Approved';
                result = 'Approved in Azure DevOps';
            } else if (vote === -10) {
                action = 'External Rejected';
                result = 'Rejected in Azure DevOps';
            } else if (vote === -5) {
                action = 'External Waiting Author';
                result = 'Waiting for author in Azure DevOps';
            } else {
                action = 'Reviewers Voted';
                result = `Voted (vote value: ${vote})`;
            }
        } else if (eventType === 'git.pullrequest.created') {
            action = 'PR Created';
            result = `New Pull Request created`;
        } else if (eventType === 'git.pullrequest.updated') {
            action = 'PR Updated';
            result = `Pull Request updated`;
        }

        await sp.addLogItem(sp.buildLogFields({
            prId:         String(prId),
            action:       action,
            user:         userEmail,
            repository:   repoName,
            prTitle:      prTitle,
            targetBranch: targetRef,
            result:       result,
            source:       'Azure DevOps Webhook'
        }));
        context.log(`webhook: SharePoint log recorded successfully for action=${action}`);
    } catch (err) {
        context.log.warn('webhook: SharePoint log failed:', err.message);
    }

    // --- ส่งแจ้งเตือนเข้า Teams ---
    const teamsWebhookUrl = process.env.TEAMS_WEBHOOK_URL;
    if (!teamsWebhookUrl) {
        context.log.warn('webhook: TEAMS_WEBHOOK_URL ไม่ได้ตั้งค่า — ข้ามการแจ้งเตือน');
        context.res = { status: 200, body: 'OK (no Teams URL configured)' };
        return;
    }

    const actionLabel = eventType === 'git.pullrequest.created' ? 'New PR' : 'PR Updated';
    const message =
        `## 🔔 ${actionLabel} Detected on Staging\n\n` +
        `| Field | Value |\n` +
        `|---|---|\n` +
        `| PR # | ${prId} |\n` +
        `| Title | ${prTitle} |\n` +
        `| Repo | ${repoName} |\n` +
        `| Source | \`${sourceRef}\` |\n` +
        `| Target | \`${targetRef}\` |\n` +
        `| Created by | ${createdBy} |`;

    try {
        await notifyTeams(teamsWebhookUrl, message);
        context.log('webhook: Teams notification ส่งสำเร็จ');
        context.res = { status: 200, body: 'OK' };
    } catch (err) {
        context.log.error('webhook: Teams notification ล้มเหลว:', err.message);
        // ตอบ 200 กลับ ADO เสมอ เพื่อไม่ให้ ADO retry loop
        context.res = { status: 200, body: `OK (Teams error: ${err.message})` };
    }
};
