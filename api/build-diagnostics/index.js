/**
 * GET/POST /api/build-diagnostics
 *
 * ดึงประวัติ Timeline และ Log ของ Build ที่ล้มเหลวมาสแกนและทำการวิเคราะห์ปัญหา
 */

const ado = require('../shared/ado-client');
const catalog = require('../shared/build-diagnostics-catalog');

module.exports = async function (context, req) {
  function jsonResponse(status, payload) {
    context.res = {
      status: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    };
  }

  try {
    // ---- 1) ตรวจสอบความถูกต้องของการ Authentication ----
    if (!req.headers || !req.headers['x-ms-client-principal']) {
      jsonResponse(401, { ok: false, error: 'Authentication required' });
      return;
    }

    // ---- 2) ตรวจสอบพารามิเตอร์ buildId ----
    const query = req.query || {};
    const body = req.body || {};
    const buildId = query.buildId || body.buildId;

    if (!buildId) {
      jsonResponse(400, { ok: false, error: 'Parameter buildId is required' });
      return;
    }

    context.log(`build-diagnostics: analyzing buildId=${buildId}`);

    // ---- 3) เรียกดึง Timeline ของ Build จาก ADO ----
    const timelineResult = await ado.getBuildTimeline(buildId);
    if (!timelineResult.ok) {
      jsonResponse(502, {
        ok: false,
        error: 'Failed to fetch build timeline from Azure DevOps (HTTP ' + timelineResult.status + ')',
        detail: JSON.stringify(timelineResult.body).substring(0, 500)
      });
      return;
    }

    const records = timelineResult.body && Array.isArray(timelineResult.body.records)
      ? timelineResult.body.records
      : [];

    // ค้นหาขั้นตอนที่รันล้มเหลว (Task ที่มีความเป็นจริงว่าล้มเหลวตัวแรก)
    const failedTask = records.find(r => r && r.state === 'completed' && r.result === 'failed' && r.log);
    
    if (!failedTask) {
      jsonResponse(404, {
        ok: false,
        error: 'No failed task with log link found in build timeline',
        hint: 'บิลด์นี้อาจถูกยกเลิก (Canceled) หรือขั้นตอนที่ล้มเหลวไม่มีการเก็บ Log'
      });
      return;
    }

    context.log(`build-diagnostics: found failed task "${failedTask.name}", logId=${failedTask.log.id}`);

    // ---- 4) ดึงเนื้อหา Log ดิบของขั้นตอนที่ล้มเหลว ----
    const logResult = await ado.getBuildLog(buildId, failedTask.log.id);
    if (!logResult.ok) {
      jsonResponse(502, {
        ok: false,
        error: 'Failed to fetch build task log content from Azure DevOps (HTTP ' + logResult.status + ')',
        detail: String(logResult.body).substring(0, 500)
      });
      return;
    }

    let rawLogText = '';
    if (typeof logResult.body === 'string') {
      rawLogText = logResult.body;
    } else if (logResult.body && Array.isArray(logResult.body.value)) {
      rawLogText = logResult.body.value.join('\n');
    } else {
      rawLogText = JSON.stringify(logResult.body);
    }

    // ---- 5) วิเคราะห์ปัญหาผ่านระบบ Catalog ----
    const diagnostics = catalog.diagnoseLog(rawLogText);

    // ---- 6) ส่งแจ้งเตือนเข้า Teams หากมีการร้องขอ ----
    const sendToTeams = query.sendToTeams === 'true' || body.sendToTeams === true;
    if (sendToTeams) {
      const teams = require('../shared/teams-notifier');
      const teamsWebhookUrl = process.env.TEAMS_WEBHOOK_URL;
      if (!teamsWebhookUrl) {
        jsonResponse(500, { ok: false, error: 'TEAMS_WEBHOOK_URL is not configured' });
        return;
      }

      // ดึงรายละเอียดของ Build เพิ่มเติมจาก ADO เพื่อความสวยงามในรายงาน
      const cfg = ado.getConfig();
      const buildDetailResult = await ado.adoRequest('GET', `/${encodeURIComponent(cfg.org)}/${encodeURIComponent(cfg.project)}/_apis/build/builds/${buildId}?api-version=6.0`);
      
      let buildNumber = '';
      let definitionName = '';
      let repoName = '';
      let branch = '';
      let requestedBy = '';
      let buildUrl = '';

      if (buildDetailResult.ok && buildDetailResult.body) {
        const b = buildDetailResult.body;
        buildNumber = b.buildNumber || '';
        definitionName = b.definition && b.definition.name || '';
        repoName = b.repository && b.repository.name || '';
        branch = b.sourceBranch || '';
        requestedBy = b.requestedFor && b.requestedFor.displayName || '';
        buildUrl = b._links && b._links.web && b._links.web.href || '';
      }

      let prId = '';
      if (buildDetailResult.ok && buildDetailResult.body && buildDetailResult.body.triggerInfo && buildDetailResult.body.triggerInfo['pr.number']) {
        prId = buildDetailResult.body.triggerInfo['pr.number'];
      } else if (branch) {
        const match = branch.match(/refs\/pull\/(\d+)/);
        if (match) prId = match[1];
      }

      let prTitle = '';
      let prAuthor = '';
      let prUrl = '';
      if (prId) {
        try {
          const prRes = await ado.getPullRequest(prId);
          if (prRes.ok && prRes.body) {
            const pr = prRes.body;
            prTitle = pr.title || '';
            prAuthor = (pr.createdBy || {}).displayName || '';
            prUrl = `https://dev.azure.com/${encodeURIComponent(cfg.org)}/${encodeURIComponent(cfg.project)}/_git/${encodeURIComponent(repoName || (pr.repository || {}).name)}/pullrequest/${prId}`;
          }
        } catch (e) {
          // Ignore
        }
      }

      let message = `## 🚨 Manual Diagnostics Sent: Build Failed Detected\n\n`;
      message += `| Field | Value |\n`;
      message += `|---|---|\n`;
      message += `| **Pipeline** | ${definitionName || '-'} |\n`;
      message += `| **Build Number** | ${buildNumber ? `[${buildNumber}](${buildUrl})` : '-'} |\n`;
      message += `| **Repository** | ${repoName || '-'} |\n`;
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

      message += `### 🔍 วิเคราะห์ปัญหา (Diagnostics)\n`;
      message += `**ปัญหา:** ${diagnostics.title}\n\n`;
      message += `**รายละเอียด:** ${diagnostics.description}\n\n`;
      message += `#### 🛠️ แนวทางแก้ไข\n`;
      for (const sol of diagnostics.solutions) {
        message += `* **${sol.title}**\n${sol.details}\n\n`;
      }
      message += `#### 📋 ข้อผิดพลาดดิบจาก Log (Failed Task: ${failedTask.name})\n`;
      message += `\`\`\`text\n${diagnostics.snippet}\n\`\`\`\n\n`;

      try {
        const teamsResult = await teams.notifyTeams(teamsWebhookUrl, message);
        if (!teamsResult.ok) {
          jsonResponse(502, {
            ok: false,
            error: `Teams webhook returned status ${teamsResult.status}: ${teamsResult.body}`
          });
          return;
        }
      } catch (err) {
        jsonResponse(502, { ok: false, error: 'Failed to notify Teams: ' + err.message });
        return;
      }
    }

    // ---- 7) ส่งคำตอบกลับ ----
    jsonResponse(200, {
      ok: true,
      buildId: String(buildId),
      failedTask: {
        id: failedTask.id,
        name: failedTask.name,
        type: failedTask.type,
        startTime: failedTask.startTime,
        finishTime: failedTask.finishTime
      },
      diagnostics: {
        matched: diagnostics.matched,
        errorKey: diagnostics.errorKey,
        title: diagnostics.title,
        description: diagnostics.description,
        solutions: diagnostics.solutions,
        snippet: diagnostics.snippet,
        startLineNumber: diagnostics.startLineNumber
      },
      analyzedAt: new Date().toISOString()
    });

  } catch (err) {
    context.log.error('Build diagnostics analysis failed:', err);
    jsonResponse(500, { ok: false, error: 'Unexpected server error', detail: err.message });
  }
};
