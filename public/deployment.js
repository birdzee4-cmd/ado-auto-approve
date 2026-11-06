import { escapeHtml, setText } from './core.js';
import { renderCommit } from './deployment-commit.js?v=20261105-1';
import { historyDates, appendBangkokDates } from './deployment-dates.js';
import { initTracking } from './pr-build-tracking.js?v=20261105-8';
import { initCompanyMonitor } from './company-deployment-monitor.js?v=tracking-20261106-4';
const $ = id => document.getElementById(id);
let eventItems = [];
let currentPage = 1;
let cursorMode = true;
let cursorStack = [''];
let nextCursor = '';
let aggregateSummary = null;
const PAGE_SIZE = 50;
function ensureSummary() {
  let summary = $('eventSummary');
  if (summary) return summary;
  summary = document.createElement('div');
  summary.id = 'eventSummary';
  summary.className = 'event-summary';
  $('eventBody')?.closest('.table-wrap')?.before(summary);
  return summary;
}
function ensureAdvancedSummary() {
  let panel = $('advancedSummary');
  if (panel) return panel;
  panel = document.createElement('section'); panel.id = 'advancedSummary'; panel.className = 'advanced-summary';
  $('eventBody')?.closest('.table-wrap')?.before(panel);
  return panel;
}
function renderAdvancedSummary(summary) {
  const panel = ensureAdvancedSummary();
  if (!panel || !summary) return;
  const bars = (entries, labelMap = {}) => Object.entries(entries || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => `<div class="metric-bar"><span title="${escapeHtml(labelMap[label] || label)}">${escapeHtml(labelMap[label] || label)}</span><i><b style="width:${summary.total ? Math.max(2, Math.round(value / summary.total * 100)) : 0}%"></b></i><strong>${value}</strong></div>`).join('') || '<p class="metric-empty">ไม่มีข้อมูล</p>';
  const dayEntries = Object.entries(summary.byDay || {}).sort((a, b) => a[0].localeCompare(b[0])).slice(-14);
  const maxDay = Math.max(1, ...dayEntries.map(([, value]) => value));
  const open = (summary.openFailures || []).slice(0, 5).map(item => `<li><strong>${escapeHtml(item.pipelineName || 'Unknown pipeline')}</strong><span>PR #${escapeHtml(item.pullRequestId || '-')} · ${escapeHtml(item.pullRequestTitle || 'ยังไม่มีชื่อ PR')}</span></li>`).join('') || '<li class="metric-empty">ไม่พบ Failure ที่ยังเปิดอยู่</li>';
  const slow = Object.entries(summary.pipelinePerformance || {}).filter(([, item]) => item.averageDurationSeconds != null).sort((a, b) => b[1].averageDurationSeconds - a[1].averageDurationSeconds).slice(0, 5).map(([name, item]) => `<li><strong>${escapeHtml(name)}</strong><span>${Math.round(item.averageDurationSeconds / 60)}m average · ${item.failed} failed</span></li>`).join('') || '<li class="metric-empty">ไม่มีข้อมูล duration</li>';
  const hotspots = (summary.failureHotspots || []).slice(0, 5).map(item => `<li><strong>${escapeHtml(item.stage)}</strong><span>${item.failed} failed</span></li>`).join('') || '<li class="metric-empty">ไม่พบ failure hotspot</li>';
  const alerts = (summary.alerts || []).map(alert => `<div class="monitor-alert ${escapeHtml(alert.severity || 'medium')}">${escapeHtml(alert.message)}</div>`).join('');
  panel.innerHTML = `${alerts}<div class="advanced-kpis"><div><strong>${summary.successRate || 0}%</strong><span>Success rate</span></div><div><strong>${summary.failureRate || 0}%</strong><span>Failure rate</span></div><div><strong>${summary.averageDurationSeconds == null ? '-' : Math.round(summary.averageDurationSeconds / 60) + 'm'}</strong><span>Avg duration</span></div><div><strong>${summary.openFailureCount || 0}</strong><span>Open failures</span></div><div><strong>${summary.repairedFailures || 0}</strong><span>Repaired failures</span></div><div><strong>${summary.repeatedFailures || 0}</strong><span>Repeated failures</span></div><div><strong>${summary.meanTimeToFixSeconds == null ? '-' : Math.round(summary.meanTimeToFixSeconds / 60) + 'm'}</strong><span>Mean time to fix</span></div></div><div class="advanced-charts"><article><h2>By environment</h2>${bars(summary.byEnvironment)}</article><article><h2>By source</h2>${bars(summary.bySource, { build: 'CI Build', 'yaml-pipeline': 'Pipeline stage', 'classic-release': 'Classic CD' })}</article><article class="trend-chart-card"><h2>Daily trend</h2><div class="daily-bars">${dayEntries.map(([day, value]) => `<div title="${escapeHtml(day)}: ${value}"><i style="height:${Math.max(4, Math.round(value / maxDay * 100))}%"></i><span>${escapeHtml(day.slice(5))}</span></div>`).join('') || '<p class="metric-empty">ไม่มีข้อมูล</p>'}</div></article><article class="open-failures"><h2>Open failures by PR</h2><ul>${open}</ul></article><article class="open-failures"><h2>Slowest pipelines</h2><ul>${slow}</ul></article><article class="open-failures"><h2>Failure hotspots by stage</h2><ul>${hotspots}</ul></article></div>`;
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
  select.addEventListener('change', () => { resetCursor(); loadEvents(); });
  return select;
}
function ensurePagination() {
  let nav = $('eventPagination');
  if (nav) return nav;
  nav = document.createElement('div'); nav.id = 'eventPagination'; nav.className = 'event-pagination';
  $('eventBody')?.closest('.table-wrap')?.after(nav);
  return nav;
}
function ensureUnknownResultFilter() {
  const select = $('eventResult');
  if (select && !Array.from(select.options).some(option => option.value === 'unknown')) {
    const option = document.createElement('option'); option.value = 'unknown'; option.textContent = 'Unknown'; select.append(option);
  }
}
async function api(url) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 10000);
  let response;
  try { response = await fetch(url, { credentials: 'same-origin', signal: controller.signal }); }
  finally { window.clearTimeout(timer); }
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
  return String(item.result || '').toLowerCase() === 'failed' ? 'ดูสถานะในเมนูติดตาม PR / CI-CD' : '';
}
function renderEvents() {
  const result = String($('eventResult')?.value || '').toLowerCase();
  const source = String(ensureSourceFilter()?.value || '');
  const environment = String($('eventEnvironment')?.value || '');
  const rows = eventItems.filter(item => {
    const normalizedResult = String(item.result || '').toLowerCase();
    const resultMatches = !result || (result === 'unknown' ? !normalizedResult || normalizedResult === 'unknown' : normalizedResult === result);
    return resultMatches && (!environment || displayEnvironmentGroup(item) === environment) && (!source || item.sourceType === source);
  });
  const summary = ensureSummary();
  const counts = rows.reduce((acc, item) => {
    const env = displayEnvironmentGroup(item);
    const source = item.sourceType === 'build' ? 'CI Build' : item.sourceType === 'classic-release' ? 'Classic CD' : item.sourceType === 'yaml-pipeline' ? 'Pipeline stage' : 'Other';
    acc.total += 1; acc.succeeded += String(item.result || '').toLowerCase() === 'succeeded' ? 1 : 0; acc.failed += String(item.result || '').toLowerCase() === 'failed' ? 1 : 0; acc.env[env] = (acc.env[env] || 0) + 1; acc.source[source] = (acc.source[source] || 0) + 1;
    return acc;
  }, { total: 0, succeeded: 0, failed: 0, env: {}, source: {} });
  const aggregate = aggregateSummary || counts;
  if (aggregateSummary) {
    counts.total = aggregate.total || 0;
    counts.succeeded = aggregate.succeeded || 0;
    counts.failed = aggregate.failed || 0;
    counts.source = { 'CI Build': aggregate.bySource?.build || 0, 'YAML CD': aggregate.bySource?.['yaml-pipeline'] || 0, 'Classic CD': aggregate.bySource?.['classic-release'] || 0 };
  }
  summary.innerHTML = [['Hook Events', counts.total], ['Succeeded Events', counts.succeeded], ['Failed Events', counts.failed], ['Build Events', counts.source['CI Build'] || 0], ['Stage / Deploy Events', (counts.source['YAML CD'] || 0) + (counts.source['Classic CD'] || 0)]].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('');
  renderAdvancedSummary(aggregateSummary);
  const totalPages = cursorMode ? currentPage : Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  $('eventBody').innerHTML = pageRows.length ? pageRows.map(item => {
    const resultValue = String(item.result || 'unknown');
    const resolution = prResolutionStatus(item);
    const resolutionMarkup = resolution ? `<br><span class="pr-resolution ${resolution === 'แก้ไขแล้ว' ? 'resolved' : 'open'}">${escapeHtml(resolution)}</span>` : '';
    const pr = item.pullRequestUrl ? `<a href="${escapeHtml(item.pullRequestUrl)}" target="_blank" rel="noreferrer">PR #${escapeHtml(item.pullRequestId || '?')}</a>${resolutionMarkup}` : (item.pullRequestId ? `PR #${escapeHtml(item.pullRequestId)}${resolutionMarkup}` : '<span class="muted">ไม่มี PR</span>');
    const operator = item.requestedBy || item.pullRequestAuthor || '-';
    const source = item.sourceType === 'build' ? 'CI Build' : item.sourceType === 'classic-release' ? 'Classic CD' : item.sourceType === 'yaml-pipeline' ? 'Pipeline stage' : item.sourceType || 'Service Hook';
    const env = displayEnvironmentGroup(item);
    return `<tr><td><span class="env-badge env-${escapeHtml(env.toLowerCase())}">${escapeHtml(env)}</span><br><span class="muted">${escapeHtml(item.environment || '-')}</span></td><td>${escapeHtml(formatDate(item.receivedAt || item.eventCreatedAt))}</td><td><strong>${escapeHtml(item.pipelineName || '-')}</strong><br><span class="muted">Run ${escapeHtml(item.runName || item.runId || '-')}</span><br>${renderCommit(item)}</td><td><span class="source-pill">${escapeHtml(source)}</span></td><td>${escapeHtml(item.stageName || '-')}</td><td><span class="result-pill result-${escapeHtml(resultValue)}">${escapeHtml(resultValue)}</span></td><td>${pr}<br><span class="muted">${escapeHtml(item.pullRequestTitle || '')}</span></td><td>${escapeHtml(operator)}</td><td><button class="row-button event-detail-button" data-event-id="${escapeHtml(item.eventId)}">View</button></td></tr>`;
  }).join('') : '<tr><td colspan="9">No Service Hook events found for this filter.</td></tr>';
  const pagination = ensurePagination();
  pagination.innerHTML = `<span>หน้า ${currentPage} · ${rows.length} รายการในหน้านี้${cursorMode ? '' : ` จาก ${rows.length} รายการ`}</span><div><button type="button" data-page="prev" ${currentPage <= 1 ? 'disabled' : ''}>ก่อนหน้า</button><strong>หน้า ${currentPage}${cursorMode ? '' : ` / ${totalPages}`}</strong><button type="button" data-page="next" ${cursorMode ? (!nextCursor ? 'disabled' : '') : (currentPage >= totalPages ? 'disabled' : '')}>ถัดไป</button></div>`;
  pagination.querySelector('[data-page="prev"]')?.addEventListener('click', () => { if (cursorMode) { cursorStack.pop(); currentPage -= 1; loadEvents(cursorStack[cursorStack.length - 1]); } else { currentPage -= 1; renderEvents(); } });
  pagination.querySelector('[data-page="next"]')?.addEventListener('click', () => { if (cursorMode && nextCursor) { cursorStack.push(nextCursor); currentPage += 1; loadEvents(nextCursor); } else if (!cursorMode) { currentPage += 1; renderEvents(); } });
  document.querySelectorAll('.event-detail-button').forEach(button => button.addEventListener('click', () => openDetail(button.dataset.eventId)));
}

function openDetail(eventId) {
  const item = eventItems.find(entry => entry.eventId === eventId);
  if (!item) return;
  const source = item.sourceType === 'build' ? 'CI Build' : item.sourceType === 'classic-release' ? 'Classic CD' : item.sourceType === 'yaml-pipeline' ? 'Pipeline stage' : item.sourceType || 'Service Hook';
  const link = item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open pipeline run</a>` : '-';
  $('eventDetailBody').innerHTML = `<h2>${escapeHtml(item.pipelineName || 'Deployment event')}</h2><p class="detail-subtitle">${escapeHtml(displayEnvironmentGroup(item))} · ${escapeHtml(item.stageName || '-')} · ${escapeHtml(source)}</p><dl><dt>Result</dt><dd>${escapeHtml(item.result || '-')}</dd><dt>Status</dt><dd>${escapeHtml(item.status || '-')}</dd><dt>Run</dt><dd>${escapeHtml(item.runName || item.runId || '-')}</dd><dt>Commit</dt><dd>${renderCommit(item, true)}</dd><dt>Repository</dt><dd>${escapeHtml(item.repositoryName || '-')}</dd><dt>Source branch</dt><dd>${escapeHtml(item.sourceBranch || '-')}</dd><dt>Target branch</dt><dd>${escapeHtml(item.targetBranch || '-')}</dd><dt>Pull Request</dt><dd>${item.pullRequestUrl ? `<a href="${escapeHtml(item.pullRequestUrl)}" target="_blank" rel="noreferrer">#${escapeHtml(item.pullRequestId)}</a>` : escapeHtml(item.pullRequestId || '-')}</dd><dt>PR title</dt><dd>${escapeHtml(item.pullRequestTitle || '-')}</dd><dt>PR author</dt><dd>${escapeHtml(item.pullRequestAuthor || '-')}</dd><dt>Operator</dt><dd>${escapeHtml(item.requestedBy || '-')}</dd><dt>Pipeline link</dt><dd>${link}</dd></dl>`;
  $('eventDetail').showModal();
}
function resetCursor() { currentPage = 1; cursorStack = ['']; nextCursor = ''; }
async function loadEvents(cursor = '') {
  $('eventBody').innerHTML = '<tr><td colspan="9">Loading...</td></tr>';
  try {
    if ($('eventRange')?.value === 'today') {
      const dates = historyDates('today');
      if ($('eventFrom').value !== dates.from) { resetCursor(); cursor = ''; }
      $('eventFrom').value = dates.from; $('eventTo').value = dates.to;
    }
    const fromDate = $('eventFrom')?.value || '';
    const toDate = $('eventTo')?.value || '';
    if (fromDate && toDate && fromDate > toDate) throw new Error('From date must be before or equal to To date.');
    const params = new URLSearchParams(cursorMode ? { useCursor: 'true', pageSize: String(PAGE_SIZE) } : { limit: '2000' });
    if (cursorMode && cursor) params.set('cursor', cursor);
    appendBangkokDates(params, fromDate, toDate);
    if ($('eventEnvironment')?.value) params.set('environmentGroup', $('eventEnvironment').value);
    if ($('eventResult')?.value && $('eventResult').value !== 'unknown') params.set('result', $('eventResult').value);
    if (ensureSourceFilter()?.value) params.set('sourceType', ensureSourceFilter().value);
    const summaryParams = new URLSearchParams(params);
    summaryParams.delete('useCursor'); summaryParams.delete('pageSize'); summaryParams.delete('cursor');
    const data = await api(`/api/ado-deployment-status?${params.toString()}`);
    aggregateSummary = null;
    eventItems = Array.isArray(data.items) ? data.items : [];
    nextCursor = data.nextCursor || '';
    renderEvents();
    const capNote = eventItems.length >= 2000 ? ' · Showing latest 2,000' : '';
    setText('eventsUpdated', `${eventItems.length} hook events loaded${capNote} · Updated ${new Date().toLocaleString('th-TH')}`);
    try {
      const summaryResponse = await api(`/api/ado-deployment-summary?${summaryParams.toString()}`);
      aggregateSummary = summaryResponse?.summary || null;
      renderEvents();
    } catch (summaryError) {
      console.warn('Deployment summary unavailable:', summaryError.message);
    }
  } catch (error) {
    $('eventBody').innerHTML = `<tr><td colspan="9" class="history-error">${escapeHtml(error.message)}</td></tr>`;
    setText('eventsUpdated', 'Unable to load hook events');
  }
}
async function init() {
  const auth = await api('/.auth/me');
  if (!auth?.clientPrincipal) { window.location.href = '/.auth/login/aad?post_login_redirect_uri=/deployment.html'; return; }
  setText('userName', auth.clientPrincipal.userDetails || 'Authenticated');
  initTracking();
  const companyMonitor = initCompanyMonitor();
  const today = historyDates('today');
  $('eventRange').value = 'today';
  $('eventFrom').value = today.from; $('eventTo').value = today.to;
  $('exportEvents')?.addEventListener('click', async () => {
    const params = new URLSearchParams();
    if ($('eventEnvironment')?.value) params.set('environmentGroup', $('eventEnvironment').value);
    if (ensureSourceFilter()?.value) params.set('sourceType', ensureSourceFilter().value);
    if ($('eventResult')?.value) params.set('result', $('eventResult').value);
    appendBangkokDates(params, $('eventFrom')?.value, $('eventTo')?.value);
    const button = $('exportEvents');
    button.disabled = true;
    try {
      const response = await fetch(`/api/ado-deployment-export?${params.toString()}`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Export failed (${response.status})`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = 'deployment-events.csv'; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setText('eventsUpdated', `Export failed: ${error.message}`); }
    finally { button.disabled = false; }
  });
  $('refreshEvents')?.addEventListener('click', () => { resetCursor(); loadEvents(); });
  $('eventRange')?.addEventListener('change', () => {
    if ($('eventRange').value !== 'custom') { const dates = historyDates($('eventRange').value); $('eventFrom').value = dates.from; $('eventTo').value = dates.to; }
    resetCursor(); loadEvents();
  });
  $('eventEnvironment')?.addEventListener('change', () => { resetCursor(); loadEvents(); });
  $('eventResult')?.addEventListener('change', () => { resetCursor(); loadEvents(); });
  $('eventFrom')?.addEventListener('change', () => { $('eventRange').value = 'custom'; resetCursor(); loadEvents(); });
  $('eventTo')?.addEventListener('change', () => { $('eventRange').value = 'custom'; resetCursor(); loadEvents(); });
  ensureSourceFilter();
  ensureUnknownResultFilter();
  $('closeEventDetail')?.addEventListener('click', () => $('eventDetail').close());
  // Activate the daily monitor before loading the heavier events history so a
  // refresh never exposes the legacy Deployment view as the default screen.
  companyMonitor.activate();
  await loadEvents();
}
init().catch(error => {
  setText('eventsUpdated', 'Unable to initialize deployment monitor');
  if ($('eventBody')) $('eventBody').innerHTML = `<tr><td colspan="9" class="history-error">${escapeHtml(error.message)}</td></tr>`;
});

