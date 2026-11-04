import { escapeHtml, setText } from './core.js';
const $ = id => document.getElementById(id);
let eventItems = [];
async function api(url) {
  const response = await fetch(url, { credentials: 'same-origin' });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || data?.detail || `Request failed (${response.status})`);
  return data;
}
function formatDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString('th-TH') : '-';
}
function renderEvents() {
  const days = $('eventRange')?.value === 'all' ? 0 : Number($('eventRange')?.value || 0);
  const result = String($('eventResult')?.value || '').toLowerCase();
  const cutoff = days ? Date.now() - days * 86400000 : 0;
  const rows = eventItems.filter(item => {
    const time = Date.parse(item.receivedAt || item.eventCreatedAt || '');
    return (!cutoff || (time && time >= cutoff)) && (!result || String(item.result || '').toLowerCase() === result);
  });
  $('eventBody').innerHTML = rows.length ? rows.map(item => {
    const resultValue = String(item.result || 'unknown');
    const repair = item.repairPrUrl ? `<a href="${escapeHtml(item.repairPrUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.repairPrStatus || 'ตรวจสอบ PR')}</a>` : '<span class="muted">ยังไม่มีข้อมูล PR</span>';
    return `<tr><td>${escapeHtml(formatDate(item.receivedAt || item.eventCreatedAt))}</td><td><strong>${escapeHtml(item.pipelineName || '-')}</strong><br><span class="muted">Run ${escapeHtml(item.runName || item.runId || '-')}</span></td><td>${escapeHtml(item.stageName || '-')}</td><td><span class="status-pill">${escapeHtml(item.status || 'unknown')}</span></td><td><span class="result-pill result-${escapeHtml(resultValue)}">${escapeHtml(resultValue)}</span></td><td>${escapeHtml(item.subscriptionId || 'Legacy event')}</td><td>${repair}</td></tr>`;
  }).join('') : '<tr><td colspan="7">No Service Hook events found for this filter.</td></tr>';
}
async function loadEvents() {
  $('eventBody').innerHTML = '<tr><td colspan="7">Loading...</td></tr>';
  try {
    const data = await api('/api/ado-deployment-status?limit=500');
    eventItems = Array.isArray(data.items) ? data.items : [];
    renderEvents();
    setText('eventsUpdated', `${eventItems.length} hook events loaded · Updated ${new Date().toLocaleString('th-TH')}`);
  } catch (error) {
    $('eventBody').innerHTML = `<tr><td colspan="7" class="history-error">${escapeHtml(error.message)}</td></tr>`;
    setText('eventsUpdated', 'Unable to load hook events');
  }
}
async function init() {
  const auth = await api('/.auth/me');
  if (!auth?.clientPrincipal) { window.location.href = '/.auth/login/aad?post_login_redirect_uri=/deployment.html'; return; }
  setText('userName', auth.clientPrincipal.userDetails || 'Authenticated');
  $('refreshEvents')?.addEventListener('click', loadEvents);
  $('eventRange')?.addEventListener('change', renderEvents);
  $('eventResult')?.addEventListener('change', renderEvents);
  await loadEvents();
}
init().catch(error => {
  setText('eventsUpdated', 'Unable to initialize deployment monitor');
  if ($('eventBody')) $('eventBody').innerHTML = `<tr><td colspan="7" class="history-error">${escapeHtml(error.message)}</td></tr>`;
});
