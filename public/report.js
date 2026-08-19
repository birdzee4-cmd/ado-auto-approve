import {
  safeFetchJson, escapeHtml, showBox, setText, setButtonLoading,
  bind, initPage
} from './core.js';

// เก็บออบเจ็กต์ Chart เพื่อใช้ทำลาย (destroy) ก่อนสร้างใหม่
let approveChartInstance = null;
let buildChartInstance = null;
let trendChartInstance = null;
let failedBuildsRenderToken = 0;
let latestReportData = null;
let failedBuildSourceItems = [];
const diagnosticsCache = new Map();

// ตั้งค่าเมื่อโหลดหน้าจอ
async function init() {
  await initPage();
  
  // ตั้งค่าวันที่เริ่มต้นตามเวลากรุงเทพฯ (GMT+7)
  const offsetMs = 7 * 60 * 60 * 1000;
  const bkkNow = new Date(Date.now() + offsetMs);
  const currentYear = bkkNow.getUTCFullYear();
  const currentMonth = bkkNow.getUTCMonth() + 1;
  const currentDay = bkkNow.getUTCDate();

  // ตั้งค่าให้กับ Dropdowns เริ่มต้น
  const filterType = document.getElementById('filterType');
  const filterYear = document.getElementById('filterYear');
  const filterMonth = document.getElementById('filterMonth');
  const filterDay = document.getElementById('filterDay');

  if (filterType) filterType.value = 'daily';
  populateYearOptions(currentYear);
  if (filterYear) filterYear.value = String(currentYear);
  if (filterMonth) filterMonth.value = String(currentMonth);

  // สลับการแสดงผลตัวกรองวันที่
  if (filterType) {
    filterType.addEventListener('change', () => {
      invalidateReportExport();
      handleTypeChange();
      handleDateUpdate();
    });
  }

  if (filterMonth) {
    filterMonth.addEventListener('change', () => {
      invalidateReportExport();
      handleDateUpdate();
    });
  }

  if (filterYear) {
    filterYear.addEventListener('change', () => {
      invalidateReportExport();
      handleDateUpdate();
    });
  }

  const filterStartTime = document.getElementById('filterStartTime');
  const filterEndTime = document.getElementById('filterEndTime');
  if (filterStartTime) filterStartTime.addEventListener('change', () => {
    invalidateReportExport();
    syncEndTimeOptions();
  });
  if (filterEndTime) filterEndTime.addEventListener('change', () => {
    invalidateReportExport();
    syncEndTimeOptions();
  });
  ['filterDay', 'filterActionScope', 'filterBuildScope'].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.addEventListener('change', invalidateReportExport);
  });
  bind('btnLoadReport', loadReport);
  bind('btnExportReport', exportReportToExcel);
  document.querySelectorAll('[data-range]').forEach(button => {
    button.addEventListener('click', () => applyQuickRange(button.dataset.range));
  });
  const failedBuildSearch = document.getElementById('failedBuildSearch');
  const failedBuildSort = document.getElementById('failedBuildSort');
  if (failedBuildSearch) failedBuildSearch.addEventListener('input', () => renderFailedBuilds(failedBuildSourceItems, true));
  if (failedBuildSort) failedBuildSort.addEventListener('change', () => renderFailedBuilds(failedBuildSourceItems, true));

  // สร้างรายชื่อตัวเลือกวันที่
  populateDays(currentYear, currentMonth, currentDay);
  populateHourOptions();
  handleTypeChange();
  
  // โหลดรายงานรอบแรก
  await loadReport();

  // ดึงข้อมูลและอัปเดตประวัติการดีพลอยล่าสุดแบบเบื้องหลัง (Background Sync)
  triggerBackgroundSync();
}

function populateYearOptions(currentYear) {
  const select = document.getElementById('filterYear');
  if (!select) return;
  const firstYear = 2025;
  select.innerHTML = '';
  for (let year = currentYear + 1; year >= firstYear; year--) {
    const option = document.createElement('option');
    option.value = String(year);
    option.textContent = String(year);
    select.appendChild(option);
  }
}

async function applyQuickRange(range) {
  const offsetMs = 7 * 60 * 60 * 1000;
  const now = new Date(Date.now() + offsetMs);
  let target = new Date(now);
  let type = 'daily';
  if (range === 'yesterday') target = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (range === 'month' || range === 'previous-month') {
    type = 'monthly';
    if (range === 'previous-month') target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  }

  document.getElementById('filterType').value = type;
  document.getElementById('filterYear').value = String(target.getUTCFullYear());
  document.getElementById('filterMonth').value = String(target.getUTCMonth() + 1);
  populateDays(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate());
  handleTypeChange();
  invalidateReportExport();
  document.querySelectorAll('[data-range]').forEach(button => {
    button.classList.toggle('is-active', button.dataset.range === range);
  });
  await loadReport();
}

// ดึงข้อมูลการดีพลอยล่าสุดแบบเบื้องหลังเพื่ออัปเดตแคช (SharePoint CSV)
async function triggerBackgroundSync() {
  const statusEl = document.getElementById('txtSyncStatus');
  if (statusEl) {
    statusEl.innerHTML = '⏳ กำลังซิงก์ข้อมูลล่าสุดจาก Azure DevOps...';
  }
  try {
    const r = await safeFetchJson('/api/sync-deployments', { method: 'POST' });
    if (r.ok && r.data && r.data.ok) {
      if (statusEl) {
        statusEl.innerHTML = `✅ อัปเดตข้อมูลบิลด์ล่าสุดแล้ว (Staging: ${r.data.stagingBuildsLogged} บิลด์)`;
      }
      // โหลดรายงานใหม่อีกครั้งเพื่ออัปเดตหน้าจอด้วยข้อมูลใหม่
      await loadReport();
    } else {
      if (statusEl) {
        statusEl.innerHTML = '⚠️ ซิงก์ข้อมูลไม่สำเร็จ (ใช้ข้อมูลแคช)';
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML = '⚠️ ซิงก์ข้อมูลล่าสุดล้มเหลว (ใช้ข้อมูลแคช)';
    }
  }
}

// เมื่อเปลี่ยนประเภทรายงาน (รายเดือน vs รายวัน)
function handleTypeChange() {
  const type = document.getElementById('filterType').value;
  const dayContainer = document.getElementById('filterDayContainer');
  const startTimeContainer = document.getElementById('filterStartTimeContainer');
  const endTimeContainer = document.getElementById('filterEndTimeContainer');
  const showDailyFilters = type === 'daily';
  if (dayContainer) {
    dayContainer.style.display = showDailyFilters ? '' : 'none';
  }
  if (startTimeContainer) {
    startTimeContainer.style.display = showDailyFilters ? '' : 'none';
  }
  if (endTimeContainer) {
    endTimeContainer.style.display = showDailyFilters ? '' : 'none';
  }
}

// เมื่อเดือนหรือปีมีการเปลี่ยนแปลง ให้คำนวณจำนวนวันในเดือนนั้นใหม่
function handleDateUpdate() {
  const year = parseInt(document.getElementById('filterYear').value, 10);
  const month = parseInt(document.getElementById('filterMonth').value, 10);
  const filterDay = document.getElementById('filterDay');
  const currentSelectedDay = filterDay ? parseInt(filterDay.value, 10) : 1;
  
  populateDays(year, month, currentSelectedDay);
}

// คำนวณและอัปเดตตัวเลือกใน dropdown วันที่
function populateDays(year, month, selectDayValue = 1) {
  const filterDay = document.getElementById('filterDay');
  if (!filterDay) return;

  // หาจำนวนวันในเดือนนั้นๆ
  const totalDays = new Date(year, month, 0).getDate();
  
  filterDay.innerHTML = '';
  for (let d = 1; d <= totalDays; d++) {
    const opt = document.createElement('option');
    opt.value = String(d);
    opt.textContent = String(d);
    filterDay.appendChild(opt);
  }

  // เซ็ตค่าตัวเลือกวันเดิมถ้ามี หรือเซ็ตสูงสุดของเดือนใหม่หากค่าเดิมเกินขอบเขต
  filterDay.value = String(Math.min(selectDayValue, totalDays));
}

function populateHourOptions() {
  const startSelect = document.getElementById('filterStartTime');
  const endSelect = document.getElementById('filterEndTime');
  if (!startSelect || !endSelect) return;

  startSelect.innerHTML = '';
  endSelect.innerHTML = '';
  for (let hour = 0; hour < 24; hour++) {
    const labelHour = String(hour).padStart(2, '0');
    const startOpt = document.createElement('option');
    startOpt.value = labelHour + ':00';
    startOpt.textContent = labelHour + ':00';
    startSelect.appendChild(startOpt);
  }

  for (let hour = 1; hour <= 24; hour++) {
    const labelHour = String(hour).padStart(2, '0');
    const endOpt = document.createElement('option');
    endOpt.value = labelHour + ':00';
    endOpt.textContent = labelHour + ':00';
    endSelect.appendChild(endOpt);
  }

  startSelect.value = '00:00';
  endSelect.value = '24:00';
  syncEndTimeOptions();
}

function syncEndTimeOptions() {
  const startSelect = document.getElementById('filterStartTime');
  const endSelect = document.getElementById('filterEndTime');
  if (!startSelect || !endSelect) return;

  const minEndMinutes = timeValueToMinutes(startSelect.value) + 60;
  Array.from(endSelect.options).forEach(option => {
    option.disabled = timeValueToMinutes(option.value) < minEndMinutes;
  });
  if (timeValueToMinutes(endSelect.value) < minEndMinutes) {
    const nextOption = Array.from(endSelect.options).find(option => !option.disabled);
    if (nextOption) endSelect.value = nextOption.value;
  }
}

function timeValueToMinutes(value) {
  if (value === '24:00') return 24 * 60;
  const parts = String(value || '00:00').split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

// ยิงโหลดข้อมูลรายงานสรุปผลสถิติ
async function loadReport() {
  setButtonLoading('btnLoadReport', true, 'Loading...');
  
  const type = document.getElementById('filterType').value;
  const year = document.getElementById('filterYear').value;
  const month = document.getElementById('filterMonth').value;
  const day = document.getElementById('filterDay').value;
  const startTime = (document.getElementById('filterStartTime') || {}).value || '00:00';
  const endTime = (document.getElementById('filterEndTime') || {}).value || '23:59';
  const actionScope = (document.getElementById('filterActionScope') || {}).value || 'all';
  const buildScope = (document.getElementById('filterBuildScope') || {}).value || 'all';

  let queryPath = `/api/report-summary?type=${type}&year=${year}&month=${month}` +
    `&actionScope=${encodeURIComponent(actionScope)}` +
    `&buildScope=${encodeURIComponent(buildScope)}`;
  if (type === 'daily') {
    queryPath += `&day=${day}`;
    queryPath += `&startTime=${encodeURIComponent(startTime)}`;
    queryPath += `&endTime=${encodeURIComponent(endTime)}`;
  }

  try {
    const r = await safeFetchJson(queryPath);
    if (r.parseError || !r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      showBox('reportResult', '❌ เกิดข้อผิดพลาดในการโหลดรายงาน: ' + escapeHtml(d.error || 'ไม่สามารถโหลดข้อมูลสถิติได้') +
        '<br/><small>' + escapeHtml(d.detail || '') + '</small>', 'error');
      clearStatsUi();
      invalidateReportExport();
      return;
    }

    // ซ่อนกล่องแจ้งเตือนหากไม่มีเออเรอร์
    const resultBox = document.getElementById('reportResult');
    if (resultBox) resultBox.hidden = true;

    const data = r.data;
    latestReportData = data;
    updateExportButton();
    renderStatsUi(data);

  } catch (err) {
    showBox('reportResult', '❌ เกิดข้อผิดพลาดร้ายแรง: ' + escapeHtml(err.message), 'error');
    clearStatsUi();
    invalidateReportExport();
  } finally {
    setButtonLoading('btnLoadReport', false);
  }
}

function invalidateReportExport() {
  latestReportData = null;
  document.querySelectorAll('[data-range]').forEach(button => button.classList.remove('is-active'));
  updateExportButton();
}

function updateExportButton() {
  const button = document.getElementById('btnExportReport');
  if (button) button.disabled = !latestReportData;
}

function exportReportToExcel() {
  if (!latestReportData) return;

  const data = latestReportData;
  const stats = data.stats || {};
  const scope = data.scope || {};
  const exportedAt = new Date();
  const sheets = [
    buildSpreadsheetWorksheet('Summary', [
      ['ADO Auto-Approve Report', ''],
      ['Exported At', exportedAt.toISOString()],
      ['Report Range Start', data.range && data.range.start || ''],
      ['Report Range End', data.range && data.range.end || ''],
      ['PR Actions Scope', scope.actionScope === 'mine' ? 'My actions only' : 'All users'],
      ['Staging Builds Scope', scope.buildScope === 'related' ? 'Related PR builds' : 'All staging builds'],
      ['Related PR Count', scope.relatedPrCount || 0],
      ['', ''],
      ['Metric', 'Value'],
      ['Pull Requests', stats.totalPrs || 0],
      ['PR Actions', stats.totalActions || 0],
      ['Auto Approved', stats.autoApproved || 0],
      ['Manual Approved', stats.manualApproved || 0],
      ['Rejected', stats.rejected || 0],
      ['On Hold', stats.onHold || 0],
      ['Auto-Approve Rate (%)', stats.autoApproveRate || 0],
      ['Staging Deployments', stats.totalDeploys || 0],
      ['Succeeded Builds', stats.succeededDeploys || 0],
      ['Failed/Canceled Builds', stats.failedDeploys || 0],
      ['In Progress Builds', stats.inProgressDeploys || 0],
      ['Build Success Rate (%)', stats.deploySuccessRate || 0]
    ], { headerRows: [0, 8], widths: [210, 260] }),
    buildSpreadsheetWorksheet('Top Active Repos', [
      ['Rank', 'Repository', 'Pull Requests'],
      ...(data.topActiveRepos || []).map((item, index) => [index + 1, item.repo || '', item.count || 0])
    ], { headerRows: [0], widths: [60, 320, 110] }),
    buildSpreadsheetWorksheet('Failed Repos Summary', [
      ['Rank', 'Repository', 'Failed Builds'],
      ...(data.allFailedRepos || data.topFailedRepos || []).map((item, index) => [index + 1, item.repo || '', item.count || 0])
    ], { headerRows: [0], widths: [60, 320, 110] }),
    buildSpreadsheetWorksheet('Failed Builds', [
      ['PR', 'Repository', 'Branch', 'Status', 'Build Number', 'Finished Time', 'Triggered By', 'Build URL'],
      ...(data.allFailedDeployItems || data.failedDeployItems || []).map(item => [
        item.prId || '', item.repo || '', item.branch || '', item.status || '',
        item.buildNumber || '', item.finishedTime || '', item.triggeredBy || '', item.buildUrl || ''
      ])
    ], { headerRows: [0], widths: [75, 220, 260, 90, 120, 170, 170, 360] })
  ];

  const workbook = '<?xml version="1.0"?>' +
    '<?mso-application progid="Excel.Sheet"?>' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ' +
    'xmlns:o="urn:schemas-microsoft-com:office:office" ' +
    'xmlns:x="urn:schemas-microsoft-com:office:excel" ' +
    'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    '<Styles>' +
      '<Style ss:ID="Default"><Alignment ss:Vertical="Top"/><Font ss:FontName="Aptos" ss:Size="11"/></Style>' +
      '<Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#7C4A03" ss:Pattern="Solid"/></Style>' +
    '</Styles>' + sheets.join('') + '</Workbook>';

  downloadReportBlob('\ufeff' + workbook, buildReportExportFileName(data, exportedAt), 'application/vnd.ms-excel;charset=utf-8');
}

function buildSpreadsheetWorksheet(name, rows, options) {
  const headerRows = new Set(options.headerRows || []);
  const columns = (options.widths || []).map(width => `<Column ss:AutoFitWidth="0" ss:Width="${width}"/>`).join('');
  const body = rows.map((row, rowIndex) => {
    const style = headerRows.has(rowIndex) ? ' ss:StyleID="Header"' : '';
    const cells = row.map(value => {
      const isNumber = typeof value === 'number' && Number.isFinite(value);
      return `<Cell${style}><Data ss:Type="${isNumber ? 'Number' : 'String'}">${escapeSpreadsheetXml(value)}</Data></Cell>`;
    }).join('');
    return '<Row>' + cells + '</Row>';
  }).join('');
  return `<Worksheet ss:Name="${escapeSpreadsheetXml(name)}"><Table>${columns}${body}</Table>` +
    '<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions>' +
    '</Worksheet>';
}

function escapeSpreadsheetXml(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildReportExportFileName(data, exportedAt) {
  const type = (document.getElementById('filterType') || {}).value || 'report';
  const rangeStart = data.range && data.range.start ? new Date(data.range.start) : exportedAt;
  const datePart = Number.isNaN(rangeStart.getTime())
    ? exportedAt.toISOString().slice(0, 10).replace(/-/g, '')
    : rangeStart.toISOString().slice(0, 10).replace(/-/g, '');
  const stamp = exportedAt.toISOString().slice(11, 19).replace(/:/g, '');
  return `ado-auto-approve-${type}-${datePart}-${stamp}.xls`;
}

function downloadReportBlob(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

// เคลียร์ UI ข้อมูลสรุปและกราฟ
function clearStatsUi() {
  setText('statTotalPrs', '-');
  setText('statAutoApproveRate', '-');
  setText('statTotalDeploys', '-');
  setText('statBuildSuccessRate', '-');
  ['statTotalPrsMeta', 'statAutoApproveRateMeta', 'statTotalDeploysMeta', 'statBuildSuccessRateMeta']
    .forEach(id => setText(id, 'ไม่สามารถแสดงข้อมูลได้'));
  failedBuildSourceItems = [];

  destroyCharts();

  const activeList = document.getElementById('activeReposList');
  const failedList = document.getElementById('failedReposList');
  const failedBuildsList = document.getElementById('failedBuildsList');
  const scopeNote = document.getElementById('reportScopeNote');
  if (activeList) activeList.innerHTML = '<div class="empty-state">— ไม่มีข้อมูลสรุปสถิติ —</div>';
  if (failedList) failedList.innerHTML = '<div class="empty-state">— ไม่มีข้อมูลสรุปสถิติ —</div>';
  if (failedBuildsList) failedBuildsList.innerHTML = '<div class="empty-state">— ไม่มีข้อมูลบิลด์พังในช่วงที่เลือก —</div>';
  if (scopeNote) {
    scopeNote.hidden = true;
    scopeNote.textContent = '';
  }
}

// ทำลายออบเจ็กต์กราฟตัวเก่า
function destroyCharts() {
  if (approveChartInstance) {
    approveChartInstance.destroy();
    approveChartInstance = null;
  }
  if (buildChartInstance) {
    buildChartInstance.destroy();
    buildChartInstance = null;
  }
  if (trendChartInstance) {
    trendChartInstance.destroy();
    trendChartInstance = null;
  }
}

// เรนเดอร์ข้อมูลสถิติ ตัวเลข กราฟ และอันดับ Repository
function renderStatsUi(data) {
  const stats = data.stats || {};
  renderScopeNote(data);
  
  // 1) อัปเดต KPI Cards
  setText('statTotalPrs', String(stats.totalPrs || 0));
  setText('statAutoApproveRate', (stats.autoApproved + stats.manualApproved) > 0 ? `${stats.autoApproveRate}%` : '0%');
  setText('statTotalDeploys', String(stats.totalDeploys || 0));
  setText('statBuildSuccessRate', stats.totalDeploys > 0 ? `${stats.deploySuccessRate}%` : '0%');
  setText('statTotalPrsMeta', `${stats.totalActions || 0} actions ในช่วงที่เลือก`);
  setText('statAutoApproveRateMeta', `${stats.autoApproved || 0} จาก ${(stats.autoApproved || 0) + (stats.manualApproved || 0)} approvals`);
  setText('statTotalDeploysMeta', `${stats.failedDeploys || 0} failed/canceled`);
  setText('statBuildSuccessRateMeta', `${stats.succeededDeploys || 0} จาก ${stats.totalDeploys || 0} builds`);
  const freshness = document.getElementById('reportFreshness');
  if (freshness) {
    const generatedAt = data.generatedAt ? formatShortDate(data.generatedAt) : 'ไม่ทราบเวลา';
    freshness.textContent = `ข้อมูลรายงาน ณ ${generatedAt} · ${data.timezone || 'Asia/Bangkok'}`;
  }

  // 2) วาดกราฟและอัปเดต Chart.js
  destroyCharts();

  renderTrendChart(data.trend || [], data.type);

  // วาด Approve Chart
  const approveCanvas = document.getElementById('approveChart');
  const approveEmpty = document.getElementById('approveChartEmpty');
  
  const hasApproveData = (stats.autoApproved + stats.manualApproved + stats.rejected + stats.onHold) > 0;
  
  if (approveCanvas) {
    if (hasApproveData) {
      approveCanvas.style.display = 'block';
      approveEmpty.style.display = 'none';

      // เรียก Chart ใน global namespace (โหลดจาก public/assets/chart.js)
      approveChartInstance = new window.Chart(approveCanvas, {
        type: 'doughnut',
        data: {
          labels: ['Auto Approved', 'Manual Approved', 'Rejected', 'On Hold'],
          datasets: [{
            data: [stats.autoApproved || 0, stats.manualApproved || 0, stats.rejected || 0, stats.onHold || 0],
            backgroundColor: ['#10b981', '#f5a400', '#ef4444', '#9ca3af'],
            borderWidth: 1,
            borderColor: '#ffffff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                font: { family: 'Outfit, Sarabun, sans-serif', size: 12 }
              }
            }
          },
          cutout: '65%'
        }
      });
    } else {
      approveCanvas.style.display = 'none';
      approveEmpty.style.display = 'block';
    }
  }

  // วาด Build Status Chart
  const buildCanvas = document.getElementById('buildChart');
  const buildEmpty = document.getElementById('buildChartEmpty');
  
  const hasBuildData = stats.totalDeploys > 0;

  if (buildCanvas) {
    if (hasBuildData) {
      buildCanvas.style.display = 'block';
      buildEmpty.style.display = 'none';

      buildChartInstance = new window.Chart(buildCanvas, {
        type: 'doughnut',
        data: {
          labels: ['Succeeded', 'Failed/Canceled', 'In Progress'],
          datasets: [{
            data: [stats.succeededDeploys || 0, stats.failedDeploys || 0, stats.inProgressDeploys || 0],
            backgroundColor: ['#10b981', '#ef4444', '#f59e0b'],
            borderWidth: 1,
            borderColor: '#ffffff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                font: { family: 'Outfit, Sarabun, sans-serif', size: 12 }
              }
            }
          },
          cutout: '65%'
        }
      });
    } else {
      buildCanvas.style.display = 'none';
      buildEmpty.style.display = 'block';
    }
  }

  // 3) เรนเดอร์ 5 อันดับ Repository ยอดนิยมที่มีการ Approve มากที่สุด (Top Active)
  const activeList = document.getElementById('activeReposList');
  if (activeList) {
    const activeItems = data.topActiveRepos || [];
    if (activeItems.length === 0) {
      activeList.innerHTML = '<div class="empty-state">— ไม่มีข้อมูลสรุปสถิติ —</div>';
    } else {
      const maxCount = activeItems[0].count || 1;
      activeList.innerHTML = activeItems.map(item => {
        const percentage = Math.max(5, (item.count / maxCount) * 100);
        return `<div class="ranking-item">
          <div class="ranking-item-header">
            <span class="ranking-name" title="${escapeHtml(item.repo)}">${escapeHtml(item.repo)}</span>
            <span class="ranking-value">${escapeHtml(item.count)} PRs</span>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-bar" style="width: ${percentage}%"></div>
          </div>
        </div>`;
      }).join('');
    }
  }

  // 4) เรนเดอร์ 5 อันดับ Repository ที่มีบิลด์พังบ่อยที่สุด (Top Failed Builds)
  const failedList = document.getElementById('failedReposList');
  if (failedList) {
    const failedItems = data.topFailedRepos || [];
    if (failedItems.length === 0) {
      failedList.innerHTML = '<div class="empty-state">— ไม่มีข้อมูลสรุปสถิติ —</div>';
    } else {
      const maxCount = failedItems[0].count || 1;
      failedList.innerHTML = failedItems.map(item => {
        const percentage = Math.max(5, (item.count / maxCount) * 100);
        return `<div class="ranking-item">
          <div class="ranking-item-header">
            <span class="ranking-name" title="${escapeHtml(item.repo)}">${escapeHtml(item.repo)}</span>
            <span class="ranking-value">${escapeHtml(item.count)} times</span>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-bar red" style="width: ${percentage}%"></div>
          </div>
        </div>`;
      }).join('');
    }
  }

  renderFailedBuilds(data.failedDeployItems || []);
}

function renderTrendChart(trend, reportType) {
  const canvas = document.getElementById('trendChart');
  const empty = document.getElementById('trendChartEmpty');
  if (!canvas || !empty) return;
  const items = Array.isArray(trend) ? trend : [];
  const hasData = items.some(item => item.autoApproveRate !== null || item.buildSuccessRate !== null);
  canvas.style.display = hasData ? 'block' : 'none';
  empty.style.display = hasData ? 'none' : 'block';
  if (!hasData) return;

  const labels = items.map(item => {
    if (reportType === 'daily') return String(item.key || '').slice(11) + ':00';
    const date = new Date(String(item.key || '') + 'T00:00:00+07:00');
    return Number.isNaN(date.getTime())
      ? item.key
      : date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });
  });

  trendChartInstance = new window.Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Auto-Approve Rate',
          data: items.map(item => item.autoApproveRate),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.12)',
          tension: 0.3,
          spanGaps: true
        },
        {
          label: 'Build Success Rate',
          data: items.map(item => item.buildSuccessRate),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.12)',
          tension: 0.3,
          spanGaps: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: { callback: value => value + '%' }
        }
      },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: context => context.dataset.label + ': ' + context.parsed.y + '%'
          }
        }
      }
    }
  });
}

function renderScopeNote(data) {
  const scopeNote = document.getElementById('reportScopeNote');
  if (!scopeNote) return;
  const scope = data.scope || {};
  const actionText = scope.actionScope === 'mine'
    ? 'PR actions: เฉพาะของฉัน'
    : 'PR actions: ทั้งหมด';
  const buildText = scope.buildScope === 'related'
    ? 'Staging builds: เฉพาะ Build ของ PR ที่แสดงในรายงาน'
    : 'Staging builds: ทั้งหมดบน Staging Pipeline';
  const relatedText = scope.buildScope === 'related'
    ? ' | PR ที่ใช้จับคู่: ' + (scope.relatedPrCount || 0)
    : '';
  const rangeText = formatReportRange(data.range);
  scopeNote.hidden = false;
  scopeNote.textContent = [rangeText, actionText, buildText + relatedText].filter(Boolean).join(' | ');
}

function formatReportRange(range) {
  if (!range || !range.start || !range.end) return '';
  const start = new Date(range.start);
  const end = new Date(range.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
  return 'ช่วงข้อมูล: ' +
    start.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' }) +
    ' - ' +
    end.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
}

function renderFailedBuilds(items, preserveSource) {
  const list = document.getElementById('failedBuildsList');
  if (!list) return;
  if (!preserveSource) failedBuildSourceItems = Array.isArray(items) ? items.slice() : [];
  const search = String((document.getElementById('failedBuildSearch') || {}).value || '').trim().toLowerCase();
  const sort = String((document.getElementById('failedBuildSort') || {}).value || 'newest');
  const filteredItems = failedBuildSourceItems.filter(item => {
    if (!search) return true;
    return [item.prId, item.repo, item.branch, item.buildNumber, item.triggeredBy]
      .some(value => String(value || '').toLowerCase().includes(search));
  }).sort((left, right) => {
    if (sort === 'repo') return String(left.repo || '').localeCompare(String(right.repo || ''), 'th');
    return (Date.parse(right.finishedTime || '') || 0) - (Date.parse(left.finishedTime || '') || 0);
  });
  failedBuildsRenderToken += 1;
  const renderToken = failedBuildsRenderToken;
  const count = document.getElementById('failedBuildCount');
  if (count) count.textContent = 'แสดง ' + filteredItems.length + ' จาก ' + failedBuildSourceItems.length + ' รายการล่าสุด';

  if (filteredItems.length === 0) {
    list.innerHTML = '<div class="empty-state">— ไม่พบ Failed Build ที่ตรงกับเงื่อนไข —</div>';
    return;
  }

  list.innerHTML = filteredItems.map((item, index) => {
    const prText = item.prId ? '#' + item.prId : 'N/A';
    const buildText = item.buildNumber || 'Open build';
    const buildId = getBuildIdFromUrl(item.buildUrl);
    const buildLink = item.buildUrl
      ? `<a class="failed-build-link" href="${escapeHtml(item.buildUrl)}" target="_blank" rel="noopener" title="${escapeHtml(buildText)}">${escapeHtml(buildText)}</a>`
      : `<span class="failed-build-value failed-build-value--compact" title="${escapeHtml(buildText)}">${escapeHtml(buildText)}</span>`;
    return `<div class="failed-build-item" data-build-id="${escapeHtml(buildId)}" data-build-index="${index}">
      <div class="failed-build-cell failed-build-cell--pr">
        <span class="failed-build-label">PR</span>
        <span class="failed-build-value failed-build-value--compact" title="${escapeHtml(prText)}">${escapeHtml(prText)}</span>
      </div>
      <div class="failed-build-cell failed-build-cell--repo">
        <span class="failed-build-label">Repository</span>
        <span class="failed-build-value failed-build-value--long" title="${escapeHtml(item.repo || '-')}">${escapeHtml(item.repo || '-')}</span>
      </div>
      <div class="failed-build-cell failed-build-cell--branch">
        <span class="failed-build-label">Branch</span>
        <span class="failed-build-value failed-build-value--long" title="${escapeHtml(item.branch || '-')}">${escapeHtml(item.branch || '-')}</span>
      </div>
      <div class="failed-build-cell failed-build-cell--finished">
        <span class="failed-build-label">Finished</span>
        <span class="failed-build-value failed-build-value--compact" title="${escapeHtml(formatShortDate(item.finishedTime))}">${escapeHtml(formatShortDate(item.finishedTime))}</span>
        ${item.triggeredBy ? `<span class="failed-build-subvalue" title="${escapeHtml(item.triggeredBy)}">โดย ${escapeHtml(item.triggeredBy)}</span>` : ''}
      </div>
      <div class="failed-build-cell failed-build-cell--build">${buildLink}</div>
      <div class="failed-build-analysis" data-analysis-for="${escapeHtml(String(index))}">
        ${buildId ? `<button type="button" class="analysis-toggle" data-analysis-toggle="${index}">ดูสาเหตุของ Build</button>` : ''}
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-analysis-toggle]').forEach(button => {
    button.addEventListener('click', async () => {
      const index = Number(button.dataset.analysisToggle);
      const item = filteredItems[index];
      const target = document.querySelector(`[data-analysis-for="${String(index)}"]`);
      if (!item || !target) return;
      target.innerHTML = renderAnalysisLoading();
      await loadFailedBuildDiagnostics(item, index, renderToken);
    }, { once: true });
  });
}

function renderAnalysisLoading() {
  return `<div class="failed-build-analysis-card failed-build-analysis-card--loading">
    <span class="failed-build-analysis-kicker">Analysis</span>
    <p class="failed-build-analysis-text">กำลังดึงรายละเอียดปัญหา...</p>
  </div>`;
}

async function loadFailedBuildDiagnostics(item, index, renderToken) {
  const buildId = getBuildIdFromUrl(item && item.buildUrl);
  if (!buildId) return;
  if (diagnosticsCache.has(buildId)) {
    renderFailedBuildAnalysis(index, diagnosticsCache.get(buildId));
    return;
  }
  try {
    const result = await safeFetchJson('/api/build-diagnostics?buildId=' + encodeURIComponent(buildId) + '&suppressAutoNotify=true');
    if (renderToken !== failedBuildsRenderToken) return;
    const diagnostics = result && result.ok && result.data && result.data.ok
      ? result.data.diagnostics || {}
      : null;
    diagnosticsCache.set(buildId, diagnostics);
    renderFailedBuildAnalysis(index, diagnostics);
  } catch (err) {
    if (renderToken !== failedBuildsRenderToken) return;
    renderFailedBuildAnalysis(index, null);
  }
}

function renderFailedBuildAnalysis(index, diagnostics) {
  const target = document.querySelector(`[data-analysis-for="${String(index)}"]`);
  if (!target) return;

  if (!diagnostics) {
    target.innerHTML = '<div class="failed-build-analysis-card failed-build-analysis-card--error">ไม่สามารถโหลดรายละเอียดปัญหาได้</div>';
    return;
  }

  const title = diagnostics.title || '';
  const description = diagnostics.description || '';
  const rootCauseSummary = diagnostics.rootCauseSummary || '';

  if (!title && !description && !rootCauseSummary) {
    target.innerHTML = '';
    return;
  }

  target.innerHTML = `<div class="failed-build-analysis-card">
    ${title ? `<div class="failed-build-analysis-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>` : ''}
    ${description ? `<p class="failed-build-analysis-text" title="${escapeHtml(description)}">${escapeHtml(description)}</p>` : ''}
    ${rootCauseSummary ? `<p class="failed-build-analysis-root" title="${escapeHtml(rootCauseSummary)}">${escapeHtml(rootCauseSummary)}</p>` : ''}
  </div>`;
}

function getBuildIdFromUrl(value) {
  const text = String(value || '');
  const match = text.match(/[?&]buildId=(\d+)/i) || text.match(/\/build\/results\?buildId=(\d+)/i);
  return match ? match[1] : '';
}

function formatShortDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('th-TH', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok'
  });
}

// เริ่มต้นเรียกทำงานสคริปต์
(async function start() {
  await init();
})();
export { init };
