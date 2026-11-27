import { escapeHtml } from './core.js';

const $ = id => document.getElementById(id);
const esc = value => escapeHtml(String(value ?? '-'));
const date = value => value ? new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '—';
let items = [];
let connected = false;

function badge(value) {
  const status = String(value || 'Unknown');
  const kind = status.toLowerCase() === 'sent' ? 'sent' : status.toLowerCase() === 'failed' ? 'failed' : status.toLowerCase() === 'pending' ? 'pending' : '';
  return `<span class="badge ${kind}">${esc(status)}</span>`;
}

function render() {
  const project = $('projectFilter').value.trim().toLowerCase();
  const id = $('idFilter').value.trim();
  const teams = $('teamsFilter').value;
  const line = $('lineFilter').value;
  const rows = items.filter(item => (!project || String(item.ProjectName || item.projectName || '').toLowerCase().includes(project)) && (!id || String(item.TaskPlanningID ?? item.taskPlanningId ?? '').includes(id)) && (!teams || String(item.TeamsStatus || item.teamsStatus || '') === teams) && (!line || String(item.LineStatus || item.lineStatus || '') === line));
  $('statusLine').textContent = connected ? `${rows.length} รายการ · อ่านจาก Notification Log` : 'ยังไม่มีแหล่งข้อมูล Notification Log ที่เชื่อมต่อ';
  $('rows').innerHTML = rows.length ? rows.map(item => `<tr><td>${date(item.Modified || item.modified || item.Created || item.created)}</td><td>${esc(item.ProjectName || item.projectName)}</td><td>${esc(item.TaskPlanningID ?? item.taskPlanningId)}</td><td>${esc(item.SourceStatus ?? item.sourceStatus)}</td><td>${badge(item.TeamsStatus || item.teamsStatus)}</td><td>${date(item.TeamsSentAt || item.teamsSentAt)}</td><td>${badge(item.LineStatus || item.lineStatus)}</td><td>${date(item.LineSentAt || item.lineSentAt)}</td><td>${esc(item.ErrorMessage || item.errorMessage || '—')}</td><td>${esc(item.NotificationKey || item.notificationKey)}</td></tr>`).join('') : `<tr><td colspan="10">${connected ? 'ไม่พบรายการตามตัวกรอง' : 'รอเชื่อมต่อ SharePoint notification log'}</td></tr>`;
}

async function loadUser() {
  try { const response = await fetch('/.auth/me', { credentials: 'same-origin' }); const body = await response.json(); const principal = body.clientPrincipal; $('userName').textContent = principal?.userDetails || principal?.userId || ''; }
  catch { $('userName').textContent = ''; }
}

async function load() {
  $('refresh').disabled = true;
  $('connectionState').textContent = 'กำลังตรวจสอบ API สำหรับ SharePoint notification log...';
  try {
    const response = await fetch('/api/project-planning-notification-log?top=500', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const payload = await response.json();
    if (response.status === 404 || response.status === 501 || payload?.code === 'NOT_CONFIGURED') throw new Error('ยังไม่ได้ตั้งค่า API หรือ SharePoint List สำหรับ Notification Log');
    if (!response.ok) throw new Error(payload?.error || `อ่าน Notification Log ไม่สำเร็จ (HTTP ${response.status})`);
    items = Array.isArray(payload.items) ? payload.items : [];
    connected = true;
    $('connectionState').textContent = 'เชื่อมต่อกับ Notification Log แล้ว · แสดงข้อมูลตามสิทธิ์ที่ได้รับ';
  } catch (error) {
    items = [];
    connected = false;
    $('connectionState').textContent = `${error.message} · หน้านี้ยังไม่แสดงข้อมูลจำลอง`;
  } finally {
    render();
    $('refresh').disabled = false;
  }
}

['projectFilter', 'idFilter', 'teamsFilter', 'lineFilter'].forEach(id => $(id).addEventListener(id.includes('Filter') && (id === 'projectFilter' || id === 'idFilter') ? 'input' : 'change', render));
$('refresh').addEventListener('click', load);
loadUser();
load();
