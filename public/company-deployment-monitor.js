import { escapeHtml } from './core.js';
import { bangkokToday } from './deployment-dates.js';
const esc = value => escapeHtml(String(value ?? ''));
const labels = { complete: 'สำเร็จ', 'build fail': 'Build ล้มเหลว', 'deploy fail': 'Deploy ล้มเหลว', 'cancel deploy': 'ยกเลิก', building: 'กำลัง Build' };
const environments = ['Development', 'Staging', 'Production', 'Other'];
export function initCompanyMonitor() {
  const host = document.createElement('section'); host.id = 'companyMonitor'; host.hidden = true;
  host.innerHTML = `<div class="deployment-heading"><div><p class="deployment-kicker">Company deployment monitor</p><h1>Monitor งานประจำวัน</h1><p>ข้อมูลจากระบบ Monitor บริษัท · จบทั้งหมดรวมงานสำเร็จ ล้มเหลว และยกเลิก</p></div><button type="button" class="primary-button" id="companyRefresh">Refresh</button></div>
    <div class="deployment-card tracking-filters"><label>ค้นหา Project / ประเภท / Build / ผู้ขอ<input id="companySearch" type="search"></label><label>วันที่ข้อมูล<input id="companyDate" type="date" value="${bangkokToday()}" max="${bangkokToday()}"></label></div>
    <p id="companyMessage" role="status" aria-live="polite">ยังไม่ได้โหลดข้อมูล</p><p id="companyCoverage" class="heading-help">อ่านประวัติจาก Azure ตามวัน Update ของ Monitor · เก็บเบื้องหลังทุก 1 นาที · หน้าจอ Refresh ด้วยตนเอง</p><div id="companyBoard" class="company-board"></div>`;
  document.querySelector('.deployment-content').append(host);
  const nav = document.querySelector('.nav-links');
  const tab = document.createElement('button'); tab.type = 'button'; tab.className = 'nav-link'; tab.textContent = 'Monitor งานประจำวัน'; nav.append(tab);
  nav.addEventListener('click', event => {
    if (!event.target.closest('.nav-link')) return;
    for (const id of ['view-events', 'prTracking', 'companyMonitor']) document.getElementById(id).hidden = true;
    nav.querySelectorAll('.nav-link').forEach(link => link.classList.remove('nav-link-active'));
  }, true);
  const $ = id => document.getElementById(id);
  let items = null, pending = false;
  const selectedStatuses = new Map();
  function card(item) {
    const link = item.azureBuildId ? `https://dev.azure.com/buzzebees/Buzzebees/_build/results?buildId=${encodeURIComponent(item.azureBuildId)}` : '';
    const tone = item.status === 'complete' ? 'success' : item.status.includes('fail') ? 'failure' : 'pending';
    return `<article class="company-job company-${tone}${item.status === 'build fail' ? ' company-build-failed' : ''}"><div class="tracking-project-heading"><h3>${esc(item.project)}</h3><span class="result-pill">${esc(labels[item.status] || item.status)}</span></div><p>${esc(item.projectType || 'ไม่ระบุประเภท')}</p><dl><dt>Build / งาน</dt><dd>${link ? `<a href="${esc(link)}" target="_blank" rel="noreferrer">${esc(item.id)}</a>` : esc(item.id)}</dd><dt>Branch</dt><dd>${esc(item.branch.replace(/^refs\/heads\//, ''))}</dd><dt>ผู้ขอ</dt><dd>${esc(item.requestedBy || '-')}</dd><dt>Update</dt><dd>${esc(item.updatedText)}</dd><dt>ระยะเวลา</dt><dd>${esc(item.duration || '-')}</dd></dl></article>`;
  }
  function render() {
    if (!items) return;
    const search = $('companySearch').value.trim().toLowerCase(), day = $('companyDate').value;
    const rows = items.filter(item => (!day || item.updatedAt.startsWith(day)) && (!search || [item.project, item.projectType, item.id, item.requestedBy, item.branch].join(' ').toLowerCase().includes(search)));
    $('companyBoard').innerHTML = environments.filter(env => env !== 'Other' || rows.some(item => item.environment === env)).map(env => {
      const jobs = rows.filter(item => item.environment === env), finished = jobs.filter(item => item.terminal), running = jobs.filter(item => !item.terminal);
      const count = status => jobs.filter(item => item.status === status).length;
      const selected = selectedStatuses.get(env) || '';
      const visible = selected ? finished.filter(item => item.status === selected) : finished;
      const statusButton = (status, label, number) => `<button type="button" class="company-status-link" data-env="${env}" data-status="${status}" aria-pressed="${selected === status}" aria-label="${esc(env)}: ${esc(label)} ${number} รายการ">${esc(label)} ${number}</button>`;
      return `<section class="company-column company-env-${env.toLowerCase()}"><h2>${env}</h2><div class="deployment-card"><strong>${statusButton('', 'จบทั้งหมด', finished.length)}</strong><p class="company-status-links">${statusButton('complete', 'สำเร็จ', count('complete'))} · ${statusButton('build fail', 'Build fail', count('build fail'))} · ${statusButton('deploy fail', 'Deploy fail', count('deploy fail'))} · ${statusButton('cancel deploy', 'ยกเลิก', count('cancel deploy'))}</p><small>ยอดตามคำค้นหา/วันที่ · ${new Set(jobs.map(item => item.project)).size} Project · กดสถานะเพื่อดูรายการ</small></div>${selected ? '' : `<h3>กำลังทำ ${running.length}</h3>${running.map(card).join('') || '<p>ไม่มีงานกำลังทำ</p>'}`}<h3 aria-live="polite">${esc(selected ? labels[selected] : 'จบแล้ว')} ${visible.length}</h3>${visible.map(card).join('') || '<p>ไม่พบรายการสถานะนี้</p>'}</section>`;
    }).join('');
  }
  async function load() {
    if (pending) return;
    const requestedDay = $('companyDate').value;
    if (!requestedDay) { items = null; $('companyBoard').replaceChildren(); $('companyMessage').textContent = 'กรุณาเลือกวันที่ในปฏิทิน'; return; }
    pending = true; $('companyRefresh').disabled = true; items = null; $('companyBoard').replaceChildren(); $('companyMessage').textContent = `กำลังอ่านประวัติวันที่ ${requestedDay} จาก Azure...`;
    try {
      const response = await fetch(`/api/company-deployment-monitor?date=${encodeURIComponent(requestedDay)}`, { credentials: 'same-origin', signal: AbortSignal.timeout(30000) });
      const body = await response.json(); if (!response.ok || !body.ok || !Array.isArray(body.items)) throw new Error(body.error || 'อ่านข้อมูลไม่สำเร็จ');
      if ($('companyDate').value !== requestedDay) return;
      items = body.items;
      const info = body.archive || {};
      const time = value => value ? new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : 'ยังไม่มี';
      $('companyMessage').textContent = info.snapshotId ? `ประวัติวันที่ ${requestedDay} · ${items.length} รายการ · บันทึกล่าสุด ${time(info.savedAt)}` : `ยังไม่มีข้อมูลที่บันทึกไว้สำหรับวันที่ ${requestedDay} (ไม่ได้หมายความว่าวันนี้ไม่มีงาน)`;
      const stale = !info.lastSuccessAt || Date.now() - Date.parse(info.lastSuccessAt) > 5 * 60000;
      $('companyCoverage').textContent = `${info.note || ''} · เริ่มเก็บ ${time(info.collectionStartedAt)} · เก็บสำเร็จล่าสุด ${time(info.lastSuccessAt)}${info.lastAttemptStatus === 'failed' || stale ? ' · ⚠ ข้อมูลอาจไม่ล่าสุด: งานเก็บข้อมูลขัดข้องหรือยังไม่สำเร็จใน 5 นาทีที่ผ่านมา' : ''}`;
      render();
    } catch (error) { if ($('companyDate').value === requestedDay) { items = null; $('companyBoard').replaceChildren(); $('companyMessage').textContent = error.name === 'TimeoutError' ? 'อ่านข้อมูลเกินเวลา กรุณากด Refresh อีกครั้ง' : error.message; } }
    finally { pending = false; $('companyRefresh').disabled = false; if ($('companyDate').value !== requestedDay) load(); }
  }
  tab.addEventListener('click', () => { host.hidden = false; tab.classList.add('nav-link-active'); if (!items) load(); });
  $('companyRefresh').addEventListener('click', load);
  $('companyBoard').addEventListener('click', event => {
    const button = event.target.closest('.company-status-link');
    if (!button) return;
    const { env, status } = button.dataset;
    selectedStatuses.set(env, selectedStatuses.get(env) === status ? '' : status);
    render();
    [...$('companyBoard').querySelectorAll('.company-status-link')].find(item => item.dataset.env === env && item.dataset.status === status)?.focus({ preventScroll: true });
  });
  $('companySearch').addEventListener('input', render);
  $('companyDate').addEventListener('change', () => { selectedStatuses.clear(); load(); });
}
