import { escapeHtml } from './core.js';
import { renderCommit } from './deployment-commit.js?v=20261105-1';
const esc = value => escapeHtml(String(value ?? ''));
const formatDate = value => value ? new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '-';
const labels = { succeeded: 'สำเร็จ', failed: 'ล้มเหลว', canceled: 'ยกเลิก', cancelled: 'ยกเลิก', partiallySucceeded: 'สำเร็จบางส่วน', 'not-found': 'ไม่พบในประวัติที่อ่าน', 'not-checked': 'ยังไม่ตรวจสอบ', unknown: 'ไม่ทราบผล', inProgress: 'กำลังทำงาน', notStarted: 'ยังไม่เริ่ม' };
const comparisons = { 'not-verified': 'STG / PRD: ยังยืนยันเวอร์ชันเดียวกันไม่ได้', 'same-build': 'STG / PRD: commit และ Build artifact เดียวกัน', 'same-source-different-build': 'STG / PRD: commit เดียวกัน แต่คนละ Build', 'same-source-artifact-unknown': 'STG / PRD: commit เดียวกัน · ยังไม่ยืนยัน artifact' };
function status(value) {
  return `<span class="result-pill ${value === 'succeeded' ? 'result-succeeded' : value === 'failed' ? 'result-failed' : ''}">${esc(labels[value] || value || 'ไม่ทราบผล')}</span>`;
}
function runLink(item) {
  if (!item) return 'ยังไม่ตรวจสอบ';
  const label = esc(item.runName || item.runId || '-');
  let href;
  try { const url = new URL(item.url); if (url.protocol === 'https:' && url.hostname === 'dev.azure.com') href = url.href; } catch {}
  return `${href ? `<a href="${esc(href)}" target="_blank" rel="noreferrer">${label}</a>` : label}<br>${status(item.result || item.status)}<br><small>${esc(formatDate(item.completedAt || item.eventCreatedAt))}</small>`;
}
function deployCell(environment) {
  return `${environment.latest ? runLink(environment.latest) : status(environment.status)}${environment.latestSuccessful ? '<br><small class="version-current">ล่าสุดที่ Deploy สำเร็จใน Pipeline นี้</small>' : ''}${environment.latest ? `<br><small>${environment.sameBuildAsLatestCI ? 'Artifact ตรงกับ CI ล่าสุดของ commit นี้' : 'ยังไม่ยืนยันว่าเป็น Build เดียวกับ CI ล่าสุด'}</small>` : ''}`;
}
export function initVersionExplorer(onSearch) {
  const host = document.getElementById('commitExplorer');
  host.innerHTML = `<section class="deployment-card version-explorer"><h2>ตรวจสอบ Commit / เวอร์ชันที่ Deploy</h2><p>ค้นหาโค้ดที่ต้องการตรวจสอบ แล้วดู Build และ Deploy ในแถวเดียว</p>
    <form id="versionForm" class="tracking-filters"><label>Project / แหล่งข้อมูล<select id="versionProject"><option value="oceanlife-web-stg">oceanlife-web-stg · Azure DevOps</option><option value="">ทุก Project · Events ที่เก็บไว้</option></select></label>
    <label>เลข Commit (เต็มหรือย่อ)<input id="versionCommit" type="search" minlength="7" maxlength="40" pattern="[a-fA-F0-9]{7,40}" placeholder="เช่น 859a8141" title="Commit 7–40 ตัวอักษร ใช้ 0–9 และ a–f"></label>
    <label>ประวัติ Azure DevOps<select id="versionLimit"><option value="20">ล่าสุด 20 Builds / Releases</option><option value="100">ล่าสุด 100 Builds / Releases</option></select></label>
    <button id="versionSubmit" type="submit" class="primary-button">ตรวจสอบ</button><button id="versionClear" type="button" class="secondary-button">ดูทุก Commit</button></form>
    <p id="versionScope" role="status"></p><div id="versionCounts" class="event-summary"></div><div id="versionResults"></div>
    <p class="version-help">“ล่าสุดที่ Deploy สำเร็จ” อ้างอิงผล Pipeline ในประวัติที่อ่าน ยังไม่ได้ตรวจเวอร์ชันที่เครื่องปลายทางกำลังรันจริง · Pipeline stage ทั่วไปจะไม่ถูกนับเป็น Deploy โดยอัตโนมัติ</p></section>`;
  let response = null; let page = 1;
  const form = document.getElementById('versionForm');
  form.addEventListener('submit', event => { event.preventDefault(); onSearch(); });
  document.getElementById('versionProject').addEventListener('change', onSearch);
  document.getElementById('versionLimit').addEventListener('change', onSearch);
  document.getElementById('versionClear').addEventListener('click', () => { document.getElementById('versionCommit').value = ''; onSearch(); });
  function render() {
    if (!response?.versions) return;
    const { versions, history } = response;
    const rows = versions.rows;
    const scope = document.getElementById('versionScope');
    scope.textContent = `${history ? `Azure DevOps · ${history.buildCount} Builds / ${history.releaseCount} Releases · อ่านล่าสุดสูงสุดอย่างละ ${history.limit || 20} รายการ` : 'Events ที่ระบบได้รับเท่านั้น · ประวัติที่ไม่เคยส่งเข้า Hook อาจยังไม่ปรากฏ'}${versions.ambiguous ? ' · เลขย่อตรงหลาย commit/repository โปรดเลือกดูรายละเอียดแถวที่ต้องการ' : ''}`;
    document.getElementById('versionCounts').innerHTML = [['Commits', rows.length], ['Builds ไม่ซ้ำ', versions.buildCount], ['Deploy attempts ไม่ซ้ำ', versions.deploymentCount]].map(([label,value]) => `<div><strong>${value}</strong><span>${esc(label)}</span></div>`).join('');
    page = Math.min(page, Math.max(1, Math.ceil(rows.length / 50)));
    const pageRows = rows.slice((page - 1) * 50, page * 50);
    const markup = pageRows.map(row => `<tr><td>${renderCommit({ ...row.latest, sourceVersion: row.commit })}<br><small>${esc(row.repositoryName)}</small><br><small>${esc(row.message || 'เปิดรายละเอียดเพื่อดู PR / Build')}</small><br><small>${esc(comparisons[row.comparison])}</small></td>
      <td>${row.prs.length ? row.prs.map(id => `#${esc(id)}`).join(', ') : 'ยังไม่พบความสัมพันธ์กับ PR'}</td><td>${runLink(row.latestBuild)}<br><small>${row.buildCount} Builds ของ commit นี้</small></td>
      <td>${deployCell(row.environments.Staging)}</td><td>${deployCell(row.environments.Production)}</td><td><details><summary>รายละเอียด / ประวัติ</summary><p>Commit เต็ม: <code class="full-commit">${esc(row.commit)}</code></p><p>${esc(row.message)}</p>
      <p>${row.buildCount > 1 ? 'โค้ด commit เดียวกัน แต่มีหลาย Build โปรดตรวจ Build ID ของ artifact ก่อนสรุปว่าเป็นผลผลิตเดียวกัน' : 'เปรียบเทียบ commit ร่วมกับ Build ID ของ Release artifact'}</p>
      <ol>${row.items.map(item => `<li><strong>${esc(item.sourceType === 'build' ? 'CI Build' : item.sourceType === 'classic-release' ? `Deploy ${item.environmentGroup}` : 'Pipeline stage')}</strong> · ${esc(item.pipelineName)} · ${esc(item.stageName)}<br>${runLink(item)}${item.pullRequestId ? `<br>PR #${esc(item.pullRequestId)} · ${esc(item.pullRequestTitle || '')}` : ''}</li>`).join('')}</ol></details></td></tr>`).join('');
    document.getElementById('versionResults').innerHTML = rows.length ? `<div class="table-wrap"><table class="records-table version-table"><thead><tr><th>Commit / Repository</th><th>PR</th><th>CI Build ล่าสุด</th><th>Deploy STG</th><th>Deploy PRD</th><th>ตรวจสอบ</th></tr></thead><tbody>${markup}</tbody></table></div><div class="event-pagination"><span>หน้า ${page} / ${Math.max(1,Math.ceil(rows.length/50))} · เรียงกิจกรรมล่าสุดก่อน</span><div><button id="versionsPrev" ${page === 1 ? 'disabled' : ''}>ก่อนหน้า</button><button id="versionsNext" ${page * 50 >= rows.length ? 'disabled' : ''}>ถัดไป</button></div></div>` : '<p class="version-empty">ไม่พบ commit ในขอบเขตข้อมูลที่อ่าน ลองเพิ่มประวัติเป็น 100 รายการ หรือเลือกแหล่งข้อมูลอื่น ผลนี้ไม่ได้ยืนยันว่า commit ไม่มีอยู่ใน Azure DevOps</p>';
    document.getElementById('versionsPrev')?.addEventListener('click', () => { page--; render(); });
    document.getElementById('versionsNext')?.addEventListener('click', () => { page++; render(); });
    const select = document.getElementById('versionProject');
    for (const project of response.availableProjects || []) {
      if (![...select.options].some(option => option.value === project.key)) { const option = document.createElement('option'); option.value = project.key; option.textContent = `${project.name} · Azure DevOps`; select.append(option); }
    }
  }
  return {
    params() { const params = new URLSearchParams(); const project = document.getElementById('versionProject').value;
      if (project) { params.set('liveProject', project); params.set('limit', document.getElementById('versionLimit').value); }
      const commit = document.getElementById('versionCommit').value.trim(); if (commit) params.set('commit', commit); return params; },
    setProject(key) { document.getElementById('versionProject').value = key; },
    setBusy(value) { document.getElementById('versionSubmit').disabled = value; },
    render(body) { response = body; page = 1; render(); },
    error(message) { response = null; document.getElementById('versionResults').textContent = message; document.getElementById('versionCounts').replaceChildren(); document.getElementById('versionScope').textContent = 'ยังตรวจสอบไม่สำเร็จ · ไม่ใช่ผลยืนยันว่าไม่มี Build หรือ Deploy'; }
  };
}
