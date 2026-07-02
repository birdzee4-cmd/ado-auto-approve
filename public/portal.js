import {
  bind,
  closeModal,
  escapeHtml,
  getUserEmailForDisplay,
  openModal,
  safeFetchJson,
  setButtonLoading,
  setText
} from './core.js';

let allApps = [];
let selectedRestartApp = null;
let currentPage = 1;
let pageSize = 100;
const cooldowns = {};
const APP_SERVICE_LIST_TIMEOUT_MS = 180000;

async function loadCurrentUser() {
  const authResp = await fetch('/.auth/me');
  const authData = await authResp.json();
  if (!authData.clientPrincipal) {
    window.location.href = '/.auth/login/aad?post_login_redirect_uri=/applications.html';
    return null;
  }

  const userResp = await safeFetchJson('/api/userinfo');
  if (!userResp.ok || !userResp.data) {
    throw new Error('Unable to load user info');
  }
  if (!userResp.data.permissions || userResp.data.permissions.canManageAppServices !== true) {
    window.location.href = '/403.html';
    return null;
  }
  return userResp.data;
}

async function loadApps(forceRefresh) {
  setButtonLoading('btnRefreshApps', true, 'Loading...');
  setStatus('Loading App Services. Subscription-wide scope can take up to a few minutes on the first load...', '');
  try {
    const url = '/api/appservices' + (forceRefresh ? '?refresh=true' : '');
    const r = await safeFetchJson(url, { timeoutMs: APP_SERVICE_LIST_TIMEOUT_MS });
    if (!r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      const diagnosticText = formatDiagnostics(d.diagnostics);
      allApps = [];
      currentPage = 1;
      renderApps();
      setStatus((d.detail || d.error || 'App Service API is not ready. Check Managed Identity, RBAC, and environment variables.') + diagnosticText, 'error');
      updateScope(d.scope || null);
      return;
    }

    allApps = Array.isArray(r.data.apps) ? r.data.apps : [];
    currentPage = 1;
    updateScope(r.data.scope || null);
    renderApps();
    setText('lastAction', 'Loaded ' + new Date().toLocaleTimeString('th-TH'));
  } catch (err) {
    allApps = [];
    currentPage = 1;
    renderApps();
    setStatus('Unable to load App Services: ' + err.message, 'error');
  } finally {
    setButtonLoading('btnRefreshApps', false);
  }
}

function updateScope(scope) {
  if (!scope) return;
  setText('scopeResourceGroup', scope.resourceGroup || '-');
  setText('scopePrefix', 'Prefix: ' + (scope.namePrefix || '-'));
}

function renderApps() {
  const tbody = document.getElementById('appsTableBody');
  const query = String(document.getElementById('searchInput') && document.getElementById('searchInput').value || '').trim().toLowerCase();
  const filtered = allApps.filter(app => {
    if (!query) return true;
    return [app.name, app.status, app.resourceGroup, app.location, app.appType]
      .some(value => String(value || '').toLowerCase().includes(query));
  });

  setText('totalApps', allApps.length);
  setText('runningApps', allApps.filter(app => String(app.status || '').toLowerCase() === 'running').length);

  if (!tbody) return;
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="portal-empty">' +
      (allApps.length === 0 ? 'No App Services are available in the configured staging scope.' : 'No App Services match your search.') +
      '</td></tr>';
    renderPagination(filtered.length);
    return;
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  currentPage = Math.min(Math.max(currentPage, 1), pageCount);
  const startIndex = (currentPage - 1) * pageSize;
  const pageApps = filtered.slice(startIndex, startIndex + pageSize);

  tbody.innerHTML = pageApps.map(app => {
    const status = String(app.status || 'Unknown');
    const lower = status.toLowerCase();
    const statusClass = lower === 'running' ? 'status-running' : (lower === 'stopped' ? 'status-stopped' : 'status-unknown');
    const cooldownText = getCooldownText(app.name);
    return '<tr>' +
      '<td><strong>' + escapeHtml(app.name) + '</strong>' + (app.defaultHostName ? '<br><small>' + escapeHtml(app.defaultHostName) + '</small>' : '') + '</td>' +
      '<td><span class="status-badge ' + statusClass + '">' + escapeHtml(status) + '</span></td>' +
      '<td>' + escapeHtml(app.appType || app.kind || '-') + '</td>' +
      '<td>' + escapeHtml(app.resourceGroup || '-') + '</td>' +
      '<td>' + escapeHtml(app.location || '-') + '</td>' +
      '<td><div class="portal-actions">' +
        '<button type="button" class="portal-action-btn settings" data-settings="' + escapeHtml(app.name) + '">Settings</button>' +
        '<button type="button" class="portal-action-btn restart" data-restart="' + escapeHtml(app.name) + '"' + (cooldownText ? ' disabled' : '') + '>' + escapeHtml(cooldownText || 'Restart') + '</button>' +
      '</div></td>' +
    '</tr>';
  }).join('');

  tbody.querySelectorAll('[data-settings]').forEach(button => {
    button.addEventListener('click', () => openSettings(button.getAttribute('data-settings')));
  });
  tbody.querySelectorAll('[data-restart]').forEach(button => {
    button.addEventListener('click', () => openRestart(button.getAttribute('data-restart')));
  });
  renderPagination(filtered.length);
}

function renderPagination(totalItems) {
  const pagination = document.getElementById('appsPagination');
  const meta = document.getElementById('appsPaginationMeta');
  const buttons = document.getElementById('appsPageButtons');
  if (!pagination || !meta || !buttons) return;

  if (totalItems <= 0) {
    pagination.hidden = true;
    buttons.innerHTML = '';
    meta.textContent = 'Showing 0 apps';
    return;
  }

  const pageCount = Math.max(1, Math.ceil(totalItems / pageSize));
  currentPage = Math.min(Math.max(currentPage, 1), pageCount);
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);
  pagination.hidden = false;
  meta.textContent = 'Showing ' + start.toLocaleString('en-US') + '-' + end.toLocaleString('en-US') +
    ' of ' + totalItems.toLocaleString('en-US') + ' apps';

  const pages = getVisiblePages(pageCount, currentPage);
  const html = []
    .concat(renderPageButton('First', 1, currentPage === 1))
    .concat(renderPageButton('Prev', currentPage - 1, currentPage === 1))
    .concat(pages.map(page => page === 'gap'
      ? '<span class="portal-page-gap" aria-hidden="true">...</span>'
      : renderPageButton(String(page), page, false, page === currentPage)))
    .concat(renderPageButton('Next', currentPage + 1, currentPage === pageCount))
    .concat(renderPageButton('Last', pageCount, currentPage === pageCount));

  buttons.innerHTML = html.join('');
  buttons.querySelectorAll('[data-page]').forEach(button => {
    button.addEventListener('click', () => {
      const nextPage = Number(button.getAttribute('data-page'));
      if (!Number.isFinite(nextPage)) return;
      currentPage = nextPage;
      renderApps();
      scrollTableIntoView();
    });
  });
}

function getVisiblePages(pageCount, activePage) {
  if (pageCount <= 6) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const pages = [1];
  const start = Math.max(2, activePage - 1);
  const end = Math.min(pageCount - 1, activePage + 1);
  if (start > 2) pages.push('gap');
  for (let page = start; page <= end; page += 1) pages.push(page);
  if (end < pageCount - 1) pages.push('gap');
  pages.push(pageCount);
  return pages;
}

function renderPageButton(label, page, disabled, active) {
  const className = 'portal-page-btn' + (active ? ' active' : '');
  return '<button type="button" class="' + className + '" data-page="' + page + '"' +
    (disabled ? ' disabled' : '') + '>' + escapeHtml(label) + '</button>';
}

function scrollTableIntoView() {
  const tableWrap = document.querySelector('.portal-table-wrap');
  if (!tableWrap) return;
  tableWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function getCooldownText(name) {
  const until = cooldowns[String(name || '').toLowerCase()] || 0;
  const diff = until - Date.now();
  if (diff <= 0) return '';
  const totalSeconds = Math.ceil(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return 'Cooldown ' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
}

async function openSettings(name) {
  setText('settingsAppName', name || '-');
  const tbody = document.getElementById('settingsTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="2" class="portal-empty">Loading settings...</td></tr>';
  setSettingsStatus('', '');
  openModal('settingsModal');

  try {
    const r = await safeFetchJson('/api/appservice-settings?name=' + encodeURIComponent(name), { timeoutMs: 45000 });
    if (!r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      if (tbody) tbody.innerHTML = '';
      setSettingsStatus(d.detail || d.error || 'Unable to load settings.', 'error');
      return;
    }

    const settings = Array.isArray(r.data.settings) ? r.data.settings : [];
    if (settings.length === 0) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="2" class="portal-empty">No settings returned for this App Service.</td></tr>';
      return;
    }

    if (tbody) {
      tbody.innerHTML = settings.map(item => (
        '<tr>' +
          '<td><strong>' + escapeHtml(item.name) + '</strong></td>' +
          '<td class="settings-value">' + escapeHtml(item.value) + '</td>' +
        '</tr>'
      )).join('');
    }
    setText('lastAction', 'Viewed settings');
  } catch (err) {
    if (tbody) tbody.innerHTML = '';
    setSettingsStatus('Unable to load settings: ' + err.message, 'error');
  }
}

function openRestart(name) {
  selectedRestartApp = name;
  setText('restartTarget', name || '-');
  openModal('restartModal');
}

async function restartSelectedApp() {
  if (!selectedRestartApp) return;
  const name = selectedRestartApp;
  setButtonLoading('btnConfirmRestart', true, 'Restarting...');
  try {
    const r = await safeFetchJson('/api/restart-appservice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      timeoutMs: 45000
    });
    if (!r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      const retry = Number(d.retryAfterSeconds || 0);
      if (retry > 0) cooldowns[name.toLowerCase()] = Date.now() + retry * 1000;
      renderApps();
      throw new Error(d.detail || d.error || 'Restart failed');
    }

    const cooldownSeconds = Number(r.data.cooldownSeconds || 300);
    cooldowns[name.toLowerCase()] = Date.now() + cooldownSeconds * 1000;
    closeModal('restartModal');
    setStatus('Restart request submitted successfully for ' + name + '.', 'success');
    setText('lastAction', 'Restarted ' + name);
    renderApps();
  } catch (err) {
    setStatus('Restart failed for ' + name + ': ' + err.message, 'error');
  } finally {
    setButtonLoading('btnConfirmRestart', false);
  }
}

function setStatus(message, type) {
  const el = document.getElementById('portalStatus');
  if (!el) return;
  el.className = 'portal-status';
  if (type) el.classList.add(type);
  el.hidden = !message;
  el.textContent = message || '';
}

function setSettingsStatus(message, type) {
  const el = document.getElementById('settingsStatus');
  if (!el) return;
  el.className = 'portal-status';
  if (type) el.classList.add(type);
  el.hidden = !message;
  el.textContent = message || '';
}

function formatDiagnostics(diagnostics) {
  if (!diagnostics || typeof diagnostics !== 'object') return '';
  const parts = [];
  if (diagnostics.name) parts.push('name=' + diagnostics.name);
  if (diagnostics.code) parts.push('code=' + diagnostics.code);
  if (diagnostics.statusCode) parts.push('status=' + diagnostics.statusCode);
  parts.push('identityEndpoint=' + (diagnostics.hasIdentityEndpoint ? 'yes' : 'no'));
  parts.push('identityHeader=' + (diagnostics.hasIdentityHeader ? 'yes' : 'no'));
  parts.push('msiEndpoint=' + (diagnostics.hasMsiEndpoint ? 'yes' : 'no'));
  parts.push('msiSecret=' + (diagnostics.hasMsiSecret ? 'yes' : 'no'));
  return parts.length ? ' [' + parts.join(', ') + ']' : '';
}

(async function initPortal() {
  try {
    const user = await loadCurrentUser();
    if (!user) return;
    setText('userName', getUserEmailForDisplay(user));
    setText('lastAction', 'Ready');

    document.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', () => closeModal(el.getAttribute('data-close')));
    });
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) closeModal(backdrop.id);
      });
    });

    bind('btnRefreshApps', () => loadApps(true));
    bind('btnConfirmRestart', restartSelectedApp);
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        currentPage = 1;
        renderApps();
      });
    }
    const pageSizeSelect = document.getElementById('pageSizeSelect');
    if (pageSizeSelect) {
      pageSize = Number(pageSizeSelect.value) || pageSize;
      pageSizeSelect.addEventListener('change', () => {
        pageSize = Number(pageSizeSelect.value) || 100;
        currentPage = 1;
        renderApps();
      });
    }

    await loadApps(false);
    window.setInterval(renderApps, 1000);
  } catch (err) {
    setStatus('Unable to initialize portal: ' + err.message, 'error');
  }
})();
