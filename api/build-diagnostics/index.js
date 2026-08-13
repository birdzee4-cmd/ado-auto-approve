/**
 * GET/POST /api/build-diagnostics
 *
 * ดึงประวัติ Timeline และ Log ของ Build ที่ล้มเหลวมาสแกนและทำการวิเคราะห์ปัญหา
 */

const ado = require('../shared/ado-client');
const diagnosticsService = require('../shared/build-diagnostics-service');
const sp = require('../shared/sharepoint-client');

module.exports = async function (context, req) {
  function jsonResponse(status, payload) {
    context.res = {
      status: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    };
  }

  function mdCell(value) {
    return String(value || '-').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  }

  function formatLocation(exactError) {
    if (!exactError || !exactError.file) return '';
    let location = exactError.file;
    if (exactError.line) {
      location += `:${exactError.line}`;
      if (exactError.column) location += `:${exactError.column}`;
    }
    return location;
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

    // ---- 3) ดึงและวิเคราะห์ Log ของ failed tasks ทั้งหมด ----
    const diagnosticInfo = await diagnosticsService.collectBuildDiagnostics(ado, buildId, { concurrency: 3 });
    if (!diagnosticInfo.ok && diagnosticInfo.reason === 'timeline_fetch_failed') {
      jsonResponse(502, {
        ok: false,
        error: 'Failed to fetch build timeline from Azure DevOps (HTTP ' + diagnosticInfo.status + ')'
      });
      return;
    }
    if (!diagnosticInfo.ok) {
      jsonResponse(404, {
        ok: false,
        error: 'No failed task with log link found in build timeline',
        hint: 'บิลด์นี้อาจถูกยกเลิก (Canceled) หรือขั้นตอนที่ล้มเหลวไม่มีการเก็บ Log'
      });
      return;
    }
    const failedTask = diagnosticInfo.failedTask;
    const diagnostics = diagnosticInfo.diagnostics;
    context.log(`build-diagnostics: analyzed ${diagnosticInfo.failedTasks.length} failed task(s), primary="${failedTask && failedTask.name || '-'}"`);

    // ---- 6) ส่ง Teams เฉพาะ explicit POST; GET ต้องไม่มี side effect ----
    const sendToTeams = String(req.method || 'GET').toUpperCase() === 'POST' && body.sendToTeams === true;
    const teamsWebhookUrl = process.env.TEAMS_WEBHOOK_URL;

    if (sendToTeams) {
      const teams = require('../shared/teams-notifier');
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

      let message = sendToTeams
        ? `## 🚨 Manual Diagnostics Sent: Build Failed Detected\n\n`
        : `## 🚨 Build Failed Detected (Auto-Diagnostics)\n\n`;
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

      const exactError = diagnostics.exactError || {};
      const exactLocation = formatLocation(exactError);
      const failedCommand = exactError.command || '';

      message += `### 🔍 วิเคราะห์สาเหตุหลัก\n`;
      message += `${diagnostics.rootCauseSummary || diagnostics.description || diagnostics.title}\n\n`;
      message += `| Field | Value |\n`;
      message += `|---|---|\n`;
      message += `| Failed Step | ${mdCell(failedTask.name)} |\n`;
      message += `| Root Cause Key | ${mdCell(diagnostics.errorKey)} |\n`;
      message += `| Analysis | ${mdCell(diagnostics.analyzerSource)} / ${mdCell(diagnostics.status)} / ${mdCell(diagnostics.confidence)} confidence |\n`;
      if (diagnostics.failureLayer) message += `| Failure Layer | ${mdCell(diagnostics.failureLayer)} |\n`;
      if (failedCommand) message += `| Failed Command | \`${mdCell(failedCommand)}\` |\n`;
      if (exactLocation) message += `| File | \`${mdCell(exactLocation)}\` |\n`;
      if (exactError.message) message += `| Message | ${mdCell(exactError.message)} |\n`;
      message += `\n`;

      const impactChain = Array.isArray(diagnostics.impactChain) ? diagnostics.impactChain : [];
      if (impactChain.length) {
        message += `### ผลกระทบต่อเนื่อง\n`;
        for (const impact of impactChain) {
          message += `- ${impact}\n`;
        }
        message += `\n`;
      }

      const warnings = Array.isArray(diagnostics.warnings) ? diagnostics.warnings : [];
      if (warnings.length) {
        message += `### คำเตือนที่ไม่ใช่สาเหตุหลัก\n`;
        for (const warning of warnings) {
          message += `- ${warning}\n`;
        }
        message += `\n`;
      }

      message += `### แนวทางแก้ไข\n`;
      for (const sol of diagnostics.solutions) {
        message += `* **${sol.title}**\n${sol.details}\n\n`;
      }

      const evidence = Array.isArray(diagnostics.evidence) ? diagnostics.evidence : [];
      if (evidence.length) {
        message += `### หลักฐานจาก Log (Sanitized Evidence)\n`;
        for (const item of evidence.slice(0, 8)) {
          message += `- ${mdCell(item.taskName || failedTask.name)} line ${mdCell(item.lineNumber)}: \`${mdCell(item.text)}\`\n`;
        }
        message += `\n`;
      }

      message += `💡 *หมายเหตุ: หลักฐานและ Log snippet ถูกปิดบัง credential ก่อนแสดงผล*\n\n`;

      try {
        const teamsResult = await teams.notifyTeams(teamsWebhookUrl, message);
        if (!teamsResult.ok) {
          jsonResponse(502, {
            ok: false,
            error: `Teams webhook returned status ${teamsResult.status}: ${teamsResult.body}`
          });
          return;
        }

        // บันทึก Log ลง SharePoint
        const eventKey = `teams:build-failed:${buildId}`;
        try {
          await sp.addLogItem(sp.buildLogFields({
            prId: String(prId || 0),
            action: sendToTeams ? 'Manual Diagnostics Sent' : 'Build Failed Alert',
            user: requestedBy || 'System',
            repository: repoName,
            prTitle: prTitle || `Build Failed Alert: ${definitionName} - ${buildNumber}`,
            targetBranch: branch,
            result: `Alert Sent`,
            reason: sendToTeams 
              ? `Manual Teams notification sent for build ${buildId} diagnostics.`
              : `Auto Teams notification sent for build ${buildId} diagnostics.`,
            source: sendToTeams ? 'Build Diagnostics UI' : 'Build Diagnostics Auto',
            eventKey: eventKey
          }));
        } catch (spErr) {
          context.log.warn('build-diagnostics: failed to log Teams notification to SharePoint:', spErr.message);
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
      failedTasks: diagnosticInfo.failedTasks,
      diagnostics: {
        matched: diagnostics.matched,
        errorKey: diagnostics.errorKey,
        failureLayer: diagnostics.failureLayer,
        title: diagnostics.title,
        description: diagnostics.description,
        rootCauseSummary: diagnostics.rootCauseSummary,
        exactError: diagnostics.exactError,
        impactChain: diagnostics.impactChain,
        warnings: diagnostics.warnings,
        solutions: diagnostics.solutions,
        snippet: diagnostics.snippet,
        startLineNumber: diagnostics.startLineNumber,
        status: diagnostics.status,
        analyzerSource: diagnostics.analyzerSource,
        confidence: diagnostics.confidence,
        primaryFailure: diagnostics.primaryFailure,
        evidence: diagnostics.evidence,
        causalChain: diagnostics.causalChain,
        wrapperErrors: diagnostics.wrapperErrors,
        missingInformation: diagnostics.missingInformation,
        failedTasks: diagnostics.failedTasks,
        redactionSummary: diagnostics.redactionSummary
      },
      analyzedAt: new Date().toISOString()
    });

  } catch (err) {
    context.log.error('Build diagnostics analysis failed:', err);
    jsonResponse(500, { ok: false, error: 'Unexpected server error', detail: err.message });
  }
};
