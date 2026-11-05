import { escapeHtml } from './core.js';
import { renderCommit } from './deployment-commit.js?v=20261105-1';

const esc = value => escapeHtml(String(value ?? ''));
const date = value => value ? new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '-';
function run(item) {
  if (!item) return 'ยังไม่พบงานสำเร็จ';
  const label = `${item.pullRequestId ? `PR #${item.pullRequestId}` : 'ไม่ทราบ PR'} · ${item.runName || item.runId || '-'} · ${item.result || item.status || 'unknown'}`;
  let href;
  try { const url = new URL(item.url); if (url.protocol === 'https:') href = url.href; } catch {}
  return `${href ? `<a href="${esc(href)}" target="_blank" rel="noreferrer">${esc(label)}</a>` : esc(label)}<br><small>${esc(date(item.completedAt || item.eventCreatedAt))}</small><br>${renderCommit(item)}`;
}

const labels = { unknown: 'ยังไม่มีข้อมูล CI', 'ci-failed': 'CI ล้มเหลว', 'ci-pending': 'CI ยังไม่สำเร็จ', 'awaiting-cd-evidence': 'CI สำเร็จ · ยังไม่พบ CD ของ Build นี้', 'cd-failed': 'CD ล้มเหลว', 'cd-pending': 'CD ยังไม่สำเร็จ', succeeded: 'CI / CD สำเร็จ' };
function projectCard(project) {
  return `<article class="deployment-card tracking-project"><div class="tracking-project-heading"><h2>${esc(project.name)}</h2><span class="result-pill ${project.status === 'succeeded' ? 'result-succeeded' : project.status.endsWith('failed') ? 'result-failed' : ''}">${esc(labels[project.status] || project.status)}</span></div>
    <p>${esc(project.repositoryName)} · ${esc(project.environment)}</p><button type="button" class="secondary-button live-history-button" data-project="${esc(project.key)}">ดึงประวัติจาก Azure DevOps</button><div class="tracking-stages"><div><h3>CI · ${esc(project.ciPipeline)}</h3>${project.ci ? run(project.ci) : 'ยังไม่ได้รับประวัติ CI ในแหล่งข้อมูลนี้'}</div><div><h3>CD · ${esc(project.cdPipeline)}</h3>${project.cd ? run(project.cd) : 'ยังไม่พบ Release ที่อ้างอิง CI ล่าสุด'}</div></div>
    <p>CI fail <strong>${project.ciFailed}</strong> ครั้ง · CD fail <strong>${project.cdFailed}</strong> ครั้ง · ยังไม่กลับมาสำเร็จ <strong>${project.openFailures}</strong> ครั้ง</p>
    ${project.reusedBuild ? `<p class="monitor-alert medium">Release ล่าสุดใช้ Build เก่า จึงยังไม่ถือว่า CI ล่าสุด deploy สำเร็จ</p>` : ''}
    ${project.latestDeployment && !project.cd ? `<p>Deploy ล่าสุดที่ได้รับ: ${run(project.latestDeployment)}</p>` : ''}
    <details><summary>ประวัติ Fail และ PR ที่กลับมาสำเร็จ</summary><div class="table-wrap"><table class="records-table"><thead><tr><th>ขั้นตอน / งานที่ Fail</th><th>งานสำเร็จถัดไป</th></tr></thead><tbody>${project.failures.map(failure => `<tr><td>${esc(failure.failed.sourceType === 'build' ? 'CI' : 'CD')}<br>${run(failure.failed)}</td><td>${run(failure.recovery)}</td></tr>`).join('') || '<tr><td colspan="2">ไม่พบ Fail ในข้อมูลที่ได้รับ</td></tr>'}</tbody></table></div><p>งานสำเร็จถัดไปยังไม่ใช่การยืนยันว่าแก้ปัญหาใบเดิม</p></details></article>`;
}

export function initTracking() {
  const host = document.createElement('section');
  host.id = 'prTracking'; host.hidden = true;
  host.innerHTML = `<div class="deployment-heading"><div><h1>ติดตาม PR / CI-CD</h1><p>ติดตาม Fail และงานที่กลับมาสำเร็จ แยกตาม Pipeline / Branch / Environment / Stage</p></div><button id="trackingRefresh" class="primary-button" type="button">Refresh</button></div>
    <div class="deployment-card tracking-filters"><label>ค้นหา Project / Pipeline / PR<input id="trackingSearch" type="search"></label><label>Environment<select id="trackingEnvironment"><option value="">ทั้งหมด</option><option>Staging</option><option>Production</option><option>Development</option><option>Other</option></select></label><label>สถานะ<select id="trackingState"><option value="">ทั้งหมด</option><option value="open">ยังไม่กลับมาสำเร็จ</option><option value="recovered">มี Fail และกลับมาสำเร็จแล้ว</option></select></label></div>
    <p id="trackingMessage" role="status"></p><div id="trackingCounts" class="event-summary"></div><h2>ติดตามราย Project</h2><div id="trackingProjects"></div><details><summary>ดูประวัติแยก Pipeline / Stage ทั้งหมด</summary><div id="trackingGroups"></div></details>`;
  document.querySelector('.deployment-content').append(host);
  const nav = document.querySelector('.nav-links');
  const button = document.createElement('button'); button.type = 'button'; button.className = 'nav-link'; button.textContent = 'ติดตาม PR / CI-CD';
  nav.append(button);
  const events = document.getElementById('view-events');
  const eventsLink = nav.querySelector('a');
  let tracking = null;
  let pending = false;
  let liveProject = '';
  function render() {
    if (!tracking) return;
    const search = document.getElementById('trackingSearch').value.trim().toLowerCase();
    const env = document.getElementById('trackingEnvironment').value;
    const state = document.getElementById('trackingState').value;
    const groups = tracking.groups.filter(group => (!env || group.environment === env) &&
      (!search || [group.projectName, group.pipelineName, group.repositoryName, ...group.events.map(item => item.pullRequestId || '')].join(' ').toLowerCase().includes(search)) &&
      (!state || (state === 'open' ? group.openFailures > 0 : group.failedRuns > 0 && !group.openFailures)));
    const projects = (tracking.projects || []).filter(project => (!env || project.environment === env) &&
      (!search || [project.name, project.repositoryName, project.ciPipeline, project.cdPipeline, ...project.timeline.map(item => item.pullRequestId || '')].join(' ').toLowerCase().includes(search)) &&
      (!state || (state === 'open' ? project.openFailures > 0 : project.ciFailed + project.cdFailed > 0 && !project.openFailures)));
    document.getElementById('trackingProjects').innerHTML = projects.map(projectCard).join('') || '<p>ไม่พบ Project ที่มี mapping ตรงกับตัวกรอง สามารถดูรายการ Pipeline ด้านล่างได้</p>';
    document.querySelectorAll('.live-history-button').forEach(button => button.addEventListener('click', () => { liveProject = button.dataset.project; load(); }));
    document.getElementById('trackingCounts').innerHTML = [['Pipelines / Stages', groups.length], ['Runs / Attempts', groups.reduce((n,g) => n + g.totalRuns, 0)], ['Failed', groups.reduce((n,g) => n + g.failedRuns, 0)], ['ยังไม่กลับมาสำเร็จ', groups.reduce((n,g) => n + g.openFailures, 0)]].map(([label,n]) => `<div><strong>${n}</strong><span>${esc(label)}</span></div>`).join('');
    document.getElementById('trackingGroups').innerHTML = groups.map(group => `<article class="deployment-card tracking-group"><h2>${esc(group.pipelineName)}</h2><p>${esc(group.projectName)} · ${esc(group.repositoryName || 'ไม่ทราบ Repository')} · ${esc(group.environment)} · ${esc(group.sourceType === 'build' ? 'CI' : 'CD')} · ${esc(group.stageName)}</p>
      ${group.openFailures ? `<p class="monitor-alert" role="status">พบ ${group.openFailures} Fail ที่ยังไม่กลับมาสำเร็จในข้อมูลที่ได้รับ</p>` : ''}<p>งานล่าสุด: ${run(group.latest)}</p>
      <details><summary>ประวัติ ${group.totalRuns} Runs / Attempts · Fail ${group.failedRuns} ครั้ง</summary><div class="table-wrap"><table class="records-table"><thead><tr><th>งานที่ Fail</th><th>งานที่สำเร็จถัดไป</th><th>สถานะ</th></tr></thead><tbody>${[...group.failures].reverse().map(failure => `<tr><td>${run(failure.failed)}</td><td>${run(failure.recovery)}</td><td>${failure.recovery ? 'กลับมาสำเร็จ (ยังไม่ยืนยันว่าแก้ใบเดิม)' : 'ยังไม่พบงานสำเร็จ'}</td></tr>`).join('') || '<tr><td colspan="3">ไม่พบ Fail</td></tr>'}</tbody></table></div><h3>ลำดับงาน</h3><ol>${[...group.events].reverse().map(item => `<li>${run(item)}${item.pullRequestTitle ? `<br>${esc(item.pullRequestTitle)}` : ''}</li>`).join('')}</ol></details></article>`).join('') || '<p>ไม่พบข้อมูลที่ตรงกับตัวกรอง</p>';
  }
  async function load() {
    if (pending) return;
    pending = true;
    const message = document.getElementById('trackingMessage');
    message.textContent = 'กำลังโหลดประวัติ...';
    document.getElementById('trackingRefresh').disabled = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`/api/ado-pr-build-tracking${liveProject ? `?liveProject=${encodeURIComponent(liveProject)}` : ''}`, { credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error ? `${error.error}${error.adoStatus ? ` (ADO ${error.adoStatus})` : ''}` : `โหลดข้อมูลไม่สำเร็จ (${response.status})`); }
      const body = await response.json();
      if (!Array.isArray(body.tracking?.groups)) throw new Error('รูปแบบข้อมูลไม่ถูกต้อง');
      tracking = body.tracking; render();
      message.textContent = `อัปเดต ${date(new Date().toISOString())} · เวลาไทย · ${body.history ? `อ่านจาก Azure DevOps ด้วยบัญชีคุณ: ${body.history.buildCount} Builds / ${body.history.releaseCount} Releases (ล่าสุดสูงสุดอย่างละ 20 รายการ)` : 'เฉพาะ Hook ที่ระบบได้รับ · กดดึงประวัติจาก Azure DevOps เพื่อดูข้อมูลย้อนหลัง'}`;
    } catch (error) { tracking = null; for (const id of ['trackingGroups', 'trackingProjects', 'trackingCounts']) document.getElementById(id).replaceChildren(); message.textContent = error.name === 'AbortError' ? 'โหลดข้อมูลเกินเวลา กด Refresh เพื่อลองใหม่' : error.message; }
    finally { clearTimeout(timer); pending = false; document.getElementById('trackingRefresh').disabled = false; }
  }
  button.addEventListener('click', () => { events.hidden = true; host.hidden = false; eventsLink.classList.remove('nav-link-active'); button.classList.add('nav-link-active'); if (!tracking) load(); });
  eventsLink.addEventListener('click', event => { event.preventDefault(); host.hidden = true; events.hidden = false; button.classList.remove('nav-link-active'); eventsLink.classList.add('nav-link-active'); });
  document.getElementById('trackingRefresh').addEventListener('click', load);
  for (const id of ['trackingSearch', 'trackingEnvironment', 'trackingState']) document.getElementById(id).addEventListener('input', render);
  window.setInterval(() => { if (!document.hidden && !host.hidden) load(); }, 60000);
}
