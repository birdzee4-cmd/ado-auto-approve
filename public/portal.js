import {
  bind,
  closeModal,
  escapeHtml,
  openModal,
  safeFetchJson,
  setButtonLoading,
  setText
} from './core.js';

let allApps = [];
let selectedRestartApp = null;
const cooldowns = {};

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
  setStatus('', '');
  try {
    const url = '/api/appservices' + (forceRefresh ? '?refresh=true' : '');
    const r = await safeFetchJson(url, { timeoutMs: 45000 });
    if (!r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      allApps = [];
      renderApps();
      setStatus(d.detail || d.error || 'App Service API is not ready. Check Managed Identity, RBAC, and environment variables.', 'error');
      updateScope(d.scope || null);
      return;
    }

    allApps = Array.isArray(r.data.apps) ? r.data.apps : [];
    updateScope(r.data.scope || null);
    renderApps();
    setText('lastAction', 'Loaded ' + new Date().toLocaleTimeString('th-TH'));
  } catch (err) {
    allApps = [];
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
    return;
  }

  tbody.innerHTML = filtered.map(app => {
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

(async function initPortal() {
  try {
    const user = await loadCurrentUser();
    if (!user) return;
    setText('userName', user.name || user.email || 'Authorized User');
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
    if (searchInput) searchInput.addEventListener('input', renderApps);

    await loadApps(false);
    window.setInterval(renderApps, 1000);
  } catch (err) {
    setStatus('Unable to initialize portal: ' + err.message, 'error');
  }
})();
