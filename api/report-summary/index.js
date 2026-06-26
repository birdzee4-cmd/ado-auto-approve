/**
 * GET /api/report-summary
 *
 * ดึงข้อมูลประวัติการทำงาน (SharePoint List Logs) และประวัติการ Deploy ขึ้น Staging (CSV)
 * เพื่อคำนวณและสรุปข้อมูลสถิติตามช่วงเวลาที่กำหนด (รายเดือน หรือรายวัน)
 *
 * Query Parameters:
 *   type  = "monthly" (default) | "daily"
 *   year  = YYYY (e.g. 2026)
 *   month = MM (1-12)
 *   day   = DD (1-31, required only if type=daily)
 *   startTime = HH:mm (daily only, default 00:00)
 *   endTime   = HH:mm (daily only, default 23:59)
 */

const sp = require('../shared/sharepoint-client');
const auth = require('../shared/auth');
const ado = require('../shared/ado-client');

module.exports = async function (context, req) {
  function jsonResponse(status, payload) {
    context.res = {
      status: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    };
  }

  try {
    // 1) กำหนดค่าเวลาปัจจุบันในกรุงเทพฯ (GMT+7) เพื่อใช้เป็นค่าเริ่มต้นกรณีไม่ได้ระบุ params
    const offsetMs = 7 * 60 * 60 * 1000;
    const bkkNow = new Date(Date.now() + offsetMs);
    const defaultYear = bkkNow.getUTCFullYear();
    const defaultMonth = bkkNow.getUTCMonth() + 1;
    const defaultDay = bkkNow.getUTCDate();

    // 2) ดึงและตรวจสอบ Parameters
    const type = req.query.type === 'daily' ? 'daily' : 'monthly';
    const year = parseInt(req.query.year, 10) || defaultYear;
    const month = parseInt(req.query.month, 10) || defaultMonth;
    const day = parseInt(req.query.day, 10) || defaultDay;
    const startTime = type === 'daily' ? parseTimeOfDay(req.query.startTime || '00:00', '00:00', false) : null;
    const endTime = type === 'daily' ? parseTimeOfDay(req.query.endTime || '24:00', '24:00', true) : null;
    const actionScope = req.query.actionScope === 'mine' ? 'mine' : 'all';
    const buildScope = req.query.buildScope === 'related' ? 'related' : 'all';
    const principal = auth.parseClientPrincipal(req.headers);
    const currentUser = auth.getUserEmail(principal);
    const currentUserAliases = buildUserAliases(principal);

    if (isNaN(year) || year < 2000 || year > 2100) {
      jsonResponse(400, { ok: false, error: 'ปี (year) ที่ระบุไม่ถูกต้อง' });
      return;
    }
    if (isNaN(month) || month < 1 || month > 12) {
      jsonResponse(400, { ok: false, error: 'เดือน (month) ที่ระบุไม่ถูกต้อง' });
      return;
    }
    if (type === 'daily' && (isNaN(day) || day < 1 || day > 31)) {
      jsonResponse(400, { ok: false, error: 'วันที่ (day) ที่ระบุไม่ถูกต้อง' });
      return;
    }
    if (type === 'daily' && (!startTime || !endTime || timeToMinutes(startTime) >= timeToMinutes(endTime))) {
      jsonResponse(400, { ok: false, error: 'ช่วงเวลาไม่ถูกต้อง' });
      return;
    }

    // 3) คำนวณช่วงเวลาเริ่มต้นและสิ้นสุดในรูปแบบ UTC เพื่อนำไป Query บน SharePoint
    let startUtc, endUtc;
    if (type === 'daily') {
      startUtc = new Date(Date.UTC(year, month - 1, day, startTime.hour, startTime.minute, 0) - offsetMs);
      const endMinute = timeToMinutes(endTime);
      const endHour = Math.floor(endMinute / 60);
      const endMinutePart = endMinute % 60;
      endUtc = endMinute >= 24 * 60
        ? new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0) - offsetMs)
        : new Date(Date.UTC(year, month - 1, day, endHour, endMinutePart, 0) - offsetMs);
    } else {
      startUtc = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0) - offsetMs);
      endUtc = new Date(Date.UTC(year, month, 1, 0, 0, 0) - offsetMs);
    }

    const startIso = startUtc.toISOString();
    const endIso = endUtc.toISOString();

    context.log(`Fetching report summary [${type}] for ${year}-${month}${type === 'daily' ? '-' + day : ''} (UTC range: ${startIso} to ${endIso})`);

    // 4) ดึง Log การทำรายการจาก SharePoint List ตามช่วงเวลา
    // ดึงสูงสุด 2,000 รายการเพื่อป้องกันการค้าง
    const logsResult = await sp.getLogItemsRange(startIso, endIso, 2000);
    if (!logsResult.ok) {
      throw new Error(`Failed to query SharePoint logs: HTTP ${logsResult.status}`);
    }

    const allLogs = logsResult.body && Array.isArray(logsResult.body.value) ? logsResult.body.value : [];
    const logs = actionScope === 'mine'
      ? allLogs.filter(item => isSameUser(item && item.fields && item.fields.User, currentUserAliases))
      : allLogs;
    
    // 5) คำนวณ Metrics สำหรับประวัติการอนุมัติ (PR & Action Summary)
    let totalActions = 0;
    let autoApproved = 0;
    let manualApproved = 0;
    let rejected = 0;
    let onHold = 0;

    const uniquePrs = new Set();
    const repoPrCount = {}; // repository -> Set of unique PRs
    const relatedPrIds = new Set();
    const relatedRepoKeys = new Set();

    logs.forEach(item => {
      const fields = item.fields || {};
      const prId = parseInt(fields.PR_ID, 10);
      
      // ข้าม Log ระบบ หรือการตั้งค่าอื่นๆ ที่ไม่ใช่ PR (PR_ID = 0)
      if (!prId || isNaN(prId)) return;

      totalActions++;
      uniquePrs.add(prId);
      relatedPrIds.add(String(prId));

      const repo = (fields.Repository || 'Unknown').trim();
      if (repo && repo !== 'Daily Summary' && repo !== 'Daily Summary Test') {
        if (!repoPrCount[repo]) repoPrCount[repo] = new Set();
        repoPrCount[repo].add(prId);
        relatedRepoKeys.add(normalizeRepoKey(repo));
      }

      const action = String(fields.Action || '').toLowerCase();
      if (action.includes('auto approved') || action.includes('autoapproved')) {
        autoApproved++;
      } else if (action.includes('approved')) {
        manualApproved++;
      } else if (action.includes('reject')) {
        rejected++;
      } else if (action.includes('hold')) {
        onHold++;
      }
    });

    const totalApproved = autoApproved + manualApproved;
    const autoApproveRate = totalApproved > 0 ? parseFloat(((autoApproved / totalApproved) * 100).toFixed(2)) : 0;

    // จัดอันดับ Repository ยอดนิยมที่มีการสร้าง PR เมิร์จมากที่สุด (Top Active)
    const topActiveRepos = Object.keys(repoPrCount).map(repoName => ({
      repo: repoName,
      count: repoPrCount[repoName].size
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

    // 6) ดึงข้อมูลประวัติการ Deploy บน Staging จากไฟล์ CSV ย้อนหลัง
    const deployHistoryFilePath = `deploy-history/stg-deployments-${year}.csv`;
    let deployments = [];

    context.log(`Downloading deployment CSV for builds: ${deployHistoryFilePath}...`);
    const csvResult = await sp.downloadArchiveFile(deployHistoryFilePath);
    
    if (csvResult.ok) {
      const csvText = typeof csvResult.body === 'string' ? csvResult.body : JSON.stringify(csvResult.body);
      deployments = parseCsv(csvText);
    } else if (csvResult.status === 404) {
      context.log.warn(`Staging deployments CSV not found for year ${year}. Proceeding with empty deployment stats.`);
    } else {
      context.log.error(`SharePoint returned HTTP ${csvResult.status} when fetching ${deployHistoryFilePath}`);
    }

    if (type === 'daily') {
      try {
        const liveDeployments = await fetchLiveDeployments(context, startIso, endIso);
        deployments = mergeDeploymentRows(deployments, liveDeployments);
        context.log(`Merged live daily ADO builds into report data: ${liveDeployments.length} live rows, ${deployments.length} total rows.`);
      } catch (e) {
        context.log.warn('Live daily build enrichment skipped: ' + e.message);
      }
    }

    // 7) คัดกรองและประมวลผลข้อมูลการ Deploy ในช่วงเวลาที่เลือก
    let totalDeploys = 0;
    let succeededDeploys = 0;
    let failedDeploys = 0;
    let inProgressDeploys = 0;
    const repoFailedDeploys = {}; // normalized repository -> { repo, count }
    const failedDeployItems = [];

    const startTs = startUtc.getTime();
    const endTs = endUtc.getTime();

    deployments.forEach(row => {
      const pipelineName = (row.PipelineName || '').toLowerCase();
      if (pipelineName.includes('schedule') || pipelineName.includes('scripts')) return;
      if (!isStagingDeploymentRow(row)) return;

      const finishedTime = row.FinishedTime || '';
      const ts = Date.parse(finishedTime);
      if (isNaN(ts) || ts < startTs || ts >= endTs) return;
      if (buildScope === 'related' && !isDeploymentRelatedToReport(row, relatedPrIds, relatedRepoKeys)) return;

      totalDeploys++;
      const status = String(row.Status || '').toLowerCase();
      const repo = getDeploymentRepoName(row);

      if (status === 'succeeded') {
        succeededDeploys++;
      } else if (isFailedStatus(status)) {
        failedDeploys++;
        if (repo && repo !== 'Unknown') {
          const repoKey = normalizeRepoKey(repo);
          if (!repoFailedDeploys[repoKey]) {
            repoFailedDeploys[repoKey] = { repo: repo, count: 0 };
          }
          repoFailedDeploys[repoKey].count += 1;
        }
        failedDeployItems.push(buildFailedDeployItem(row));
      } else if (status === 'inprogress') {
        inProgressDeploys++;
      }
    });

    const deploySuccessRate = totalDeploys > 0 
      ? parseFloat(((succeededDeploys / totalDeploys) * 100).toFixed(2)) 
      : 0;

    // จัดอันดับ Top Repository ที่มี Build ล้มเหลวบ่อยสุด
    const topFailedRepos = Object.values(repoFailedDeploys)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

    // 8) ส่งผลลัพธ์กลับไปหาหน้าเว็บ
    jsonResponse(200, {
      ok: true,
      type: type,
      year: year,
      month: month,
      day: type === 'daily' ? day : undefined,
      startTime: type === 'daily' ? formatTimeOfDay(startTime) : undefined,
      endTime: type === 'daily' ? formatTimeOfDay(endTime) : undefined,
      range: {
        start: startIso,
        end: endIso
      },
      scope: {
        actionScope: actionScope,
        buildScope: buildScope,
        user: actionScope === 'mine' ? currentUser : '',
        relatedPrCount: relatedPrIds.size,
        relatedRepoCount: relatedRepoKeys.size
      },
      stats: {
        totalPrs: uniquePrs.size,
        totalActions: totalActions,
        autoApproved: autoApproved,
        manualApproved: manualApproved,
        rejected: rejected,
        onHold: onHold,
        autoApproveRate: autoApproveRate,
        totalDeploys: totalDeploys,
        succeededDeploys: succeededDeploys,
        failedDeploys: failedDeploys,
        inProgressDeploys: inProgressDeploys,
        deploySuccessRate: deploySuccessRate
      },
      topActiveRepos: topActiveRepos,
      topFailedRepos: topFailedRepos,
      failedDeployItems: failedDeployItems
        .sort((a, b) => (Date.parse(b.finishedTime || '') || 0) - (Date.parse(a.finishedTime || '') || 0))
        .slice(0, 10)
    });

  } catch (err) {
    context.log.error('Failed to generate report summary:', err);
    jsonResponse(500, {
      ok: false,
      error: 'Failed to retrieve report data',
      detail: err && err.message ? err.message : String(err)
    });
  }
};

/**
 * ฟังก์ชันสำหรับแยกวิเคราะห์ CSV (CSV Parser) แบบมาตรฐาน
 */
function parseCsv(csvText) {
  if (!csvText) return [];
  
  const lines = [];
  let row = [''];
  let inQuotes = false;
  
  if (csvText.startsWith('\uFEFF')) {
    csvText = csvText.substring(1);
  }

  for (let i = 0; i < csvText.length; i++) {
    const c = csvText[i];
    const next = csvText[i + 1];

    if (c === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      row.push('');
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') {
        i++;
      }
      lines.push(row);
      row = [''];
    } else {
      row[row.length - 1] += c;
    }
  }

  if (row.length > 1 || row[0] !== '') {
    lines.push(row);
  }
  
  if (lines.length === 0) return [];

  const headers = lines[0].map(h => h.trim());
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i];
    if (values.length < headers.length) continue; 
    
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = (values[j] || '').trim();
    }
    data.push(obj);
  }

  return data;
}

function isSameUser(logUser, currentUserAliases) {
  const left = normalizeUser(logUser);
  const aliases = Array.isArray(currentUserAliases) ? currentUserAliases : [currentUserAliases];
  return !!left && aliases.some(alias => left === normalizeUser(alias));
}

function parseTimeOfDay(value, fallback, allowEndOfDay) {
  const text = String(value || fallback || '').trim();
  if (allowEndOfDay && text === '24:00') {
    return { hour: 24, minute: 0 };
  }
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return {
    hour: Number(match[1]),
    minute: Number(match[2])
  };
}

function timeToMinutes(value) {
  return (Number(value && value.hour) || 0) * 60 + (Number(value && value.minute) || 0);
}

function formatTimeOfDay(value) {
  const hour = String(value && value.hour || 0).padStart(2, '0');
  const minute = String(value && value.minute || 0).padStart(2, '0');
  return hour + ':' + minute;
}

function normalizeUser(value) {
  return String(value || '').trim().toLowerCase();
}

function buildUserAliases(principal) {
  const aliases = new Set();
  if (principal && principal.userDetails) aliases.add(principal.userDetails);
  const claims = principal && Array.isArray(principal.claims) ? principal.claims : [];
  const usefulClaimNames = new Set([
    'name',
    'emails',
    'preferred_username',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    'http://schemas.microsoft.com/identity/claims/displayname'
  ]);
  claims.forEach(claim => {
    const typ = String(claim && claim.typ || '').toLowerCase();
    if (usefulClaimNames.has(typ) && claim && claim.val) aliases.add(claim.val);
  });
  return Array.from(aliases).filter(Boolean);
}

function isDeploymentRelatedToReport(row, relatedPrIds, relatedRepoKeys) {
  if (!relatedPrIds || relatedPrIds.size === 0) return false;
  const candidates = getDeploymentPrCandidates(row);
  if (candidates.some(value => value && relatedPrIds.has(String(value)))) return true;

  const hasPrSignal = candidates.some(Boolean);
  if (hasPrSignal) return false;

  const repoKey = normalizeRepoKey(getDeploymentRepoName(row));
  return !!repoKey && relatedRepoKeys && relatedRepoKeys.has(repoKey);
}

function getDeploymentPrCandidates(row) {
  return [
    row.PrId,
    row.PR_ID,
    row.PullRequestId,
    row.PullRequest,
    extractPrId(row.Branch),
    extractPrId(row.CommitMessage),
    extractPrId(row.BuildTags),
    extractPrId(row.AdoBuildUrl)
  ];
}

async function fetchLiveDeployments(context, startIso, endIso) {
  const result = await ado.listBuilds({
    minTime: startIso,
    maxTime: endIso,
    top: 1000
  });
  if (!result.ok || !result.body || !Array.isArray(result.body.value)) {
    throw new Error('ADO live build lookup returned HTTP ' + result.status);
  }

  const rows = result.body.value
    .filter(isStagingBuild)
    .map(mapBuildToDeploymentRow);
  if (context && context.log) {
    const failed = rows.filter(row => isFailedStatus(row.Status)).length;
    context.log(`Live daily staging builds fetched: ${rows.length}, failed/canceled: ${failed}`);
  }
  return rows;
}

function mergeDeploymentRows(existingRows, liveRows) {
  const map = new Map();
  for (const row of Array.isArray(existingRows) ? existingRows : []) {
    map.set(getDeploymentKey(row), row);
  }
  for (const row of Array.isArray(liveRows) ? liveRows : []) {
    map.set(getDeploymentKey(row), row);
  }
  return Array.from(map.values());
}

function getDeploymentKey(row) {
  const buildId = extractBuildId(row && row.AdoBuildUrl) || row && row.BuildId || '';
  if (buildId) return 'build:' + buildId;
  return [
    row && row.PipelineName || '',
    row && row.BuildNumber || '',
    row && row.FinishedTime || ''
  ].join('|').toLowerCase();
}

function isStagingBuild(build) {
  const pipelineName = String(build && build.definition && build.definition.name || '').toLowerCase();
  if (pipelineName.includes('schedule') || pipelineName.includes('scripts')) return false;
  return isStagingBranchName(build && build.sourceBranch);
}

function isStagingDeploymentRow(row) {
  const pipelineName = String(row && row.PipelineName || '').toLowerCase();
  if (pipelineName.includes('schedule') || pipelineName.includes('scripts')) return false;
  return isStagingBranchName(row && row.Branch);
}

function isStagingBranchName(value) {
  const text = String(value || '').trim().toLowerCase();
  const clean = text.replace(/^refs\/heads\//, '');
  return clean === 'staging' ||
    clean.startsWith('staging/') ||
    clean === 'stg' ||
    clean.startsWith('stg/');
}

function mapBuildToDeploymentRow(build) {
  const pipelineName = build && build.definition && build.definition.name || '';
  const status = String(build && build.status || '');
  const result = String(build && build.result || '');
  return {
    PipelineName: pipelineName,
    RepoName: build && build.repository && build.repository.name || inferRepoNameFromPipeline(pipelineName),
    Branch: build && build.sourceBranch ? String(build.sourceBranch).replace('refs/heads/', '') : '',
    Environment: 'Staging',
    PrId: build && build.triggerInfo && (build.triggerInfo['pr.number'] || build.triggerInfo['pr.id']) || '',
    BuildNumber: build && build.buildNumber || '',
    Status: normalizeBuildStatus(status, result),
    FinishedTime: build && (build.finishTime || build.queueTime || build.startTime) || '',
    TriggeredBy: build && build.requestedFor && build.requestedFor.displayName || '',
    CommitHash: build && build.sourceVersion || '',
    CommitMessage: build && build.triggerInfo && (build.triggerInfo['ci.message'] || build.triggerInfo['wip.message']) || '',
    BuildTags: build && Array.isArray(build.tags) ? build.tags.join(', ') : '',
    AdoBuildUrl: build && build._links && build._links.web && build._links.web.href || '',
    BuildId: build && build.id || ''
  };
}

function normalizeBuildStatus(status, result) {
  const statusText = String(status || '').toLowerCase();
  const resultText = String(result || '').toLowerCase();
  if (statusText === 'completed') {
    if (resultText === 'succeeded') return 'Succeeded';
    if (resultText === 'failed') return 'Failed';
    if (resultText === 'canceled') return 'Canceled';
    if (resultText === 'partiallysucceeded') return 'Partially Succeeded';
    return result || status || '';
  }
  if (statusText === 'inprogress') return 'InProgress';
  return status || '';
}

function isFailedStatus(status) {
  const value = String(status || '').toLowerCase();
  return value === 'failed' || value === 'canceled';
}

function buildFailedDeployItem(row) {
  return {
    prId: row.PrId || row.PR_ID || row.PullRequestId || extractPrId(row.Branch) || extractPrId(row.CommitMessage) || '',
    repo: getDeploymentRepoName(row),
    branch: row.Branch || '',
    status: row.Status || '',
    buildNumber: row.BuildNumber || '',
    finishedTime: row.FinishedTime || '',
    triggeredBy: row.TriggeredBy || '',
    buildUrl: row.AdoBuildUrl || ''
  };
}

function extractBuildId(value) {
  const text = String(value || '');
  const match = text.match(/[?&]buildId=(\d+)/i) || text.match(/\/build\/results\?buildId=(\d+)/i);
  return match ? match[1] : '';
}

function extractPrId(value) {
  const text = String(value || '');
  const patterns = [
    /pullrequest\/(\d+)/i,
    /pull request[^\d]*(\d+)/i,
    /\bpr[ #:_-]*(\d+)\b/i,
    /refs\/pull\/(\d+)\//i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return '';
}

function getDeploymentRepoName(row) {
  const direct = String(row && row.RepoName || '').trim();
  if (direct) return direct;
  const inferred = inferRepoNameFromPipeline(row && row.PipelineName);
  return inferred || 'Unknown';
}

function normalizeRepoKey(repoName) {
  return String(repoName || '')
    .trim()
    .toLowerCase()
    .replace(/^refs\/heads\//, '')
    .replace(/^(stg|ph|vn|my|id)[_\s-]+/i, '')
    .replace(/[_\s-]+docker-ci$/i, '')
    .replace(/[_\s-]+ci$/i, '')
    .replace(/[_\s-]+/g, ' ');
}

function inferRepoNameFromPipeline(pipelineName) {
  return String(pipelineName || '')
    .replace(/^(STG|PH|VN|MY|ID)_/i, '')
    .replace(/_docker-CI$/i, '')
    .replace(/-CI$/i, '')
    .trim();
}
