import {
  bind,
  escapeHtml,
  formatDate,
  initPage,
  renderSkeletonRows,
  safeFetchJson,
  setButtonLoading
} from './core.js';

async function loadPortalLogs() {
  setButtonLoading('btnSearchPortalLogs', true, 'Searching...');
  setResult('Loading App Service Portal Log...', 'info');

  const tbody = document.getElementById('portalLogTableBody');
  if (tbody) tbody.innerHTML = renderSkeletonRows(7, 8);

  try {
    const params = new URLSearchParams();
    setParam(params, 'result', getValue('logFilterResult'));
    setParam(params, 'app', getValue('logFilterApp'));
    setParam(params, 'user', getValue('logFilterUser'));
    setParam(params, 'q', getValue('logFilterKeyword'));
    params.set('top', getValue('logFilterTop') || '100');

    const response = await safeFetchJson('/api/appservice-logs?' + params.toString(), { timeoutMs: 45000 });
    if (!response.ok || !response.data || !response.data.ok) {
      const data = response.data || {};
      renderStats({});
      renderTable([]);
      setResult((data.error || 'Failed to load App Service Portal Log') +
        (data.detail ? ' - ' + data.detail : ''), 'error');
      return;
    }

    const data = response.data;
    renderStats(data.stats || {});
    renderTable(data.items || []);
    setResult('Found ' + data.count + ' items from ' + data.totalFetched +
      ' fetched rows. Last loaded ' + formatDate(data.fetchedAt), 'success');
  } catch (err) {
    renderStats({});
    renderTable([]);
    setResult(err.message || 'Failed to load App Service Portal Log', 'error');
  } finally {
    setButtonLoading('btnSearchPortalLogs', false);
  }
}

function setParam(params, name, value) {
  const text = String(value || '').trim();
  if (text) params.set(name, text);
}

function getValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function setResult(message, type) {
  const el = document.getElementById('portalLogResult');
  if (!el) return;
  el.className = 'portal-log-result ' + (type || 'info');
  el.textContent = message;
}

function renderStats(stats) {
  const el = document.getElementById('portalLogStats');
  if (!el) return;
  const s = stats || {};
  el.innerHTML = [
    statCard('Total', s.total),
    statCard('Restarts', s.restarts),
    statCard('Success', s.success),
    statCard('Failed', s.failed)
  ].join('');
}

function statCard(label, value) {
  return '<div class="portal-log-stat"><span>' + escapeHtml(label) + '</span><strong>' +
    escapeHtml(value == null ? '-' : value) + '</strong></div>';
}

function renderTable(items) {
  const tbody = document.getElementById('portalLogTableBody');
  if (!tbody) return;
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="portal-log-empty">No App Service restart log rows found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(item => {
    const actionClass = getActionClass(item);
    return '<tr>' +
      '<td>' + escapeHtml(formatDate(item.createdAt)) + '</td>' +
      '<td><span class="' + actionClass + '">' + escapeHtml(item.action || '-') + '</span></td>' +
      '<td>' + renderResult(item.result) + '</td>' +
      '<td><strong>' + escapeHtml(item.appServiceName || '-') + '</strong><small>' + escapeHtml(item.resourceGroup || '') + '</small></td>' +
      '<td>' + escapeHtml(item.user || '-') + '<small>' + escapeHtml(item.userRoles || '') + '</small></td>' +
      '<td>' + escapeHtml(item.reason || '-') + '</td>' +
      '<td><code>' + escapeHtml(item.eventKey || '-') + '</code></td>' +
    '</tr>';
  }).join('');
}

function renderResult(result) {
  const text = String(result || '-');
  const cls = text.toLowerCase() === 'success' ? 'result-success' :
    (text.toLowerCase().includes('fail') ? 'result-failed' : 'result-neutral');
  return '<span class="' + cls + '">' + escapeHtml(text) + '</span>';
}

function getActionClass(item) {
  const text = [item.action, item.result, item.reason].join(' ').toLowerCase();
  if (text.includes('restart')) return 'action-restart';
  return 'action-neutral';
}

function clearFilters() {
  ['logFilterResult'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['logFilterApp', 'logFilterUser', 'logFilterKeyword'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const top = document.getElementById('logFilterTop');
  if (top) top.value = '100';
  loadPortalLogs();
}

function bindFilters() {
  ['logFilterApp', 'logFilterUser', 'logFilterKeyword'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        loadPortalLogs();
      }
    });
  });
}

(async function init() {
  await initPage();
  if (!window._currentUser.canManageAppServices && !window._currentUser.roles.includes('admin')) {
    window.location.href = '/403.html';
    return;
  }
  bind('btnSearchPortalLogs', loadPortalLogs);
  bind('btnClearPortalLogFilters', clearFilters);
  bindFilters();
  await loadPortalLogs();
})();
