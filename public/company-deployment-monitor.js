import { escapeHtml } from './core.js';
const esc = value => escapeHtml(String(value ?? ''));
const labels = { complete: 'สำเร็จ', 'build fail': 'Build ล้มเหลว', 'deploy fail': 'Deploy ล้มเหลว', 'cancel deploy': 'ยกเลิก', building: 'กำลัง Build' };
const environments = ['Development', 'Staging', 'Production', 'Other'];
export function initCompanyMonitor() {
  const host = document.createElement('section'); host.id = 'companyMonitor'; host.hidden = true;
  host.innerHTML = `<div class="deployment-heading"><div><p class="deployment-kicker">Company deployment monitor</p><h1>Monitor งานประจำวัน</h1><p>ข้อมูลจากระบบ Monitor บริษัท · จบทั้งหมดรวมงานสำเร็จ ล้มเหลว และยกเลิก</p></div><button type="button" class="primary-button" id="companyRefresh">Refresh</button></div>
    <div class="deployment-card tracking-filters"><label>ค้นหา Project / ประเภท / Build / ผู้ขอ<input id="companySearch" type="search"></label><label>วันที่ข้อมูล<select id="companyDate"><option value="">ทุกวันที่ API ส่งมา</option></select></label></div>
    <p id="companyMessage" role="status" aria-live="polite">ยังไม่ได้โหลดข้อมูล</p><p class="heading-help">เวลา Update เป็นเวลาจาก Monitor บริษัท (แสดงเป็นเวลาไทย) อาจต่างจากเวลา Build จบใน Azure DevOps · API นี้ยังไม่ยืนยันการเรียกย้อนหลัง</p><div id="companyBoard" class="company-board"></div>`;
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
    if (pending) return; pending = true; $('companyRefresh').disabled = true; $('companyMessage').textContent = 'กำลังอ่านข้อมูล Monitor บริษัท...';
    try {
      const response = await fetch('/api/company-deployment-monitor', { credentials: 'same-origin', signal: AbortSignal.timeout(20000) });
      const body = await response.json(); if (!response.ok || !body.ok || !Array.isArray(body.items)) throw new Error(body.error || 'อ่านข้อมูลไม่สำเร็จ');
      items = body.items;
      const previous = $('companyDate').value;
      const days = [...new Set(items.map(item => item.updatedAt.slice(0, 10)).filter(Boolean))].sort().reverse();
      $('companyDate').innerHTML = '<option value="">ทุกวันที่ API ส่งมา</option>' + days.map(day => `<option value="${esc(day)}">${esc(day)}</option>`).join('');
      $('companyDate').value = days.includes(previous) ? previous : '';
      $('companyMessage').textContent = `อ่านข้อมูล ${items.length} รายการ · ${new Date(body.fetchedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })} · Refresh ด้วยตนเอง`;
      render();
    } catch (error) { items = null; $('companyBoard').replaceChildren(); $('companyMessage').textContent = error.name === 'TimeoutError' ? 'อ่านข้อมูลเกินเวลา กรุณากด Refresh อีกครั้ง' : error.message; }
    finally { pending = false; $('companyRefresh').disabled = false; }
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
  for (const id of ['companySearch', 'companyDate']) $(id).addEventListener('input', render);
}
