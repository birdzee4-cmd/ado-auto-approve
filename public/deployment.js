import { escapeHtml, setText } from './core.js';
const $ = id => document.getElementById(id);
let eventItems = [];
function ensureSummary() {
  let summary = $('eventSummary');
  if (summary) return summary;
  summary = document.createElement('div');
  summary.id = 'eventSummary';
  summary.className = 'event-summary';
  $('eventBody')?.closest('.table-wrap')?.before(summary);
  return summary;
}
function ensureSourceFilter() {
  let select = $('eventSource');
  if (select) return select;
  const filters = document.querySelector('.event-filters');
  if (!filters) return null;
  const label = document.createElement('label');
  label.textContent = 'Source';
  select = document.createElement('select');
  select.id = 'eventSource';
  select.innerHTML = '<option value="">All sources</option><option value="build">CI Build</option><option value="yaml-pipeline">YAML CD</option><option value="classic-release">Classic CD</option>';
  label.append(select); filters.append(label);
  select.addEventListener('change', renderEvents);
  return select;
}
function ensureUnknownResultFilter() {
  const select = $('eventResult');
  if (select && !Array.from(select.options).some(option => option.value === 'unknown')) {
    const option = document.createElement('option'); option.value = 'unknown'; option.textContent = 'Unknown'; select.append(option);
  }
}
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
function displayEnvironmentGroup(item) {
  const current = String(item.environmentGroup || '').trim();
  if (current && current !== 'Other') return current;
  const value = [item.environment, item.sourceBranch, item.targetBranch, item.pipelineName, item.runName].filter(Boolean).join(' ');
  if (/production|(^|[\W_])prd([\W_]|$)|(^|[\W_])prod([\W_]|$)/i.test(value)) return 'Production';
  if (/staging|stage|uat|preprod|(^|[\W_])stg([\W_]|$)/i.test(value)) return 'Staging';
  if (/development|develop|(^|[\W_])dev([\W_]|$)|test|qa/i.test(value)) return 'Development';
  return current || 'Other';
}
function prResolutionStatus(item) {
  if (!item.pullRequestId || String(item.result || '').toLowerCase() !== 'failed') return '';
  const failedAt = Date.parse(item.receivedAt || item.eventCreatedAt || '') || 0;
  const repaired = eventItems.some(candidate => candidate !== item && String(candidate.pullRequestId || '') === String(item.pullRequestId) && String(candidate.result || '').toLowerCase() === 'succeeded' && (Date.parse(candidate.receivedAt || candidate.eventCreatedAt || '') || 0) > failedAt);
  return repaired ? 'แก้ไขแล้ว' : 'ยังไม่พบ Build สำเร็จ';
}
function renderEvents() {
  const days = $('eventRange')?.value === 'all' ? 0 : Number($('eventRange')?.value || 0);
  const result = String($('eventResult')?.value || '').toLowerCase();
  const source = String(ensureSourceFilter()?.value || '');
  const environment = String($('eventEnvironment')?.value || '');
  const cutoff = days ? Date.now() - days * 86400000 : 0;
  const rows = eventItems.filter(item => {
    const time = Date.parse(item.receivedAt || item.eventCreatedAt || '');
    return (!cutoff || (time && time >= cutoff)) && (!result || String(item.result || '').toLowerCase() === result) && (!environment || displayEnvironmentGroup(item) === environment) && (!source || item.sourceType === source);
  });
  const summary = ensureSummary();
  const counts = rows.reduce((acc, item) => {
    const env = displayEnvironmentGroup(item);
    const source = item.sourceType === 'build' ? 'CI Build' : item.sourceType === 'classic-release' ? 'Classic CD' : item.sourceType === 'yaml-pipeline' ? 'YAML CD' : 'Other';
    acc.total += 1; acc.succeeded += String(item.result || '').toLowerCase() === 'succeeded' ? 1 : 0; acc.failed += String(item.result || '').toLowerCase() === 'failed' ? 1 : 0; acc.env[env] = (acc.env[env] || 0) + 1; acc.source[source] = (acc.source[source] || 0) + 1;
    return acc;
  }, { total: 0, succeeded: 0, failed: 0, env: {}, source: {} });
  summary.innerHTML = [['Total', counts.total], ['Succeeded', counts.succeeded], ['Failed', counts.failed], ['CI Build', counts.source['CI Build'] || 0], ['CD', (counts.source['YAML CD'] || 0) + (counts.source['Classic CD'] || 0)]].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('');
  $('eventBody').innerHTML = rows.length ? rows.map(item => {
    const resultValue = String(item.result || 'unknown');
    const resolution = prResolutionStatus(item);
    const resolutionMarkup = resolution ? `<br><span class="pr-resolution ${resolution === 'แก้ไขแล้ว' ? 'resolved' : 'open'}">${escapeHtml(resolution)}</span>` : '';
    const pr = item.pullRequestUrl ? `<a href="${escapeHtml(item.pullRequestUrl)}" target="_blank" rel="noreferrer">PR #${escapeHtml(item.pullRequestId || '?')}</a>${resolutionMarkup}` : (item.pullRequestId ? `PR #${escapeHtml(item.pullRequestId)}${resolutionMarkup}` : '<span class="muted">ไม่มี PR</span>');
    const operator = item.requestedBy || item.pullRequestAuthor || '-';
    const source = item.sourceType === 'build' ? 'CI Build' : item.sourceType === 'classic-release' ? 'Classic CD' : item.sourceType === 'yaml-pipeline' ? 'YAML CD' : item.sourceType || 'Service Hook';
    const env = displayEnvironmentGroup(item);
    return `<tr><td><span class="env-badge env-${escapeHtml(env.toLowerCase())}">${escapeHtml(env)}</span><br><span class="muted">${escapeHtml(item.environment || '-')}</span></td><td>${escapeHtml(formatDate(item.receivedAt || item.eventCreatedAt))}</td><td><strong>${escapeHtml(item.pipelineName || '-')}</strong><br><span class="muted">Run ${escapeHtml(item.runName || item.runId || '-')}</span></td><td><span class="source-pill">${escapeHtml(source)}</span></td><td>${escapeHtml(item.stageName || '-')}</td><td><span class="result-pill result-${escapeHtml(resultValue)}">${escapeHtml(resultValue)}</span></td><td>${pr}<br><span class="muted">${escapeHtml(item.pullRequestTitle || '')}</span></td><td>${escapeHtml(operator)}</td><td><button class="row-button event-detail-button" data-event-id="${escapeHtml(item.eventId)}">View</button></td></tr>`;
  }).join('') : '<tr><td colspan="9">No Service Hook events found for this filter.</td></tr>';
  document.querySelectorAll('.event-detail-button').forEach(button => button.addEventListener('click', () => openDetail(button.dataset.eventId)));
}

function openDetail(eventId) {
  const item = eventItems.find(entry => entry.eventId === eventId);
  if (!item) return;
  const source = item.sourceType === 'build' ? 'CI Build' : item.sourceType === 'classic-release' ? 'Classic CD' : item.sourceType === 'yaml-pipeline' ? 'YAML CD' : item.sourceType || 'Service Hook';
  const link = item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open pipeline run</a>` : '-';
  $('eventDetailBody').innerHTML = `<h2>${escapeHtml(item.pipelineName || 'Deployment event')}</h2><p class="detail-subtitle">${escapeHtml(displayEnvironmentGroup(item))} · ${escapeHtml(item.stageName || '-')} · ${escapeHtml(source)}</p><dl><dt>Result</dt><dd>${escapeHtml(item.result || '-')}</dd><dt>Status</dt><dd>${escapeHtml(item.status || '-')}</dd><dt>Run</dt><dd>${escapeHtml(item.runName || item.runId || '-')}</dd><dt>Repository</dt><dd>${escapeHtml(item.repositoryName || '-')}</dd><dt>Source branch</dt><dd>${escapeHtml(item.sourceBranch || '-')}</dd><dt>Target branch</dt><dd>${escapeHtml(item.targetBranch || '-')}</dd><dt>Pull Request</dt><dd>${item.pullRequestUrl ? `<a href="${escapeHtml(item.pullRequestUrl)}" target="_blank" rel="noreferrer">#${escapeHtml(item.pullRequestId)}</a>` : escapeHtml(item.pullRequestId || '-')}</dd><dt>PR title</dt><dd>${escapeHtml(item.pullRequestTitle || '-')}</dd><dt>PR author</dt><dd>${escapeHtml(item.pullRequestAuthor || '-')}</dd><dt>Operator</dt><dd>${escapeHtml(item.requestedBy || '-')}</dd><dt>Pipeline link</dt><dd>${link}</dd></dl>`;
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
  ensureSourceFilter();
  ensureUnknownResultFilter();
  $('closeEventDetail')?.addEventListener('click', () => $('eventDetail').close());
  await loadEvents();
}
init().catch(error => {
  setText('eventsUpdated', 'Unable to initialize deployment monitor');
  if ($('eventBody')) $('eventBody').innerHTML = `<tr><td colspan="9" class="history-error">${escapeHtml(error.message)}</td></tr>`;
});
