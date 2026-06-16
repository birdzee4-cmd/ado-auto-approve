// api/webhook/index.js
// แก้ไข: เปลี่ยนจาก exact match เป็น prefix match
// รองรับ Staging/VN, Staging/api, staging, Staging ทุกรูปแบบ
const { notifyTeams } = require('../shared/teams-notifier');
const sp = require('../shared/sharepoint-client');
const ado = require('../shared/ado-client');

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

    if (eventType === 'build.complete') {
        const buildStatus = resourceData.status || '';
        const buildResult = resourceData.result || '';
        
        if (buildResult !== 'failed' && buildResult !== 'error') {
            context.log(`webhook: ignored build.complete - buildResult=${buildResult}`);
            context.res = { status: 200, body: 'OK (ignored non-failed build)' };
            return;
        }

        const triggerInfo = resourceData.triggerInfo || {};
        let prId = triggerInfo['pr.number'] || triggerInfo['MSTFS.PullRequestId'] || '';
        if (!prId && resourceData.sourceBranch) {
            const match = resourceData.sourceBranch.match(/refs\/pull\/(\d+)/);
            if (match) prId = match[1];
        }

        const buildId = resourceData.id || '';
        const buildNum = resourceData.buildNumber || '';
        const definitionName = (resourceData.definition || {}).name || '';
        const repo = (resourceData.repository || {}).name || '';
        const branch = resourceData.sourceBranch || '';
        const requestedBy = Array.isArray(resourceData.requests) && resourceData.requests[0] && resourceData.requests[0].requestedFor 
            ? resourceData.requests[0].requestedFor.displayName 
            : '';
        const buildUrl = (resourceData._links && resourceData._links.web && resourceData._links.web.href) || resourceData.url || '';

        let prTitle = '';
        let prAuthor = '';
        let prUrl = '';
        if (prId) {
            try {
                const prResult = await ado.getPullRequest(prId);
                if (prResult.ok && prResult.body) {
                    const pr = prResult.body;
                    prTitle = pr.title || '';
                    prAuthor = (pr.createdBy || {}).displayName || '';
                    const cfg = ado.getConfig();
                    prUrl = `https://dev.azure.com/${encodeURIComponent(cfg.org)}/${encodeURIComponent(cfg.project)}/_git/${encodeURIComponent(repo || (pr.repository || {}).name)}/pullrequest/${prId}`;
                }
            } catch (e) {
                context.log.warn(`webhook: failed to fetch PR #${prId} details:`, e.message);
            }
        }

        let failMessage = '';
        let failedTaskName = '';
        try {
            const timelineResult = await ado.getBuildTimeline(buildId);
            if (timelineResult.ok && timelineResult.body && Array.isArray(timelineResult.body.records)) {
                const records = timelineResult.body.records;
                const failedTask = records.find(r => r && r.state === 'completed' && r.result === 'failed' && r.log);
                if (failedTask) {
                    failedTaskName = failedTask.name || '';
                    const logResult = await ado.getBuildLog(buildId, failedTask.log.id);
                    if (logResult.ok) {
                        let rawLogText = '';
                        if (typeof logResult.body === 'string') {
                            rawLogText = logResult.body;
                        } else if (logResult.body && Array.isArray(logResult.body.value)) {
                            rawLogText = logResult.body.value.join('\n');
                        } else {
                            rawLogText = JSON.stringify(logResult.body);
                        }
                        const catalog = require('../shared/build-diagnostics-catalog');
                        const diag = catalog.diagnoseLog(rawLogText);
                        
                        failMessage += `### 🔍 วิเคราะห์ปัญหา (Diagnostics)\n`;
                        failMessage += `**ปัญหา:** ${diag.title}\n\n`;
                        failMessage += `**รายละเอียด:** ${diag.description}\n\n`;
                        failMessage += `#### 🛠️ แนวทางแก้ไข\n`;
                        for (const sol of diag.solutions) {
                            failMessage += `* **${sol.title}**\n${sol.details}\n\n`;
                        }
                        failMessage += `💡 *หมายเหตุ: คุณสามารถดูรายละเอียดข้อผิดพลาดดิบแบบเรียงบรรทัดได้ที่หน้า Dashboard วิเคราะห์ปัญหาผ่านลิงก์ด้านบนครับ*\n\n`;
                    }
                }
            }
        } catch (e) {
            context.log.warn('webhook diagnostics failed:', e.message);
        }

        let message = `## 🚨 Build Failed Detected\n\n`;
        message += `| Field | Value |\n`;
        message += `|---|---|\n`;
        message += `| **Pipeline** | ${definitionName || '-'} |\n`;
        message += `| **Build Number** | ${buildNum ? `[${buildNum}](${buildUrl})` : '-'} |\n`;
        message += `| **Repository** | ${repo || '-'} |\n`;
        message += `| **Branch** | \`${branch}\` |\n`;
        if (prId) {
            message += `| **PR ID** | [#${prId}](${prUrl}) |\n`;
            if (prTitle) message += `| **PR Title** | ${prTitle} |\n`;
            if (prAuthor) message += `| **PR Author** | ${prAuthor} |\n`;
        }
        if (requestedBy) {
            message += `| **Triggered by** | ${requestedBy} |\n`;
        }

        const myAppUrl = process.env.WEBSITE_HOSTNAME ? `https://${process.env.WEBSITE_HOSTNAME}` : '';
        const diagWebUrl = myAppUrl ? `${myAppUrl}/build-diagnostics.html?buildId=${buildId}` : '';
        if (diagWebUrl) {
            message += `\n🔗 **[เปิดดูหน้าวิเคราะห์บน Dashboard](${diagWebUrl})**\n\n`;
        }

        if (failMessage) {
            message += `${failMessage}`;
        }

        // --- Send to Teams ---
        const teamsWebhookUrl = process.env.TEAMS_WEBHOOK_URL;
        if (!teamsWebhookUrl) {
            context.log.warn('webhook: TEAMS_WEBHOOK_URL ไม่ได้ตั้งค่า — ข้ามการแจ้งเตือน Build Fail');
        } else {
            const eventKey = `teams:build-failed:${buildId}`;
            let alreadySent = false;
            try {
                const existing = await sp.getLogByEventKey(eventKey);
                if (existing.ok && existing.body && Array.isArray(existing.body.value) && existing.body.value.length > 0) {
                    alreadySent = true;
                }
            } catch (e) {
                context.log.warn(`webhook: failed to check duplicate for ${eventKey}:`, e.message);
            }

            if (alreadySent) {
                context.log(`webhook: Teams build failure notification for buildId=${buildId} already sent previously.`);
            } else {
                try {
                    const teamsResult = await notifyTeams(teamsWebhookUrl, message);
                    if (!teamsResult.ok) {
                        context.log.error(`webhook: Teams build failure notification status error ${teamsResult.status}: ${teamsResult.body}`);
                    } else {
                        context.log('webhook: Teams build failure notification ส่งสำเร็จ');
                        // บันทึก Log ลง SharePoint เพื่อระบุว่าส่งแจ้งเตือนแล้ว
                        try {
                            await sp.addLogItem(sp.buildLogFields({
                                prId: String(prId || 0),
                                action: 'Build Failed Alert',
                                user: requestedBy || 'System',
                                repository: repo,
                                prTitle: prTitle || `Build Failed Alert: ${definitionName} - ${buildNum}`,
                                targetBranch: branch,
                                result: `Alert Sent`,
                                reason: `Auto Teams notification sent for build ${buildId} from webhook.`,
                                source: 'Azure DevOps Webhook',
                                eventKey: eventKey
                            }));
                        } catch (spErr) {
                            context.log.warn('webhook: failed to log Teams notification to SharePoint:', spErr.message);
                        }
                    }
                } catch (err) {
                    context.log.error('webhook: Teams build failure notification ล้มเหลว:', err.message);
                }
            }
        }

        // --- Log to SharePoint ---
        try {
            await sp.addLogItem(sp.buildLogFields({
                prId: String(prId || 0),
                action: 'Build Failed',
                user: requestedBy || 'System',
                repository: repo,
                prTitle: prTitle || `Build Failed: ${definitionName} - ${buildNum}`,
                targetBranch: branch,
                result: `Build Failed (${buildResult})`,
                reason: `Pipeline ${definitionName} run ${buildNum} failed.`,
                source: 'Azure DevOps Webhook'
            }));
            context.log(`webhook: SharePoint build failed log recorded successfully`);
        } catch (err) {
            context.log.warn('webhook: SharePoint build failed log failed:', err.message);
        }

        context.res = { status: 200, body: 'OK (Build failure processed)' };
        return;
    }

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
