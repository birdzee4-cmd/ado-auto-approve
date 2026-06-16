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
 */

const sp = require('../shared/sharepoint-client');

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

    // 3) คำนวณช่วงเวลาเริ่มต้นและสิ้นสุดในรูปแบบ UTC เพื่อนำไป Query บน SharePoint
    let startUtc, endUtc;
    if (type === 'daily') {
      startUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMs);
      endUtc = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0) - offsetMs);
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

    const logs = logsResult.body && Array.isArray(logsResult.body.value) ? logsResult.body.value : [];
    
    // 5) คำนวณ Metrics สำหรับประวัติการอนุมัติ (PR & Action Summary)
    let totalActions = 0;
    let autoApproved = 0;
    let manualApproved = 0;
    let rejected = 0;
    let onHold = 0;

    const uniquePrs = new Set();
    const repoPrCount = {}; // repository -> Set of unique PRs

    logs.forEach(item => {
      const fields = item.fields || {};
      const prId = parseInt(fields.PR_ID, 10);
      
      // ข้าม Log ระบบ หรือการตั้งค่าอื่นๆ ที่ไม่ใช่ PR (PR_ID = 0)
      if (!prId || isNaN(prId)) return;

      totalActions++;
      uniquePrs.add(prId);

      const repo = (fields.Repository || 'Unknown').trim();
      if (repo && repo !== 'Daily Summary' && repo !== 'Daily Summary Test') {
        if (!repoPrCount[repo]) repoPrCount[repo] = new Set();
        repoPrCount[repo].add(prId);
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

    // 7) คัดกรองและประมวลผลข้อมูลการ Deploy ในช่วงเวลาที่เลือก
    let totalDeploys = 0;
    let succeededDeploys = 0;
    let failedDeploys = 0;
    let inProgressDeploys = 0;
    const repoFailedDeploys = {}; // repository -> count

    const startTs = startUtc.getTime();
    const endTs = endUtc.getTime();

    deployments.forEach(row => {
      const finishedTime = row.FinishedTime || '';
      const ts = Date.parse(finishedTime);
      if (isNaN(ts) || ts < startTs || ts >= endTs) return;

      totalDeploys++;
      const status = String(row.Status || '').toLowerCase();
      const repo = (row.RepoName || 'Unknown').trim();

      if (status === 'succeeded') {
        succeededDeploys++;
      } else if (status === 'failed' || status === 'canceled') {
        failedDeploys++;
        if (repo && repo !== 'Unknown') {
          repoFailedDeploys[repo] = (repoFailedDeploys[repo] || 0) + 1;
        }
      } else if (status === 'inprogress') {
        inProgressDeploys++;
      }
    });

    const deploySuccessRate = totalDeploys > 0 
      ? parseFloat(((succeededDeploys / totalDeploys) * 100).toFixed(2)) 
      : 0;

    // จัดอันดับ Top Repository ที่มี Build ล้มเหลวบ่อยสุด
    const topFailedRepos = Object.keys(repoFailedDeploys).map(repoName => ({
      repo: repoName,
      count: repoFailedDeploys[repoName]
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

    // 8) ส่งผลลัพธ์กลับไปหาหน้าเว็บ
    jsonResponse(200, {
      ok: true,
      type: type,
      year: year,
      month: month,
      day: type === 'daily' ? day : undefined,
      range: {
        start: startIso,
        end: endIso
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
      topFailedRepos: topFailedRepos
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
