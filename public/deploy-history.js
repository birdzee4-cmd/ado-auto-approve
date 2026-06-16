import {
  safeFetchJson, escapeHtml, showBox, setText, setButtonLoading,
  renderSkeletonRows, bind, formatDate, formatDateTime, initPage,
  compactBranchName
} from './core.js';

// เก็บข้อมูลทั้งหมดที่ดึงมาจาก API ใน Memory เพื่อใช้คัดกรองข้อมูลฝั่ง Client
let rawDeployments = [];

// ดึงข้อมูลประวัติการ Deploy จาก SharePoint
async function loadDeployHistory(showNotification = false) {
  const tbody = document.getElementById('historyTableBody');
  if (tbody) tbody.innerHTML = renderSkeletonRows(10, 5);
  
  if (showNotification) {
    showBox('deployResult', '⏳ กำลังโหลดประวัติการ Deploy...', 'info');
  }

  try {
    const yearVal = document.getElementById('filterYear') ? document.getElementById('filterYear').value : '';
    const queryPath = yearVal ? `/api/deploy-history?year=${yearVal}` : '/api/deploy-history';
    const r = await safeFetchJson(queryPath);
    
    if (r.parseError || !r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      showBox('deployResult', '❌ ' + escapeHtml(d.error || 'ไม่สามารถโหลดประวัติการ Deploy ได้') +
        '<br/><small>' + escapeHtml(d.hint || d.detail || '') + '</small>', 'error');
      renderDeployStats([]);
      renderDeployTable([]);
      return;
    }

    rawDeployments = r.data.deployments || [];
    
    // เรียงลำดับข้อมูลล่าสุดขึ้นก่อน (เปรียบเทียบจาก FinishedTime หรือ BuildNumber)
    rawDeployments.sort((a, b) => {
      const timeA = Date.parse(a.FinishedTime);
      const timeB = Date.parse(b.FinishedTime);
      if (Number.isFinite(timeA) && Number.isFinite(timeB)) {
        return timeB - timeA;
      }
      return String(b.BuildNumber).localeCompare(String(a.BuildNumber));
    });

    // อัปเดต Dropdown Filters ของ Repositories และ Branches ให้มีเฉพาะที่มีข้อมูลจริง
    populateFilterDropdowns(rawDeployments);

    // ทำการกรองและแสดงผลข้อมูล
    applyFiltersAndRender();

    if (showNotification) {
      if (r.data.message) {
        showBox('deployResult', 'ℹ️ ' + escapeHtml(r.data.message), 'info');
      } else {
        showBox('deployResult', `✅ โหลดประวัติสำเร็จ พบทั้งหมด <strong>${rawDeployments.length}</strong> รายการ`, 'success');
        // ซ่อนกล่องแจ้งเตือนหลังจากผ่านไป 3 วินาที
        setTimeout(() => {
          const box = document.getElementById('deployResult');
          if (box) box.hidden = true;
        }, 3000);
      }
    }

  } catch (err) {
    showBox('deployResult', '❌ เกิดข้อผิดพลาด: ' + escapeHtml(err.message), 'error');
    renderDeployStats([]);
    renderDeployTable([]);
  }
}

// สั่ง Sync ดึงข้อมูลจาก Azure DevOps มาเก็บไว้ที่ SharePoint ใหม่
async function syncDevOpsHistory() {
  setButtonLoading('btnSyncHistory', true, 'Syncing ADO...');
  showBox('deployResult', '⏳ ระบบกำลังทำการดึงประวัติล่าสุดจาก Azure DevOps และอัปโหลดไฟล์ไปที่ SharePoint (อาจใช้เวลา 10-20 วินาที)...', 'info');

  try {
    const r = await safeFetchJson('/api/sync-deployments', { method: 'POST' });
    
    if (r.parseError || !r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      showBox('deployResult', '❌ Sync ล้มเหลว: ' + escapeHtml(d.error || 'Unknown error') +
        '<br/><small>' + escapeHtml(d.detail || '') + '</small>', 'error');
      return;
    }

    const d = r.data;
    showBox('deployResult', `✅ Sync สำเร็จ! ดึงข้อมูลมาทั้งหมด <strong>${d.totalBuildsFetched}</strong> รายการ (เป็น Staging <strong>${d.stagingBuildsLogged}</strong> รายการ)`, 'success');
    
    // โหลดข้อมูลประวัติชุดใหม่มาแสดงผลทันที
    await loadDeployHistory(false);

  } catch (err) {
    showBox('deployResult', '❌ เกิดข้อผิดพลาดระหว่าง Sync: ' + escapeHtml(err.message), 'error');
  } finally {
    setButtonLoading('btnSyncHistory', false);
  }
}

// อัปเดตตัวเลือก Repo และ Branch ใน Dropdown แบบไดนามิกตามข้อมูลที่มีอยู่จริง
function populateFilterDropdowns(data) {
  const repoSelect = document.getElementById('filterRepo');
  const branchSelect = document.getElementById('filterBranch');
  if (!repoSelect || !branchSelect) return;

  const currentRepoVal = repoSelect.value;
  const currentBranchVal = branchSelect.value;

  const repos = new Set();
  const branches = new Set();

  data.forEach(item => {
    if (item.RepoName) repos.add(item.RepoName);
    if (item.Branch) branches.add(item.Branch);
  });

  // อัปเดต Repos
  repoSelect.innerHTML = '<option value="">All Repositories</option>';
  Array.from(repos).sort().forEach(repo => {
    const opt = document.createElement('option');
    opt.value = repo;
    opt.textContent = repo;
    repoSelect.appendChild(opt);
  });
  repoSelect.value = repos.has(currentRepoVal) ? currentRepoVal : '';

  // อัปเดต Branches
  branchSelect.innerHTML = '<option value="">All Branches</option>';
  Array.from(branches).sort().forEach(branch => {
    const opt = document.createElement('option');
    opt.value = branch;
    opt.textContent = branch;
    branchSelect.appendChild(opt);
  });
  branchSelect.value = branches.has(currentBranchVal) ? currentBranchVal : '';
}

// กรองข้อมูลใน Memory และเรนเดอร์ตารางประวัติ
function applyFiltersAndRender() {
  const repoFilter = document.getElementById('filterRepo').value.toLowerCase();
  const branchFilter = document.getElementById('filterBranch').value.toLowerCase();
  const statusFilter = document.getElementById('filterStatus').value.toLowerCase();
  const keywordFilter = document.getElementById('filterKeyword').value.trim().toLowerCase();

  const filtered = rawDeployments.filter(item => {
    // กรองตาม Repo
    if (repoFilter && (item.RepoName || '').toLowerCase() !== repoFilter) return false;
    
    // กรองตาม Branch
    if (branchFilter && (item.Branch || '').toLowerCase() !== branchFilter) return false;
    
    // กรองตาม Status
    if (statusFilter && (item.Status || '').toLowerCase() !== statusFilter) return false;
    
    // กรองตาม Keyword (ชื่อ Pipeline, เวอร์ชัน, ข้อความ Commit, ผู้สั่งการ, Build Tags)
    if (keywordFilter) {
      const matchText = [
        item.PipelineName,
        item.BuildNumber,
        item.CommitMessage,
        item.TriggeredBy,
        item.BuildTags
      ].join(' ').toLowerCase();
      if (!matchText.includes(keywordFilter)) return false;
    }

    return true;
  });

  // อัปเดตสถิติสรุปด้านบน
  renderDeployStats(filtered);
  
  // เรนเดอร์ตาราง
  renderDeployTable(filtered);

  // อัปเดตข้อความรายละเอียดการ Sync
  setText('txtInfoCount', `แสดงข้อมูลการ Deploy ของ Staging ทั้งหมด ${filtered.length} รายการ (จากทั้งหมด ${rawDeployments.length} รายการ)`);
}

// คำนวณสถิติ
function renderDeployStats(data) {
  let total = data.length;
  let succeeded = 0;
  let failed = 0;
  let inProgress = 0;

  data.forEach(item => {
    const status = String(item.Status || '').toLowerCase();
    if (status === 'succeeded') succeeded++;
    else if (status === 'failed' || status === 'canceled') failed++;
    else if (status === 'inprogress') inProgress++;
  });

  setText('statTotal', total || '0');
  setText('statSucceeded', succeeded || '0');
  setText('statFailed', failed || '0');
  setText('statInProgress', inProgress || '0');
}

// สร้าง Commit URL บน Azure DevOps โดยแกะ Hostname/Project จาก URL ของ Build
function getCommitUrl(adoBuildUrl, repoName, commitHash) {
  if (!adoBuildUrl || !repoName || !commitHash) return '';
  const match = adoBuildUrl.match(/dev\.azure\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) return '';
  const org = match[1];
  const project = match[2];
  return `https://dev.azure.com/${org}/${project}/_git/${encodeURIComponent(repoName)}/commit/${commitHash}`;
}

// เรนเดอร์ตาราง
function renderDeployTable(items) {
  const tbody = document.getElementById('historyTableBody');
  if (!tbody) return;

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 40px; color: var(--bz-muted); font-style: italic;">— ไม่พบข้อมูลการ Deploy ตามที่ค้นหา —</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(item => {
    const status = String(item.Status || '');
    const statusClass = status === 'Succeeded' ? 'status-succeeded' :
                        status === 'Failed' ? 'status-failed' :
                        status === 'Canceled' ? 'status-canceled' :
                        status === 'InProgress' ? 'status-inprogress' : '';
    
    const statusIcon = status === 'Succeeded' ? '✅' :
                       status === 'Failed' ? '❌' :
                       status === 'Canceled' ? '🚫' :
                       status === 'InProgress' ? '⏳' : '○';

    // สร้างลิงก์ Commit
    const commitUrl = getCommitUrl(item.AdoBuildUrl, item.RepoName, item.CommitHash);
    const commitHtml = item.CommitHash 
      ? (commitUrl 
          ? `<a href="${escapeHtml(commitUrl)}" target="_blank" rel="noopener" class="commit-hash-link" title="ดู Code Commit บน ADO">[${escapeHtml(item.CommitHash.substring(0, 7))}]</a>` 
          : `<span class="commit-hash-link">[${escapeHtml(item.CommitHash.substring(0, 7))}]</span>`)
      : '-';

    // แสดงชื่อ Branch เต็มรูปแบบ (ตัดคำอัตโนมัติด้วย CSS)
    const branchName = item.Branch || '-';
    const branchHtml = `<code title="${escapeHtml(branchName)}">${escapeHtml(branchName)}</code>`;

    // สร้างป้าย Tag
    const tagsHtml = item.BuildTags
      ? item.BuildTags.split(',').map(tag => `<span class="tag-badge">${escapeHtml(tag.trim())}</span>`).join(' ')
      : '-';

    // ลิงก์ตรงไปหน้า Build Log
    const linkHtml = item.AdoBuildUrl
      ? `<a class="btn-mini btn-open" href="${escapeHtml(item.AdoBuildUrl)}" target="_blank" rel="noopener" title="เปิดดู Pipeline Run ใน ADO">🔗 Logs</a>`
      : '-';

    return `<tr>
      <td>${formatDateTime(item.FinishedTime)}</td>
      <td><span class="pipeline-name-title">${escapeHtml(item.PipelineName)}</span></td>
      <td><strong>${escapeHtml(item.RepoName || '-')}</strong></td>
      <td>${branchHtml}</td>
      <td><code>${escapeHtml(item.BuildNumber || '-')}</code></td>
      <td>
        <span class="status-badge ${statusClass}">
          <span>${statusIcon}</span>
          <span>${escapeHtml(status)}</span>
        </span>
      </td>
      <td>${escapeHtml(item.TriggeredBy || '-')}</td>
      <td>
        <div style="display: flex; flex-direction: column; align-items: flex-start;">
          ${commitHtml}
          <small style="color: #6b7280; line-height: 1.35;">${escapeHtml(item.CommitMessage || '-')}</small>
        </div>
      </td>
      <td>${tagsHtml}</td>
      <td style="text-align: center;">${linkHtml}</td>
    </tr>`;
  }).join('');
}

// เคลียร์ Filters ทั้งหมด
function clearFilters() {
  const filterYear = document.getElementById('filterYear');
  if (filterYear) filterYear.value = '';
  
  document.getElementById('filterRepo').value = '';
  document.getElementById('filterBranch').value = '';
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterKeyword').value = '';
  
  loadDeployHistory(true);
}

// ตั้งค่าปุ่มและ Events ค้นหา
function setupEventListeners() {
  bind('btnSearch', applyFiltersAndRender);
  bind('btnClear', clearFilters);
  bind('btnSyncHistory', syncDevOpsHistory);

  // เมื่อเปลี่ยนฟิลเตอร์ของปี ให้ดึงข้อมูลใหม่จาก Server
  const filterYear = document.getElementById('filterYear');
  if (filterYear) {
    filterYear.addEventListener('change', () => {
      loadDeployHistory(true);
    });
  }

  // รองรับการป้อนคำในช่องเสิร์ชแล้วกด Enter
  const keywordInput = document.getElementById('filterKeyword');
  if (keywordInput) {
    keywordInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyFiltersAndRender();
      }
    });
  }

  // อัปเดตข้อมูลเมื่อเปลี่ยนค่า Dropdown ทันที (ฟิลเตอร์ฝั่ง Client)
  ['filterRepo', 'filterBranch', 'filterStatus'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', applyFiltersAndRender);
    }
  });
}

// เริ่มต้นหน้าเว็บ
(async function init() {
  await initPage();
  setupEventListeners();
  
  // โหลดข้อมูลรอบแรกและแสดงการแจ้งเตือน
  await loadDeployHistory(true);
  
  // แสดงเวลาที่อัปเดตล่าสุด (ถ้ามีข้อมูล)
  const lastSync = localStorage.getItem('adoDashboardLastSync');
  if (lastSync) {
    try {
      const parsed = JSON.parse(lastSync);
      if (parsed.at) {
        setText('txtLastUpdated', `Last sync time: ${formatDateTime(parsed.at)}`);
      }
    } catch (e) {}
  }
})();
