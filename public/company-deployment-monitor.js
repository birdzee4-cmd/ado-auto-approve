import { escapeHtml } from './core.js';
import { bangkokToday } from './deployment-dates.js';
const esc = value => escapeHtml(String(value ?? ''));
const labels = { complete: 'สำเร็จ', 'build fail': 'Build ล้มเหลว', 'deploy fail': 'Deploy ล้มเหลว', 'cancel deploy': 'ยกเลิก', building: 'กำลัง Build' };
const environments = ['Development', 'Staging', 'Production', 'Other'];
export function initCompanyMonitor() {
  const host = document.createElement('section'); host.id = 'companyMonitor'; host.hidden = true;
  host.innerHTML = `<div class="deployment-heading"><div><p class="deployment-kicker">Company deployment monitor</p><h1>Monitor งานประจำวัน</h1><p>ข้อมูลจากระบบ Monitor บริษัท · จบทั้งหมดรวมงานสำเร็จ ล้มเหลว และยกเลิก</p></div><button type="button" class="primary-button" id="companyRefresh">Refresh</button></div>
    <div class="deployment-card tracking-filters"><label>ค้นหา Project / ประเภท / Build / ผู้ขอ<input id="companySearch" type="search"></label><label>วันที่ข้อมูล<input id="companyDate" type="date" value="${bangkokToday()}" max="${bangkokToday()}"></label></div>
    <p id="companyMessage" role="status" aria-live="polite">ยังไม่ได้โหลดข้อมูล</p><p id="companyCoverage" class="heading-help">อ่านประวัติจาก Azure ตามวัน Update ของ Monitor · เก็บเบื้องหลังทุก 1 นาที · หน้าจอ Refresh ด้วยตนเอง</p><p class="heading-help">กดชื่อ Project เพื่อดูทุกงานของวันนั้น · กลับมาสำเร็จอิง Monitor ใน Project / Environment / ประเภท / Branch เดียวกัน ยังไม่ยืนยัน Commit หรือ Artifact</p><div id="companyBoard" class="company-board"></div><dialog id="companyProjectDetail" class="company-project-detail" aria-labelledby="companyProjectTitle"><button type="button" id="companyProjectClose" class="secondary-button">ปิด</button><div id="companyProjectBody"></div></dialog>`;
  document.querySelector('.deployment-content').append(host);
  const developmentToggle = document.createElement('button');
  developmentToggle.type = 'button'; developmentToggle.className = 'secondary-button';
  developmentToggle.textContent = 'View Development'; developmentToggle.style.margin = '0 0 8px';
  host.querySelector('#companyBoard').classList.add('company-hide-development');
  host.querySelector('#companyBoard').before(developmentToggle);
  const nav = document.querySelector('.nav-links');
  const tab = document.createElement('button'); tab.type = 'button'; tab.className = 'nav-link'; tab.textContent = 'Monitor งานประจำวัน'; nav.prepend(tab);
  nav.addEventListener('click', event => {
    if (!event.target.closest('.nav-link')) return;
    for (const id of ['view-events', 'prTracking', 'companyMonitor']) document.getElementById(id).hidden = true;
    nav.querySelectorAll('.nav-link').forEach(link => link.classList.remove('nav-link-active'));
  }, true);
  const $ = id => document.getElementById(id);
  let items = null, pending = false, tracking = null;
  const selectedStatuses = new Map();
  const projectViews = new Map();
  const time = value => value ? new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '-';
  const elapsed = seconds => seconds < 60 ? `${seconds} วินาที` : seconds < 3600 ? `${Math.floor(seconds / 60)} นาที` : `${Math.floor(seconds / 3600)} ชม. ${Math.floor(seconds % 3600 / 60)} นาที`;
  const buildLink = item => item ? `<a href="https://dev.azure.com/buzzebees/Buzzebees/_build/results?buildId=${encodeURIComponent(item.azureBuildId || item.id.replace(/_[MP]$/, ''))}" target="_blank" rel="noreferrer">${esc(item.id)}</a>` : '-';
  const projectLink = (project, environment) => `<button type="button" class="company-project-link" data-project="${esc(project)}" data-env="${esc(environment)}">${esc(project)}</button>`;
  const matchForItem = item => {
    for (const project of tracking?.projects || []) for (const failure of project.failures || []) {
      if (String(failure.failed?.id) === String(item.id)) return { side: 'failed', match: failure };
      if (String(failure.recovery?.id) === String(item.id)) return { side: 'recovery', match: failure };
    }
    return null;
  };
  const correlationText = failure => ({
    'same-build': 'จับคู่แล้ว · Build เดิม',
    'same-pipeline': 'จับคู่แล้ว · Pipeline เดิม',
    'same-commit-cross-pipeline': 'จับคู่แล้ว · Pipeline เปลี่ยน',
    'same-commit-cross-project': 'จับคู่แล้ว · Project/Type เปลี่ยน',
    'legacy-replacement': 'จับคู่แล้ว · Legacy Mapping'
  }[failure?.correlationType] || 'ยังไม่ยืนยันการจับคู่');
  function card(item) {
    const link = item.azureBuildId ? `https://dev.azure.com/buzzebees/Buzzebees/_build/results?buildId=${encodeURIComponent(item.azureBuildId)}` : '';
    const tone = item.status === 'complete' ? 'success' : item.status.includes('fail') ? 'failure' : 'pending';
    const relation = matchForItem(item);
    const relationText = relation?.match?.recovery ? correlationText(relation.match) : item.status.includes('fail') ? 'รอตรวจสอบ Build Success' : '';
    const relationDetail = relation?.match?.recovery ? ` · ${relation.side === 'failed' ? `Success ${relation.match.recovery.id}` : `แก้ไข Fail ${relation.match.failed.id}`} · ${relation.match.confidence === 'high' ? 'ความมั่นใจสูง' : 'ความมั่นใจปานกลาง'}` : '';
    const commit = String(item.commitId || '').trim();
    const commitLabel = commit ? commit.slice(0, 8) : 'ไม่พบ Commit';
    return `<article class="company-job company-${tone}${item.status === 'build fail' ? ' company-build-failed' : ''}"><div class="tracking-project-heading"><h3>${projectLink(item.project, item.environment)}</h3><span class="result-pill">${esc(labels[item.status] || item.status)}</span></div>${relationText ? `<p class="company-correlation"><strong>${esc(relationText)}</strong>${esc(relationDetail)}</p>` : ''}<p>${esc(item.projectType || 'ไม่ระบุประเภท')}</p><dl><dt>Build / งาน</dt><dd>${link ? `<a href="${esc(link)}" target="_blank" rel="noreferrer">${esc(item.id)}</a>` : esc(item.id)}</dd><dt>Commit</dt><dd title="${esc(commit || 'ไม่พบ Commit')}">${esc(commitLabel)}</dd><dt>Branch</dt><dd>${esc(item.branch.replace(/^refs\/heads\//, ''))}</dd><dt>ผู้ขอ</dt><dd>${esc(item.requestedBy || '-')}</dd><dt>Update</dt><dd>${esc(item.updatedText)}</dd><dt>ระยะเวลา</dt><dd>${esc(item.duration || '-')}</dd></dl></article>`;
  }
  function projectSummary(env, jobs) {
    if (!tracking) return '<p>ยังไม่มีข้อมูลติดตาม Project</p>';
    const names = new Set(jobs.map(item => item.project));
    const projects = tracking.projects.filter(item => item.environment === env && names.has(item.name));
    const mode = projectViews.get(env) || 'open';
    const shown = projects.filter(item => mode === 'all' || (mode === 'open' ? item.openCount > 0 : item.failedCount > 0 && !item.openCount));
    const button = (view, label, count) => `<button type="button" class="company-status-link" data-project-view="${view}" data-env="${env}" aria-pressed="${mode === view}">${label} ${count}</button>`;
    return `<div class="company-project-summary"><h3>ติดตามปัญหาภายในวัน</h3><p>${button('open', 'ยังมีปัญหา', projects.filter(item => item.openCount).length)} · ${button('recovered', 'กลับมาสำเร็จ', projects.filter(item => item.failedCount && !item.openCount).length)} · ${button('all', 'ทุก Project', projects.length)}</p><small>จำนวน Project · Fail แยกประเภท/Branch · กดชื่อดูประวัติทั้งวัน</small>${shown.map(project => `<article class="company-job ${project.openCount ? 'company-build-failed' : 'company-success'}"><h3>${projectLink(project.name, env)}</h3><p><strong>${project.openCount ? project.retrying ? 'ยังมี Fail · กำลังลองใหม่' : 'ยังไม่พบงานสำเร็จที่ยืนยันได้' : project.failedCount ? 'กลับมาสำเร็จตาม Monitor' : 'ไม่พบ Fail'}</strong></p><p>Build fail ค้าง ${project.openBuild} · Deploy fail ค้าง ${project.openDeploy} ครั้ง</p><p>ทั้งวัน ${project.totalRuns} งาน · Fail ${project.failedCount} · กลับมาสำเร็จ ${project.recoveredCount} ครั้ง</p><p>ล่าสุด ${buildLink(project.latest)} · ${esc(labels[project.latest.status] || project.latest.status)} · ${esc(time(project.latest.latestUpdateAt || project.latest.updatedAt))}</p>${project.openCount ? `<p>Fail ล่าสุด ${esc(time(project.lastFailureAt))} · ค้างนานสุด ${esc(elapsed(Math.max(...project.failures.filter(f => !f.recovery).map(f => f.durationSeconds))))}</p>` : ''}</article>`).join('') || '<p>ไม่พบ Project ในกลุ่มนี้</p>'}</div>`;
  }
  function openProject(name, environment) {
    const project = tracking?.projects.find(item => item.name === name && item.environment === environment);
    if (!project) return;
    $('companyProjectBody').innerHTML = `<h2 id="companyProjectTitle">${esc(name)}</h2><p>${esc(environment)} · วันที่ ${esc(tracking.date)} · ประวัติทั้งวัน ไม่จำกัดตัวกรองสถานะบนหน้าหลัก</p><p>${project.totalRuns} งาน · Fail ${project.failedCount} ครั้ง · กลับมาสำเร็จ ${project.recoveredCount} ครั้ง · Build fail ค้าง ${project.openBuild} · Deploy fail ค้าง ${project.openDeploy}</p><p class="heading-help">${esc(tracking.note)} · ระยะเวลาค้างนับถึง ${esc(time(tracking.asOf))}</p><h3>Fail และงานสำเร็จถัดไป</h3><div class="table-wrap"><table class="records-table"><thead><tr><th>งานที่ Fail / ประเภท / Branch</th><th>เวลา Fail</th><th>งานสำเร็จถัดไป</th><th>ผลติดตาม</th></tr></thead><tbody>${project.failures.map(failure => `<tr><td>${buildLink(failure.failed)} · ${esc(labels[failure.failed.status])}<br>${esc(failure.failed.projectType)} · ${esc(failure.failed.branch)}</td><td>${esc(time(failure.failed.updatedAt))}</td><td>${failure.recovery ? `${buildLink(failure.recovery)}<br>${esc(time(failure.recovery.updatedAt))}<br>กลับมาสำเร็จภายใน ${esc(elapsed(failure.durationSeconds))}` : failure.candidate ? `${buildLink(failure.candidate)}<br>พบ Complete ภายหลัง แต่ยังยืนยันว่าเป็น Build ใหม่หลัง Fail ไม่ได้` : '-'}</td><td>${failure.recovery ? 'กลับมาสำเร็จตาม Monitor' : failure.retry ? `กำลังลองใหม่: ${buildLink(failure.retry)}` : failure.candidate ? 'ยังไม่ปิด Fail · หลักฐานไม่พอ' : 'ยังไม่พบงานสำเร็จภายในวันนี้'}${!failure.recovery ? `<br>ค้าง ${esc(elapsed(failure.durationSeconds))}` : ''}</td></tr>`).join('') || '<tr><td colspan="4">ไม่พบ Fail ในประวัติที่เก็บได้</td></tr>'}</tbody></table></div><h3>ทุกงานและสถานะที่ตรวจพบ · ล่าสุดก่อน</h3><div class="table-wrap"><table class="records-table"><thead><tr><th>เวลา Update</th><th>Build / งาน</th><th>ผล</th><th>ประเภท / Branch</th><th>ผู้ขอ</th><th>ระยะเวลา</th></tr></thead><tbody>${project.timeline.map(item => `<tr class="${item.status.includes('fail') ? 'company-history-failed' : ''}"><td>${esc(time(item.updatedAt))}</td><td>${buildLink(item)}</td><td>${esc(labels[item.status] || item.status)}</td><td>${esc(item.projectType)}<br>${esc(item.branch)}</td><td>${esc(item.requestedBy || '-')}</td><td>${esc(item.duration || '-')}</td></tr>`).join('')}</tbody></table></div><p class="heading-help">Build เดิมเปลี่ยนสถานะจะแสดงหลายแถว แต่ไม่นับการ polling ซ้ำเป็นงานใหม่ ประวัติจำกัดเฉพาะวันที่เลือกและข้อมูลที่ระบบเคยตรวจพบ</p>`;
    $('companyProjectDetail').showModal();
  }
  function render() {
    if (!items) return;
    const search = $('companySearch').value.trim().toLowerCase(), day = $('companyDate').value;
    const filteredRows = items.filter(item => (!day || item.updatedAt.startsWith(day)) && (!search || [item.project, item.projectType, item.id, item.requestedBy, item.branch].join(' ').toLowerCase().includes(search)));
    const latest = new Map();
    for (const item of filteredRows) {
      const key = [item.environment, item.project, item.projectType, item.branch, item.id].join('|');
      const previous = latest.get(key);
      if (!previous || Date.parse(item.updatedAt) >= Date.parse(previous.updatedAt)) latest.set(key, item);
    }
    const rows = [...latest.values()];
    const recoveryPairs = new Map();
    tracking?.projects?.forEach(project => project.failures?.forEach(failure => {
      if (!failure.recovery) return;
      const failedId = String(failure.failed?.id || '');
      const recoveryId = String(failure.recovery?.id || '');
      if (failedId && recoveryId) { recoveryPairs.set(failedId, failedId); recoveryPairs.set(recoveryId, failedId); }
    }));
    rows.sort((a, b) => {
      const pairA = recoveryPairs.get(String(a.id)) || '';
      const pairB = recoveryPairs.get(String(b.id)) || '';
      if (pairA !== pairB) return pairA.localeCompare(pairB) || String(a.project).localeCompare(String(b.project));
      return (Date.parse(a.updatedAt) || 0) - (Date.parse(b.updatedAt) || 0);
    });
    $('companyBoard').innerHTML = environments.filter(env => env !== 'Other' || rows.some(item => item.environment === env)).map(env => {
      const jobs = rows.filter(item => item.environment === env), finished = jobs.filter(item => item.terminal), running = jobs.filter(item => !item.terminal);
      const count = status => jobs.filter(item => item.status === status).length;
      const selected = selectedStatuses.get(env) || '';
      const visible = selected ? finished.filter(item => item.status === selected) : finished;
      const statusButton = (status, label, number) => `<button type="button" class="company-status-link" data-env="${env}" data-status="${status}" aria-pressed="${selected === status}" aria-label="${esc(env)}: ${esc(label)} ${number} รายการ">${esc(label)} ${number}</button>`;
      return `<section class="company-column company-env-${env.toLowerCase()}"><h2>${env}</h2><div class="deployment-card"><strong>${statusButton('', 'จบทั้งหมด', finished.length)}</strong><p class="company-status-links">${statusButton('complete', 'สำเร็จ', count('complete'))} · ${statusButton('build fail', 'Build fail', count('build fail'))} · ${statusButton('deploy fail', 'Deploy fail', count('deploy fail'))} · ${statusButton('cancel deploy', 'ยกเลิก', count('cancel deploy'))}</p><small>ยอดตามคำค้นหา/วันที่ · ${new Set(jobs.map(item => item.project)).size} Project · กดสถานะเพื่อดูรายการ</small></div>${projectSummary(env, jobs)}${selected ? '' : `<h3>กำลังทำ ${running.length}</h3>${running.map(card).join('') || '<p>ไม่มีงานกำลังทำ</p>'}`}<h3 aria-live="polite">${esc(selected ? labels[selected] : 'จบแล้ว')} ${visible.length}</h3>${visible.map(card).join('') || '<p>ไม่พบรายการสถานะนี้</p>'}</section>`;
    }).join('');
  }
  async function load() {
    if (pending) return;
    const requestedDay = $('companyDate').value;
    if (!requestedDay) { items = null; $('companyBoard').replaceChildren(); $('companyMessage').textContent = 'กรุณาเลือกวันที่ในปฏิทิน'; return; }
    pending = true; $('companyRefresh').disabled = true; items = null; tracking = null; $('companyProjectDetail').close(); $('companyBoard').replaceChildren(); $('companyMessage').textContent = `กำลังอ่านประวัติวันที่ ${requestedDay} จาก Azure...`;
    try {
      const response = await fetch(`/api/company-deployment-monitor?date=${encodeURIComponent(requestedDay)}`, { credentials: 'same-origin', signal: AbortSignal.timeout(30000) });
      const body = await response.json(); if (!response.ok || !body.ok || !Array.isArray(body.items)) throw new Error(body.error || 'อ่านข้อมูลไม่สำเร็จ');
      if ($('companyDate').value !== requestedDay) return;
      items = body.items;
      tracking = body.tracking || null;
      const info = body.archive || {};
      const time = value => value ? new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : 'ยังไม่มี';
      $('companyMessage').textContent = info.snapshotId ? `ประวัติวันที่ ${requestedDay} · ${items.length} รายการ · บันทึกล่าสุด ${time(info.savedAt)}` : `ยังไม่มีข้อมูลที่บันทึกไว้สำหรับวันที่ ${requestedDay} (ไม่ได้หมายความว่าวันนี้ไม่มีงาน)`;
      const stale = !info.lastSuccessAt || Date.now() - Date.parse(info.lastSuccessAt) > 5 * 60000;
      $('companyCoverage').textContent = `${info.note || ''} · เริ่มเก็บ ${time(info.collectionStartedAt)} · เก็บสำเร็จล่าสุด ${time(info.lastSuccessAt)}${info.lastAttemptStatus === 'failed' || stale ? ' · ⚠ ข้อมูลอาจไม่ล่าสุด: งานเก็บข้อมูลขัดข้องหรือยังไม่สำเร็จใน 5 นาทีที่ผ่านมา' : ''}`;
      render();
    } catch (error) { if ($('companyDate').value === requestedDay) { items = null; $('companyBoard').replaceChildren(); $('companyMessage').textContent = error.name === 'TimeoutError' ? 'อ่านข้อมูลเกินเวลา กรุณากด Refresh อีกครั้ง' : error.message; } }
    finally { pending = false; $('companyRefresh').disabled = false; if ($('companyDate').value !== requestedDay) load(); }
  }
  tab.addEventListener('click', () => { document.body.classList.add('monitor-default'); host.hidden = false; tab.classList.add('nav-link-active'); if (!items) load(); });
  $('companyRefresh').addEventListener('click', load);
  $('companyBoard').addEventListener('click', event => {
    const project = event.target.closest('.company-project-link');
    if (project) { openProject(project.dataset.project, project.dataset.env); return; }
    const view = event.target.closest('[data-project-view]');
    if (view) {
      projectViews.set(view.dataset.env, view.dataset.projectView); render();
      [...$('companyBoard').querySelectorAll('[data-project-view]')].find(item => item.dataset.env === view.dataset.env && item.dataset.projectView === view.dataset.projectView)?.focus({ preventScroll: true });
      return;
    }
    const button = event.target.closest('.company-status-link');
    if (!button) return;
    const { env, status } = button.dataset;
    selectedStatuses.set(env, selectedStatuses.get(env) === status ? '' : status);
    render();
    [...$('companyBoard').querySelectorAll('.company-status-link')].find(item => item.dataset.env === env && item.dataset.status === status)?.focus({ preventScroll: true });
  });
  $('companySearch').addEventListener('input', render);
  $('companyProjectClose').addEventListener('click', () => $('companyProjectDetail').close());
  $('companyProjectDetail').addEventListener('click', event => {
    if (event.target === $('companyProjectDetail')) $('companyProjectDetail').close();
  });
  $('companyDate').addEventListener('change', () => { selectedStatuses.clear(); load(); });
  developmentToggle.addEventListener('click', () => {
    const hidden = $('companyBoard').classList.toggle('company-hide-development');
    developmentToggle.textContent = hidden ? 'View Development' : 'Hide Development';
  });
  return { activate: () => tab.click() };
}
