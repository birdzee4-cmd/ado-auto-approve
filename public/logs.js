import {
  safeFetchJson, escapeHtml, showBox, setText, setButtonLoading,
  renderSkeletonRows, bind, formatDate, initPage
} from './core.js';

// ===== Audit Logs Page =====
async function loadAuditLogs() {
  if (!document.getElementById('logTableBody')) return;
  setButtonLoading('btnSearchLogs', true, 'Searching...');
  showBox('logResult', '⏳ Loading SharePoint log...', 'info');
  
  const tbody = document.getElementById('logTableBody');
  if (tbody) tbody.innerHTML = renderSkeletonRows(10, 5);

  try {
    const params = new URLSearchParams();
    const prId = normalizePrIdInput((document.getElementById('logFilterPrId') || {}).value || '');
    const action = (document.getElementById('logFilterAction') || {}).value || '';
    const source = (document.getElementById('logFilterSource') || {}).value || '';
    const keyword = (document.getElementById('logFilterKeyword') || {}).value || '';
    const top = (document.getElementById('logFilterTop') || {}).value || '100';
    if (prId) params.set('prId', prId);
    if (action) params.set('action', action);
    if (source) params.set('source', source);
    if (keyword) params.set('q', keyword);
    params.set('top', top);

    const r = await safeFetchJson('/api/logs?' + params.toString());
    if (r.parseError || !r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      showBox('logResult', '❌ ' + escapeHtml(d.error || 'Failed to load log') +
        '<br/><small>' + escapeHtml(d.hint || d.detail || '') + '</small>', 'error');
      renderAuditLogStats({});
      renderAuditLogTable([]);
      return;
    }

    const d = r.data;
    renderAuditLogStats(d.stats || {});
    renderAuditLogTable(d.items || []);
    showBox('logResult',
      '✅ Found <strong>' + d.count + '</strong> items' +
      ' from ' + d.totalFetched + ' fetched items' +
      '<br/><small>Fetched at ' + formatDate(d.fetchedAt) + '</small>',
      'success');
  } catch (err) {
    showBox('logResult', '❌ ' + escapeHtml(err.message), 'error');
    renderAuditLogStats({});
    renderAuditLogTable([]);
  } finally {
    setButtonLoading('btnSearchLogs', false);
  }
}

function bindAuditLogFilters() {
  ['logFilterPrId', 'logFilterKeyword'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        loadAuditLogs();
      }
    });
  });
}

function normalizePrIdInput(value) {
  const match = String(value || '').match(/\d+/);
  return match ? match[0] : '';
}

function clearAuditLogFilters() {
  ['logFilterPrId', 'logFilterKeyword'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['logFilterAction', 'logFilterSource'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const top = document.getElementById('logFilterTop');
  if (top) top.value = '100';
  loadAuditLogs();
}

function renderAuditLogStats(stats) {
  const box = document.getElementById('logStats');
  if (!box) return;
  const s = stats || {};
  box.innerHTML =
    buildLogStatCard('Total', s.total) +
    buildLogStatCard('Approved', s.approved) +
    buildLogStatCard('Rejected', s.rejected) +
    buildLogStatCard('Notification', s.notifications) +
    buildLogStatCard('Failed', s.failed);
}

function buildLogStatCard(label, value) {
  return '<div class="log-stat-card"><span>' + escapeHtml(label) + '</span><strong>' +
    escapeHtml(value == null ? '-' : value) + '</strong></div>';
}

function renderAuditLogTable(items) {
  const tbody = document.getElementById('logTableBody');
  if (!tbody) return;
  const rows = Array.isArray(items) ? items : [];
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-cell">— ไม่พบ log ตามเงื่อนไข —</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(item => {
    const actionClass = getLogActionClass(item.action, item.result, item.reason);
    const buildPolicy = [
      escapeHtml(item.build || '-'),
      item.policyStatus ? 'Policy: ' + escapeHtml(item.policyStatus) : ''
    ].filter(Boolean).join('<br>');
    const links = [
      item.adoPrUrl ? '<a class="btn-mini btn-open" href="' + escapeHtml(item.adoPrUrl) + '" target="_blank" rel="noopener">PR</a>' : '',
      item.adoBuildUrl ? '<a class="btn-mini btn-open" href="' + escapeHtml(item.adoBuildUrl) + '" target="_blank" rel="noopener">Build</a>' : ''
    ].filter(Boolean).join(' ');
    return '<tr>' +
      '<td>' + formatDate(item.createdAt) + '</td>' +
      '<td><strong>#' + escapeHtml(item.prId || '-') + '</strong></td>' +
      '<td><span class="' + actionClass + '">' + escapeHtml(item.action || '-') + '</span></td>' +
      '<td>' + escapeHtml(item.user || '-') + '</td>' +
      '<td>' + escapeHtml(item.source || '-') + '</td>' +
      '<td><span class="audit-repo">' + escapeHtml(item.repository || '-') + '</span><small>' + escapeHtml(item.prTitle || '') + '</small></td>' +
      '<td>' + escapeHtml(item.result || '-') + '</td>' +
      '<td>' + buildPolicy + '</td>' +
      '<td>' + escapeHtml(item.reason || '-') + '</td>' +
      '<td>' + (links || '-') + '</td>' +
    '</tr>';
  }).join('');
}

function getLogActionClass(action, result, reason) {
  const text = [action, result, reason].join(' ').toLowerCase();
  if (text.includes('reject')) return 'log-rejected';
  if (text.includes('approve')) return 'log-approved';
  if (text.includes('fail') || text.includes('error')) return 'log-failed';
  return 'log-neutral';
}

// Page initialization
(async function init() {
  await initPage();
  bind('btnSearchLogs', loadAuditLogs);
  bind('btnClearLogFilters', clearAuditLogFilters);
  bindAuditLogFilters();
  await loadAuditLogs();
})();