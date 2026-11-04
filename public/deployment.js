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
  const environment = String($('eventEnvironment')?.value || '');
  const cutoff = days ? Date.now() - days * 86400000 : 0;
  const rows = eventItems.filter(item => {
    const time = Date.parse(item.receivedAt || item.eventCreatedAt || '');
    return (!cutoff || (time && time >= cutoff)) && (!result || String(item.result || '').toLowerCase() === result) && (!environment || item.environmentGroup === environment);
  });
  $('eventBody').innerHTML = rows.length ? rows.map(item => {
    const resultValue = String(item.result || 'unknown');
    const pr = item.pullRequestUrl ? `<a href="${escapeHtml(item.pullRequestUrl)}" target="_blank" rel="noreferrer">PR #${escapeHtml(item.pullRequestId || '?')}</a>` : (item.pullRequestId ? `PR #${escapeHtml(item.pullRequestId)}` : '<span class="muted">ไม่มี PR</span>');
    const operator = item.requestedBy || item.pullRequestAuthor || '-';
    const source = item.sourceType === 'build' ? 'CI Build' : item.sourceType === 'classic-release' ? 'Classic CD' : item.sourceType === 'yaml-pipeline' ? 'YAML CD' : item.sourceType || 'Service Hook';
    return `<tr><td><span class="env-badge env-${escapeHtml((item.environmentGroup || 'Other').toLowerCase())}">${escapeHtml(item.environmentGroup || 'Other')}</span><br><span class="muted">${escapeHtml(item.environment || '-')}</span></td><td>${escapeHtml(formatDate(item.receivedAt || item.eventCreatedAt))}</td><td><strong>${escapeHtml(item.pipelineName || '-')}</strong><br><span class="muted">Run ${escapeHtml(item.runName || item.runId || '-')}</span></td><td><span class="source-pill">${escapeHtml(source)}</span></td><td>${escapeHtml(item.stageName || '-')}</td><td><span class="result-pill result-${escapeHtml(resultValue)}">${escapeHtml(resultValue)}</span></td><td>${pr}<br><span class="muted">${escapeHtml(item.pullRequestTitle || '')}</span></td><td>${escapeHtml(operator)}</td><td><button class="row-button event-detail-button" data-event-id="${escapeHtml(item.eventId)}">View</button></td></tr>`;
  }).join('') : '<tr><td colspan="9">No Service Hook events found for this filter.</td></tr>';
  document.querySelectorAll('.event-detail-button').forEach(button => button.addEventListener('click', () => openDetail(button.dataset.eventId)));
}

function openDetail(eventId) {
  const item = eventItems.find(entry => entry.eventId === eventId);
  if (!item) return;
  const source = item.sourceType === 'build' ? 'CI Build' : item.sourceType === 'classic-release' ? 'Classic CD' : item.sourceType === 'yaml-pipeline' ? 'YAML CD' : item.sourceType || 'Service Hook';
  const link = item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open pipeline run</a>` : '-';
  $('eventDetailBody').innerHTML = `<h2>${escapeHtml(item.pipelineName || 'Deployment event')}</h2><p class="detail-subtitle">${escapeHtml(item.environmentGroup || 'Other')} · ${escapeHtml(item.stageName || '-')} · ${escapeHtml(source)}</p><dl><dt>Result</dt><dd>${escapeHtml(item.result || '-')}</dd><dt>Status</dt><dd>${escapeHtml(item.status || '-')}</dd><dt>Run</dt><dd>${escapeHtml(item.runName || item.runId || '-')}</dd><dt>Repository</dt><dd>${escapeHtml(item.repositoryName || '-')}</dd><dt>Source branch</dt><dd>${escapeHtml(item.sourceBranch || '-')}</dd><dt>Target branch</dt><dd>${escapeHtml(item.targetBranch || '-')}</dd><dt>Pull Request</dt><dd>${item.pullRequestUrl ? `<a href="${escapeHtml(item.pullRequestUrl)}" target="_blank" rel="noreferrer">#${escapeHtml(item.pullRequestId)}</a>` : escapeHtml(item.pullRequestId || '-')}</dd><dt>PR title</dt><dd>${escapeHtml(item.pullRequestTitle || '-')}</dd><dt>PR author</dt><dd>${escapeHtml(item.pullRequestAuthor || '-')}</dd><dt>Operator</dt><dd>${escapeHtml(item.requestedBy || '-')}</dd><dt>Pipeline link</dt><dd>${link}</dd></dl>`;
  $('eventDetail').showModal();
}
async function loadEvents() {
  $('eventBody').innerHTML = '<tr><td colspan="9">Loading...</td></tr>';
  try {
    const data = await api('/api/ado-deployment-status?limit=500');
    eventItems = Array.isArray(data.items) ? data.items : [];
    renderEvents();
    setText('eventsUpdated', `${eventItems.length} hook events loaded · Updated ${new Date().toLocaleString('th-TH')}`);
  } catch (error) {
    $('eventBody').innerHTML = `<tr><td colspan="9" class="history-error">${escapeHtml(error.message)}</td></tr>`;
    setText('eventsUpdated', 'Unable to load hook events');
  }
}
async function init() {
  const auth = await api('/.auth/me');
  if (!auth?.clientPrincipal) { window.location.href = '/.auth/login/aad?post_login_redirect_uri=/deployment.html'; return; }
  setText('userName', auth.clientPrincipal.userDetails || 'Authenticated');
  $('refreshEvents')?.addEventListener('click', loadEvents);
  $('eventRange')?.addEventListener('change', renderEvents);
  $('eventEnvironment')?.addEventListener('change', renderEvents);
  $('eventResult')?.addEventListener('change', renderEvents);
  $('closeEventDetail')?.addEventListener('click', () => $('eventDetail').close());
  await loadEvents();
}
init().catch(error => {
  setText('eventsUpdated', 'Unable to initialize deployment monitor');
  if ($('eventBody')) $('eventBody').innerHTML = `<tr><td colspan="9" class="history-error">${escapeHtml(error.message)}</td></tr>`;
});
