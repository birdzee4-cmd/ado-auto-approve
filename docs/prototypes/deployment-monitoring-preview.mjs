import { createMonitoringController } from './deployment-monitoring-controller.mjs';
import { bangkokToday, makeFixtures, filterFixtures } from './deployment-monitoring-fixtures.mjs';

const $ = id => document.getElementById(id);
const today = bangkokToday();
const fixtures = makeFixtures(today);
$('from').value = today;
$('to').value = today;
for (const project of [...new Set(fixtures.map(row => row.ProjectName))]) {
  const option = document.createElement('option');
  option.value = project; option.textContent = project; $('project').append(option);
}
let mode = 'success';
let visibleItems = [];
let detailOpener;
const messages = {
  loading: 'กำลังอ่านข้อมูลตัวอย่าง…', ready: 'แสดงข้อมูลสังเคราะห์สำเร็จ · ทุกสถานะยังเป็น unknown',
  empty: 'ไม่พบรายการตามตัวกรองในข้อมูลสังเคราะห์', stale: 'รีเฟรชไม่สำเร็จ — กำลังแสดงข้อมูลที่อ่านได้ก่อนหน้า',
  error: 'ไม่สามารถอ่านข้อมูลตัวอย่างได้ กรุณาลองรีเฟรชอีกครั้ง', disabled: 'Deployment Monitoring ยังไม่เปิดใช้งาน',
  unauthorized: 'กรุณาเข้าสู่ระบบเพื่อดูข้อมูล', forbidden: 'บัญชีนี้ไม่มีสิทธิ์ดูข้อมูล'
};
function field(tag, text) { const node = document.createElement(tag); node.textContent = text; return node; }
function label(value) { return value === null || value === undefined ? 'ไม่ระบุ' : String(value); }
function rawStatus(value) { return value === null ? 'ไม่ทราบสถานะ (ไม่ระบุรหัส)' : `ไม่ทราบสถานะ (รหัส ${value})`; }
function readiness(value) { return value === true ? 'พร้อม' : value === false ? 'ยังไม่พร้อม' : 'ไม่ระบุ'; }

function render(state) {
  if ($('detail').open) $('detail').close();
  $('message').textContent = messages[state.phase] || 'ยังไม่ได้โหลดข้อมูล';
  $('message').dataset.phase = state.phase;
  $('rows').replaceChildren();
  $('rows').setAttribute('aria-busy', String(state.phase === 'loading'));
  // Refresh stays usable: a new request cancels the previous one in controller.
  $('refresh').textContent = state.phase === 'loading' ? 'รีเฟรชอีกครั้ง' : 'รีเฟรช';
  visibleItems = state.data?.items || [];
  for (const [id, count] of Object.entries({ total: visibleItems.length, prepared: visibleItems.filter(row => row.IsPrepared === true).length, unprepared: visibleItems.filter(row => row.IsPrepared === false).length, unknown: visibleItems.length })) {
    $(id).textContent = state.data ? String(count) : '—';
  }
  $('fetched').textContent = state.data ? `เวลาอ่านข้อมูลตัวอย่าง: ${new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(state.data.fetchedAt))} (Bangkok)` : 'ยังไม่มีข้อมูลที่อ่านสำเร็จ';
  if (!visibleItems.length) {
    const row = document.createElement('tr'); const cell = field('td', messages[state.phase] || 'ยังไม่มีข้อมูล');
    cell.colSpan = 8; cell.className = 'empty-row'; row.append(cell); $('rows').append(row); return;
  }
  for (const item of visibleItems) {
    const row = document.createElement('tr');
    row.append(field('td', item.ID));
    const project = field('td', item.ProjectName); project.append(field('small', label(item.Owner))); row.append(project);
    row.append(field('td', label(item.TargetDate)), field('td', label(item.VersionNumber)));
    const status = document.createElement('td'); const badge = field('span', rawStatus(item.Status)); badge.className = 'badge'; status.append(badge); row.append(status);
    row.append(field('td', readiness(item.IsPrepared)), field('td', label(item.CompletedDate)));
    const action = document.createElement('td'); const button = field('button', 'ดูรายละเอียด');
    button.type = 'button'; button.className = 'row-button'; button.setAttribute('aria-label', `ดูรายละเอียด ${item.ProjectName} ID ${item.ID}`);
    button.addEventListener('click', () => openDetail(item, button)); action.append(button); row.append(action); $('rows').append(row);
  }
}

function openDetail(item, opener) {
  detailOpener = opener;
  $('detail-title').textContent = `รายละเอียดตัวอย่าง #${item.ID}`;
  $('detail-fields').replaceChildren();
  for (const [name, value] of Object.entries({ ID: item.ID, ProjectName: item.ProjectName, Owner: label(item.Owner), TargetDate: label(item.TargetDate), VersionNumber: label(item.VersionNumber), Status: rawStatus(item.Status), IsPrepared: readiness(item.IsPrepared), CompletedDate: label(item.CompletedDate) })) {
    $('detail-fields').append(field('dt', name), field('dd', String(value)));
  }
  $('detail').showModal(); $('close-detail').focus();
}
$('close-detail').addEventListener('click', () => $('detail').close());
$('detail').addEventListener('close', () => { if (detailOpener?.isConnected) detailOpener.focus(); });

const controller = createMonitoringController({ render, async load(filters, { signal }) {
  const selectedMode = mode;
  await new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const cancel = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 350);
    signal.addEventListener('abort', cancel, { once: true });
  });
  const status = { error: 500, unavailable: 503, disabled: 503, unauthorized: 401, forbidden: 403 }[selectedMode];
  if (status) throw Object.assign(new Error('Synthetic scenario'), { status, code: selectedMode === 'disabled' ? 'MONITORING_DISABLED' : undefined });
  const items = selectedMode === 'hostile'
    ? [{ ...fixtures[0], ProjectName: '<img src=x onerror=alert(1)> · ตัวอย่างข้อความที่ไม่ต้องรัน', VersionNumber: 'javascript:alert(1)' }]
    : selectedMode === 'empty' ? [] : filterFixtures(fixtures, filters);
  return { ok: true, items, fetchedAt: new Date().toISOString(), synthetic: true };
} });

function refresh() {
  const from = $('from').value, to = $('to').value;
  if (!$('filters').reportValidity()) return;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
  if (!Number.isFinite(days) || days < 1 || days > 31) {
    $('message').textContent = 'กรุณาเลือกช่วงวันที่เรียงตามลำดับ ไม่เกิน 31 วันรวมวันสิ้นสุด'; return;
  }
  controller.refresh({ from, to, project: $('project').value, status: $('status').value, q: $('keyword').value.trim() });
}
$('filters').addEventListener('submit', event => { event.preventDefault(); mode = 'success'; refresh(); });
$('refresh').addEventListener('click', refresh);
$('simulate').addEventListener('click', () => { mode = $('scenario').value; refresh(); });
document.querySelectorAll('[data-days]').forEach(button => button.addEventListener('click', () => {
  const day = bangkokToday(); const start = new Date(`${day}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - Number(button.dataset.days) + 1);
  $('from').value = start.toISOString().slice(0, 10); $('to').value = day; mode = 'success'; refresh();
}));
window.addEventListener('pagehide', () => controller.dispose(), { once: true });
refresh();
