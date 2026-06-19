/**
 * GET/POST /api/sync-deployments
 *
 * ดึงข้อมูลประวัติการ Build ของ Staging ทั้งหมดจาก Azure DevOps 
 * แปลงเป็น CSV และบันทึกแยกตามปีปฏิทินไปที่ SharePoint Document Library
 */

const { getConfig, adoRequest } = require('../shared/ado-client');
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
    // Auth validation (Support both authenticated user session and Logic App token)
    const hasClientPrincipal = !!(req.headers['x-ms-client-principal'] || req.headers['X-MS-CLIENT-PRINCIPAL']);
    const token = req.headers['x-daily-summary-token'] || req.headers['x-sync-token'] || (req.query && req.query.token);
    const isValidToken = token && token === process.env.DAILY_SUMMARY_TOKEN;

    if (!hasClientPrincipal && !isValidToken) {
      jsonResponse(401, { ok: false, error: 'Authentication required' });
      return;
    }

    // 1) โหลดและตรวจสอบ configuration
    const config = getConfig(); // throws if missing org/project/pat
    const org = config.org;
    const project = config.project;

    context.log(`Starting Staging deployment sync for ${org}/${project}...`);

    // 2) ดึงข้อมูลการ Build ย้อนหลังแบบ Pagination
    let allBuilds = [];
    let maxTime = null;
    let hasMore = true;
    let page = 0;
    const maxPages = 5; // ป้องกัน infinite loop ดึงสูงสุด 5,000 builds
    const lookbackDays = 90; // กรองประวัติย้อนหลัง 90 วัน เพื่อความเร็วในการรัน ป้องกัน timeout
    const minTime = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

    while (hasMore && page < maxPages) {
      let path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/build/builds?queryOrder=queueTimeDescending&$top=1000&minTime=${encodeURIComponent(minTime)}&api-version=7.0`;
      if (maxTime) {
        path += `&maxTime=${encodeURIComponent(maxTime)}`;
      }

      context.log(`Fetching page ${page + 1}...`);
      const result = await adoRequest('GET', path);
      if (!result.ok) {
        throw new Error(`ADO API returned HTTP ${result.status}: ${JSON.stringify(result.body)}`);
      }

      const pageBuilds = result.body && Array.isArray(result.body.value) ? result.body.value : [];
      if (pageBuilds.length === 0) {
        break;
      }

      allBuilds.push(...pageBuilds);

      // หาเวลาการ Build ที่เก่าที่สุดในหน้านี้เพื่อนำไป query หน้าถัดไป
      const oldest = pageBuilds[pageBuilds.length - 1];
      const oldestTime = oldest.queueTime || oldest.startTime;
      if (oldestTime) {
        maxTime = oldestTime;
      } else {
        break;
      }

      // ถ้าในหน้าปัจจุบันมีผลลัพธ์น้อยกว่า $top แปลว่าไม่มีหน้าถัดไปแล้ว
      if (pageBuilds.length < 1000) {
        hasMore = false;
      }
      page++;
    }

    // กรองเอาเฉพาะข้อมูลที่ไม่ซ้ำ (De-duplicate by ID)
    const seen = new Set();
    const uniqueBuilds = [];
    for (const b of allBuilds) {
      if (b && b.id && !seen.has(b.id)) {
        seen.add(b.id);
        uniqueBuilds.push(b);
      }
    }

    context.log(`Total builds fetched: ${uniqueBuilds.length}`);

    // 3) กรองเฉพาะประวัติการ Build ที่มีคำว่า 'stg' (Case-insensitive) และไม่ใช่พวก schedule / devops scripts ของระบบ
    const filteredBuilds = uniqueBuilds.filter(b => {
      const pipelineName = (b.definition && b.definition.name || '').toLowerCase();
      if (!pipelineName.includes('stg')) return false;
      if (pipelineName.includes('schedule') || pipelineName.includes('scripts')) return false;
      return true;
    });

    context.log(`Staging builds count: ${filteredBuilds.length}`);

    // Group builds by Year
    const buildsByYear = {};
    for (const b of filteredBuilds) {
      const finishedTime = b.finishTime || b.queueTime || b.startTime || '';
      let year = 'Unknown';
      if (finishedTime) {
        const date = new Date(finishedTime);
        if (!isNaN(date.getTime())) {
          year = String(date.getFullYear());
        }
      }
      if (!buildsByYear[year]) {
        buildsByYear[year] = [];
      }
      buildsByYear[year].push(b);
    }

    const years = Object.keys(buildsByYear).filter(y => y !== 'Unknown');
    const headers = [
      'PipelineName', 'RepoName', 'Branch', 'Environment', 'PrId', 'BuildNumber',
      'Status', 'FinishedTime', 'TriggeredBy', 'CommitHash', 'CommitMessage',
      'BuildTags', 'AdoBuildUrl'
    ];

    function escapeCsvValue(val) {
      if (val === null || val === undefined) return '';
      let str = String(val).replace(/"/g, '""');
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str}"`;
      }
      return str;
    }

    // Process each year's data
    for (const year of years) {
      const filePath = `deploy-history/stg-deployments-${year}.csv`;
      let existingRows = [];

      // ดาวน์โหลดไฟล์ปีนั้นจาก SharePoint มาผสาน
      context.log(`Downloading existing file from SharePoint for year ${year}: ${filePath}...`);
      const dlResult = await sp.downloadArchiveFile(filePath);
      if (dlResult.ok) {
        const csvText = typeof dlResult.body === 'string' ? dlResult.body : JSON.stringify(dlResult.body);
        const parsedRows = parseCsv(csvText);
        existingRows = parsedRows.filter(row => {
          const pipelineName = (row.PipelineName || '').toLowerCase();
          return !pipelineName.includes('schedule') && !pipelineName.includes('scripts');
        });
      }

      // แปลงข้อมูลใหม่เป็น object format
      const definitionRepoCache = {};
      const newMappedRows = [];
      for (const b of buildsByYear[year]) {
        const pipelineName = b.definition && b.definition.name || '';
        const repoName = b.repository && b.repository.name ||
          await getRepositoryNameFromDefinition(b.definition && b.definition.id, definitionRepoCache) ||
          inferRepoNameFromPipeline(pipelineName);
        const cleanBranch = b.sourceBranch ? b.sourceBranch.replace('refs/heads/', '') : '';
        const status = b.status || '';
        const result = b.result || '';
        
        let displayStatus = status;
        if (status === 'completed') {
          if (result === 'succeeded') displayStatus = 'Succeeded';
          else if (result === 'failed') displayStatus = 'Failed';
          else if (result === 'canceled') displayStatus = 'Canceled';
          else if (result === 'partiallySucceeded') displayStatus = 'Partially Succeeded';
          else displayStatus = result;
        } else if (status === 'inProgress') {
          displayStatus = 'InProgress';
        }

        const finishedTime = b.finishTime || b.queueTime || '';
        const triggeredBy = b.requestedFor && b.requestedFor.displayName || '';
        const commitHash = b.sourceVersion || '';
        const commitMessage = b.triggerInfo && (b.triggerInfo['ci.message'] || b.triggerInfo['wip.message']) || '';
        const prId = b.triggerInfo && (b.triggerInfo['pr.number'] || b.triggerInfo['pr.id']) || '';
        const tags = b.tags ? b.tags.join(', ') : '';
        const buildUrl = b._links && b._links.web && b._links.web.href || '';

        const mappedRow = {
          PipelineName: pipelineName,
          RepoName: repoName,
          Branch: cleanBranch,
          Environment: 'Staging',
          PrId: prId,
          BuildNumber: b.buildNumber || '',
          Status: displayStatus,
          FinishedTime: finishedTime,
          TriggeredBy: triggeredBy,
          CommitHash: commitHash,
          CommitMessage: commitMessage,
          BuildTags: tags,
          AdoBuildUrl: buildUrl
        };
        newMappedRows.push(mappedRow);
      }

      // Merge และ De-duplicate ตาม PipelineName + BuildNumber
      const mergedMap = new Map();
      for (const row of existingRows) {
        const key = `${row.PipelineName}_${row.BuildNumber}`;
        mergedMap.set(key, row);
      }
      for (const row of newMappedRows) {
        const key = `${row.PipelineName}_${row.BuildNumber}`;
        mergedMap.set(key, row);
      }

      const mergedRows = Array.from(mergedMap.values());
      mergedRows.sort((a, b) => new Date(b.FinishedTime) - new Date(a.FinishedTime));

      // สร้าง CSV content
      const csvLines = mergedRows.map(row => {
        return headers.map(h => escapeCsvValue(row[h])).join(',');
      });
      const csvContent = '\uFEFF' + [headers.join(','), ...csvLines].join('\n');

      // อัปโหลดไฟล์ปีนั้นกลับไปที่ SharePoint
      context.log(`Uploading year file to SharePoint: ${filePath}...`);
      const uploadResult = await sp.uploadArchiveFile(filePath, csvContent, 'text/csv; charset=utf-8');
      if (!uploadResult.ok) {
        throw new Error(`SharePoint upload for ${filePath} returned HTTP ${uploadResult.status}`);
      }
    }

    // 5) อัปเดตไฟล์หลัก stg-deployments.csv เพื่อความเข้ากันได้แบบ Backward Compatibility
    context.log('Updating legacy stg-deployments.csv...');
    const legacyPath = 'deploy-history/stg-deployments.csv';
    
    // โหลดประวัติทั้งหมดมารวมกัน (ดึงเฉพาะปีหลักๆ หรือปีปัจจุบันและปีก่อนหน้า เช่น 2026, 2025)
    // เพื่อไม่ให้ไฟล์ stg-deployments.csv ใหญ่เกินไป เราจะดึงไฟล์ของทุกปีมารวมกัน แล้วตัดเอาเฉพาะล่าสุด 1000 รายการ
    const currentYear = new Date().getFullYear();
    const activeYears = [currentYear, currentYear - 1]; // รวมปีปัจจุบันและปีที่แล้ว
    const allCombinedRows = [];

    for (const y of activeYears) {
      const yearPath = `deploy-history/stg-deployments-${y}.csv`;
      const dlResult = await sp.downloadArchiveFile(yearPath);
      if (dlResult.ok) {
        const csvText = typeof dlResult.body === 'string' ? dlResult.body : JSON.stringify(dlResult.body);
        const yearRows = parseCsv(csvText);
        allCombinedRows.push(...yearRows);
      }
    }

    const cleanCombinedRows = allCombinedRows.filter(row => {
      const pipelineName = (row.PipelineName || '').toLowerCase();
      return !pipelineName.includes('schedule') && !pipelineName.includes('scripts');
    });

    cleanCombinedRows.sort((a, b) => new Date(b.FinishedTime) - new Date(a.FinishedTime));
    const latest1000 = cleanCombinedRows.slice(0, 1000);

    const legacyLines = latest1000.map(row => {
      return headers.map(h => escapeCsvValue(row[h])).join(',');
    });
    const legacyContent = '\uFEFF' + [headers.join(','), ...legacyLines].join('\n');

    const legacyUpload = await sp.uploadArchiveFile(legacyPath, legacyContent, 'text/csv; charset=utf-8');
    if (!legacyUpload.ok) {
      context.log.warn(`Failed to update legacy CSV: HTTP ${legacyUpload.status}`);
    }

    context.log('Sync successfully completed!');
    jsonResponse(200, {
      ok: true,
      totalBuildsFetched: uniqueBuilds.length,
      stagingBuildsLogged: filteredBuilds.length,
      yearsUpdated: years,
      completedAt: new Date().toISOString()
    });

  } catch (err) {
    context.log.error('Sync error:', err);
    jsonResponse(500, {
      ok: false,
      error: 'Failed to sync staging deployments',
      detail: err && err.message ? err.message : String(err)
    });
  }
};

async function getRepositoryNameFromDefinition(definitionId, cache) {
  if (!definitionId) return '';
  const key = String(definitionId);
  if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
  try {
    const { org, project } = getConfig();
    const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/build/definitions/${encodeURIComponent(key)}?api-version=7.0`;
    const result = await adoRequest('GET', path);
    const repoName = result.ok && result.body && result.body.repository && result.body.repository.name || '';
    cache[key] = repoName;
    return repoName;
  } catch (e) {
    cache[key] = '';
    return '';
  }
}

function inferRepoNameFromPipeline(pipelineName) {
  return String(pipelineName || '')
    .replace(/^(STG|PH|VN|MY|ID)_/i, '')
    .replace(/_docker-CI$/i, '')
    .replace(/-CI$/i, '')
    .trim();
}

/**
 * ฟังก์ชันสำหรับแยกวิเคราะห์ CSV (CSV Parser) แบบรองรับ double quotes และ newline
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

