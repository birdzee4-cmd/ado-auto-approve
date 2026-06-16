import {
  safeFetchJson, escapeHtml, showBox, setText, setButtonLoading,
  bind, initPage
} from './core.js';

// เก็บออบเจ็กต์ Chart เพื่อใช้ทำลาย (destroy) ก่อนสร้างใหม่
let approveChartInstance = null;
let buildChartInstance = null;

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

  if (filterYear) filterYear.value = String(currentYear);
  if (filterMonth) filterMonth.value = String(currentMonth);

  // สลับการแสดงผลตัวกรองวันที่
  bind('filterType', handleTypeChange);
  bind('filterMonth', handleDateUpdate);
  bind('filterYear', handleDateUpdate);
  bind('btnLoadReport', loadReport);

  // สร้างรายชื่อตัวเลือกวันที่
  populateDays(currentYear, currentMonth, currentDay);
  
  // โหลดรายงานรอบแรก
  await loadReport();
}

// เมื่อเปลี่ยนประเภทรายงาน (รายเดือน vs รายวัน)
function handleTypeChange() {
  const type = document.getElementById('filterType').value;
  const dayContainer = document.getElementById('filterDayContainer');
  if (dayContainer) {
    dayContainer.style.display = type === 'daily' ? 'block' : 'none';
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

// ยิงโหลดข้อมูลรายงานสรุปผลสถิติ
async function loadReport() {
  setButtonLoading('btnLoadReport', true, 'Loading...');
  
  const type = document.getElementById('filterType').value;
  const year = document.getElementById('filterYear').value;
  const month = document.getElementById('filterMonth').value;
  const day = document.getElementById('filterDay').value;

  let queryPath = `/api/report-summary?type=${type}&year=${year}&month=${month}`;
  if (type === 'daily') {
    queryPath += `&day=${day}`;
  }

  try {
    const r = await safeFetchJson(queryPath);
    if (r.parseError || !r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      showBox('reportResult', '❌ เกิดข้อผิดพลาดในการโหลดรายงาน: ' + escapeHtml(d.error || 'ไม่สามารถโหลดข้อมูลสถิติได้') +
        '<br/><small>' + escapeHtml(d.detail || '') + '</small>', 'error');
      clearStatsUi();
      return;
    }

    // ซ่อนกล่องแจ้งเตือนหากไม่มีเออเรอร์
    const resultBox = document.getElementById('reportResult');
    if (resultBox) resultBox.hidden = true;

    const data = r.data;
    renderStatsUi(data);

  } catch (err) {
    showBox('reportResult', '❌ เกิดข้อผิดพลาดร้ายแรง: ' + escapeHtml(err.message), 'error');
    clearStatsUi();
  } finally {
    setButtonLoading('btnLoadReport', false);
  }
}

// เคลียร์ UI ข้อมูลสรุปและกราฟ
function clearStatsUi() {
  setText('statTotalPrs', '-');
  setText('statAutoApproveRate', '-');
  setText('statTotalDeploys', '-');
  setText('statBuildSuccessRate', '-');

  destroyCharts();

  const activeList = document.getElementById('activeReposList');
  const failedList = document.getElementById('failedReposList');
  if (activeList) activeList.innerHTML = '<div class="empty-state">— ไม่มีข้อมูลสรุปสถิติ —</div>';
  if (failedList) failedList.innerHTML = '<div class="empty-state">— ไม่มีข้อมูลสรุปสถิติ —</div>';
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
}

// เรนเดอร์ข้อมูลสถิติ ตัวเลข กราฟ และอันดับ Repository
function renderStatsUi(data) {
  const stats = data.stats || {};
  
  // 1) อัปเดต KPI Cards
  setText('statTotalPrs', String(stats.totalPrs || 0));
  setText('statAutoApproveRate', stats.totalPrs > 0 ? `${stats.autoApproveRate}%` : '0%');
  setText('statTotalDeploys', String(stats.totalDeploys || 0));
  setText('statBuildSuccessRate', stats.totalDeploys > 0 ? `${stats.deploySuccessRate}%` : '0%');

  // 2) วาดกราฟและอัปเดต Chart.js
  destroyCharts();

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
}

// เริ่มต้นเรียกทำงานสคริปต์
bind(window, 'DOMContentLoaded', init);
export { init };
