import { escapeHtml, formatDisplayRoles, safeFetchJson, setText } from './core.js';

const APPS = [
  {
    id: 'ado',
    title: 'ADO Auto-Approve',
    description: 'Review staging pull requests, approve releases, inspect audit logs, and check operational health.',
    href: '/dashboard.html',
    icon: 'A',
    permission: 'canApprovePrs',
    chips: ['Pull Requests', 'Release Approval', 'Audit Logs']
  },
  {
    id: 'appservice',
    title: 'App Service Portal',
    description: 'Manage allowed Buzzebees Staging App Services, restart services, and view read-only app settings.',
    href: '/portal.html',
    icon: 'S',
    permission: 'canManageAppServices',
    chips: ['Staging App Services', 'Read-only Settings', 'Restart']
  }
];

async function loadCurrentUser() {
  const authResp = await fetch('/.auth/me');
  const authData = await authResp.json();
  if (!authData.clientPrincipal) {
    window.location.href = '/.auth/login/aad?post_login_redirect_uri=/applications.html';
    return null;
  }

  const principal = authData.clientPrincipal;
  const fallback = {
    name: principal.userDetails || 'Authorized User',
    email: principal.userDetails || '',
    userRoles: Array.isArray(principal.userRoles) ? principal.userRoles : [],
    permissions: {}
  };

  try {
    const userResp = await safeFetchJson('/api/userinfo');
    if (userResp.ok && userResp.data) {
      return Object.assign({}, fallback, userResp.data, {
        permissions: userResp.data.permissions || {}
      });
    }
  } catch (e) {}

  return fallback;
}

function renderApps(user) {
  const grid = document.getElementById('appsGrid');
  const status = document.getElementById('appsStatus');
  const allowed = APPS.filter(app => user.permissions && user.permissions[app.permission] === true);

  if (!grid || !status) return;
  if (allowed.length === 0) {
    status.hidden = false;
    status.textContent = 'No applications are available for your current account. Please contact your administrator to request access.';
    grid.innerHTML = '';
    return;
  }

  status.hidden = true;
  grid.innerHTML = allowed.map(app => (
    '<a class="app-card" href="' + escapeHtml(app.href) + '">' +
      '<div class="app-icon" aria-hidden="true">' + escapeHtml(app.icon) + '</div>' +
      '<div>' +
        '<h2>' + escapeHtml(app.title) + '</h2>' +
        '<p>' + escapeHtml(app.description) + '</p>' +
      '</div>' +
      '<div>' +
        '<div class="app-meta">' + app.chips.map(chip => '<span class="app-chip">' + escapeHtml(chip) + '</span>').join('') + '</div>' +
        '<div class="app-action" style="margin-top:14px">Open</div>' +
      '</div>' +
    '</a>'
  )).join('');
}

(async function initApplications() {
  try {
    const user = await loadCurrentUser();
    if (!user) return;
    setText('userName', user.name || user.email || 'Authorized User');
    setText('displayName', user.name || '-');
    setText('userEmail', user.email || '-');
    setText('userRole', formatDisplayRoles(user.userRoles || []));
    renderApps(user);
  } catch (err) {
    const status = document.getElementById('appsStatus');
    if (status) {
      status.hidden = false;
      status.classList.add('error');
      status.textContent = 'Unable to load applications: ' + err.message;
    }
  }
})();
