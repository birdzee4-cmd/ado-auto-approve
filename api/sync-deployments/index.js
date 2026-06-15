/**
 * GET/POST /api/sync-deployments
 *
 * ดึงข้อมูลประวัติการ Build ของ Staging ทั้งหมดจาก Azure DevOps 
 * แปลงเป็น CSV และบันทึกไปที่ SharePoint Document Library
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

    // 3) กรองเฉพาะประวัติการ Build ที่มีคำว่า 'stg' (Case-insensitive)
    const filteredBuilds = uniqueBuilds.filter(b => {
      const pipelineName = b.definition && b.definition.name || '';
      return pipelineName.toLowerCase().includes('stg');
    });

    context.log(`Staging builds count: ${filteredBuilds.length}`);

    // 4) สร้างไฟล์ CSV
    const headers = [
      'PipelineName', 'RepoName', 'Branch', 'Environment', 'BuildNumber',
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

    const rows = filteredBuilds.map(b => {
      const pipelineName = b.definition && b.definition.name || '';
      const repoName = b.repository && b.repository.name || '';
      const cleanBranch = b.sourceBranch ? b.sourceBranch.replace('refs/heads/', '') : '';
      const status = b.status || '';
      const result = b.result || '';
      
      // แปลงสถานะสำหรับการสรุปผล
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
      const tags = b.tags ? b.tags.join(', ') : '';
      const buildUrl = b._links && b._links.web && b._links.web.href || '';

      return [
        pipelineName,
        repoName,
        cleanBranch,
        'Staging',
        b.buildNumber || '',
        displayStatus,
        finishedTime,
        triggeredBy,
        commitHash,
        commitMessage,
        tags,
        buildUrl
      ].map(escapeCsvValue).join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n'); // เติม BOM (\uFEFF) เพื่อรองรับภาษาไทยใน Excel/CSV

    // 5) อัปโหลดไฟล์ไปที่ SharePoint Document Library
    const filePath = 'deploy-history/stg-deployments.csv';
    context.log(`Uploading CSV to SharePoint at path: ${filePath}...`);
    
    const uploadResult = await sp.uploadArchiveFile(filePath, csvContent, 'text/csv; charset=utf-8');
    if (!uploadResult.ok) {
      throw new Error(`SharePoint upload returned HTTP ${uploadResult.status}`);
    }

    context.log('Sync successfully completed!');
    jsonResponse(200, {
      ok: true,
      totalBuildsFetched: uniqueBuilds.length,
      stagingBuildsLogged: filteredBuilds.length,
      fileUploaded: filePath,
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
