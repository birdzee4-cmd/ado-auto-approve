// ============================================
// ADO Auto-Approve - Dashboard Script (Phase 3.1)
// ============================================

let currentPrForAction = null;
window._prCache = {};
window._activeTab = 'pr';
try {
  const savedTab = sessionStorage.getItem('activeDashboardTab');
  if (savedTab === 'pr' || savedTab === 'release') window._activeTab = savedTab;
} catch (e) {}
let _allPrs = [];
window._currentUser = {
  roles: [],
  requiredRole: 'it_support_approve',
  canApprovePrs: false
};

(async function init() {
  try {
    const authResp = await fetch('/.auth/me');
    const authData = await authResp.json();
    if (!authData.clientPrincipal) {
      window.location.href = '/';
      return;
    }
    const principal = authData.clientPrincipal;
    setText('userName', principal.userDetails || 'Unknown');
    setText('displayName', principal.userDetails || '-');
    setText('userEmail', principal.userDetails || '-');
    setText('loginTime', new Date().toLocaleString('th-TH', {
      dateStyle: 'medium', timeStyle: 'short'
    }));

    try {
      const userResp = await fetch('/api/userinfo');
      if (userResp.ok) {
        const userData = await userResp.json();
        if (userData.name) {
          setText('displayName', userData.name);
          setText('userName', userData.name);
        }
        if (userData.email) setText('userEmail', userData.email);
        const roles = Array.isArray(userData.userRoles) ? userData.userRoles : [];
        window._currentUser.roles = roles;
        window._currentUser.requiredRole = userData.requiredRole || window._currentUser.requiredRole;
        window._currentUser.canApprovePrs = !!(userData.permissions && userData.permissions.canApprovePrs);
        setText('userRole', formatDisplayRoles(roles));
      }
    } catch (e) {
      setText('userRole', 'Unable to load role');
    }

    if (document.getElementById('systemHealthGrid') || document.getElementById('systemHealthSummary')) {
      await checkHealthStatus();
    }

    bind('btnCheckPrs', checkPrs);
    bind('btnRefreshActivity', loadPrActivity);
    bind('btnTestTeams', testTeams);
    bind('btnTestDailySummary', testDailySummary);
    bind('btnTestExceptionScan', testExceptionScan);
    bind('btnTestHealth', testHealth);
    bind('btnRefreshHealth', checkHealthStatus);
    bind('btnMergeLookup', checkMergeLookup);
    bind('btnSearchLogs', loadAuditLogs);
    bind('btnClearLogFilters', clearAuditLogFilters);
    bind('btnConfirmApprove', doApprove);
    bind('btnConfirmReject', doReject);
    bind('btnConfirmHold', doHold);

    document.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', () => closeModal(el.getAttribute('data-close')));
    });
    document.querySelectorAll('.modal-backdrop').forEach(bd => {
      bd.addEventListener('click', (e) => {
        if (e.target === bd) closeModal(bd.id);
      });
    });

    if (document.getElementById('btnCheckPrs')) {
      await checkPrs();
      await initAutoApprove();
    }
    if (document.getElementById('btnRefreshActivity')) {
      bindActivityFilters();
      loadPrActivity();
    }
    if (document.getElementById('logTableBody')) {
      bindAuditLogFilters();
      loadAuditLogs();
    }
    if (document.getElementById('mergePrId')) {
      const input = document.getElementById('mergePrId');
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') checkMergeLookup();
      });
    }

  } catch (err) {
    console.error('Init failed:', err);
    window.location.href = '/';
  }
})();

// ===== Helpers =====
function bind(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
}
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function formatDisplayRoles(roles) {
  const roleLabels = {
    it_support_approve: 'IT Support Approve',
    admin: 'Admin'
  };
  const systemRoles = new Set(['anonymous', 'authenticated']);
  const displayRoles = (Array.isArray(roles) ? roles : [])
    .map(role => String(role || '').trim())
    .filter(Boolean)
    .filter(role => !systemRoles.has(role.toLowerCase()))
    .map(role => roleLabels[role.toLowerCase()] || role);

  if (displayRoles.length > 0) return displayRoles.join(', ');
  return roles && roles.some(role => String(role).toLowerCase() === 'authenticated')
    ? 'Authenticated User'
    : 'No approval role';
}
function showBox(id, html, type) {
  const box = document.getElementById(id);
  if (!box) return;
  box.hidden = false;
  box.className = type ? 'test-result result-' + type : '';
  box.innerHTML = html;
}
function showResult(message, type) {
  showBox('testResult', message, type || 'info');
}
function setButtonLoading(buttonId, loading, loadingText) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  btn.disabled = loading;
  btn.style.opacity = loading ? '0.6' : '1';
  btn.style.cursor = loading ? 'wait' : 'pointer';
  if (!loading && btn.dataset.originalHtml) {
    btn.innerHTML = btn.dataset.originalHtml;
    delete btn.dataset.originalHtml;
  } else if (loadingText) {
    if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
    btn.innerHTML = loading ? '<span>⏳</span><span>' + loadingText + '</span>' : btn.dataset.originalHtml;
  }
}
function resetCheckPrsButton() {
  const btn = document.getElementById('btnCheckPrs');
  if (!btn) return;
  btn.disabled = false;
  btn.style.opacity = '1';
  btn.style.cursor = 'pointer';
  btn.innerHTML = '<span>🔄</span><span>Refresh PR</span>';
  delete btn.dataset.originalHtml;
}
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
async function safeFetchJson(url, options) {
  const resp = await fetch(url, options || {});
  const text = await resp.text();
  const contentType = resp.headers.get('Content-Type') || '';
  let data = null, parseError = null;
  if (text) {
    try { data = JSON.parse(text); } catch (e) { parseError = e.message; }
  } else { parseError = 'Empty response body'; }
  return { ok: resp.ok, status: resp.status, contentType, data, rawBody: text, parseError };
}
function formatDate(iso) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }); }
  catch (e) { return iso; }
}
function formatDateTime(iso) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch (e) { return iso; }
}
function shortBranch(ref) {
  if (!ref) return '-';
  return ref.replace(/^refs\/heads\//, '');
}
function compactBranchName(branch, maxLength) {
  const value = shortBranch(branch);
  if (value.length <= maxLength) return value;
  const head = Math.ceil((maxLength - 3) * 0.42);
  const tail = Math.floor((maxLength - 3) * 0.58);
  return value.slice(0, head) + '...' + value.slice(value.length - tail);
}
function renderBranchCell(pr) {
  const sourceFull = shortBranch(pr.sourceBranch);
  const targetFull = shortBranch(pr.targetBranch);
  const sourceText = compactBranchName(pr.sourceBranch, 34);

  return '<div class="branch-stack">' +
    '<div class="branch-line branch-from">' +
      '<span class="branch-label">From</span>' +
      '<code title="' + escapeHtml(sourceFull) + '">' + escapeHtml(sourceText) + '</code>' +
    '</div>' +
    '<div class="branch-line branch-into">' +
      '<span class="branch-label">Into</span>' +
      '<code title="' + escapeHtml(targetFull) + '">' + escapeHtml(targetFull) + '</code>' +
    '</div>' +
  '</div>';
}
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.hidden = false;
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.hidden = true;
}

// ===== Activity Page =====
async function loadPrActivity(page) {
  if (!document.getElementById('completedSection')) return;
  const nextPage = Math.max(Number(page) || 0, 0);
  window._recentlyApprovedPage = nextPage;
  setButtonLoading('btnRefreshActivity', true, 'Loading...');
  showBox('activityResult', '<div class="test-result result-info">⏳ Loading PR activity...</div>');

  try {
    const params = new URLSearchParams();
    params.set('includeActivity', 'true');
    params.set('activityPage', String(nextPage));
    params.set('activityPageSize', '10');
    const statusFilter = (document.getElementById('activityFilterStatus') || {}).value || '';
    const sourceFilter = (document.getElementById('activityFilterSource') || {}).value || '';
    if (statusFilter) params.set('activityStatus', statusFilter);
    if (sourceFilter) params.set('activitySource', sourceFilter);
    const r = await safeFetchJson('/api/list-prs?' + params.toString());
    if (r.parseError) {
      showBox('activityResult', '<div class="test-result result-error">❌ Backend ตอบไม่ใช่ JSON (HTTP ' + r.status + ')</div>');
      return;
    }
    if (!r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      showBox('activityResult', '<div class="test-result result-error">❌ ' + escapeHtml(d.error || 'Unknown') +
        '<br/><small>' + escapeHtml(d.hint || d.detail || '') + '</small></div>');
      return;
    }

    const d = r.data;
    saveLastSync(d);
    showBox('activityResult',
      '<div class="test-result result-success">✅ Loaded <strong>' +
      escapeHtml(d.completedTotalMatched || 0) +
      '</strong> PRs from approval logs in the last ' +
      escapeHtml(d.completedLookbackHours || 24) +
      ' hours</div>'
    );
    renderCompletedPrTable(
      d.completedPrs || [],
      d.completedLookbackHours || 24,
      d.completedTotalMatched,
      d.completedDisplayLimit || 10,
      d.approvedLookback || {}
    );
  } catch (err) {
    showBox('activityResult', '<div class="test-result result-error">❌ ' + escapeHtml(err.message) + '</div>');
  } finally {
    setButtonLoading('btnRefreshActivity', false);
  }
}

function bindActivityFilters() {
  ['activityFilterStatus', 'activityFilterSource'].forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.dataset.bound === 'true') return;
    el.dataset.bound = 'true';
    el.addEventListener('change', () => loadPrActivity(0));
  });
}

// ===== Check PRs =====
async function checkPrs(isSilent) {
  if (!document.getElementById('prTableContainer')) return;
  if (!isSilent) {
    setButtonLoading('btnCheckPrs', true, 'Loading...');
    if (document.getElementById('prTableContainer')) document.getElementById('prTableContainer').hidden = true;
    if (document.getElementById('releaseTableContainer')) document.getElementById('releaseTableContainer').hidden = true;
    if (document.getElementById('dashboardTabs')) document.getElementById('dashboardTabs').hidden = true;
    showBox('prResult', '<div class="test-result result-info">⏳ Calling ADO API...</div>');
  }

  try {
    const r = await safeFetchJson('/api/list-prs');
    if (r.parseError) {
      if (!isSilent) showBox('prResult', '<div class="test-result result-error">❌ Backend ตอบไม่ใช่ JSON (HTTP ' + r.status + ')</div>');
      return;
    }
    if (!r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      if (!isSilent) {
        showBox('prResult', '<div class="test-result result-error">❌ ' + escapeHtml(d.error || 'Unknown') +
          '<br/><small>' + escapeHtml(d.hint || d.detail || '') + '</small></div>');
      }
      return;
    }
    const d = r.data;
    saveLastSync(d);
    const mergeCodeCount = (d.prs || []).filter(isMergeCodePr).length;
    const attention = d.attentionSummary || {};
    showBox('prResult', renderPrSummaryBanner(d, attention, mergeCodeCount));
    renderPrTable(d.prs);
    
    // Evaluate and execute auto-approvals if settings are active
    if (window._autoMode && window._autoMode !== 'normal') {
      await evaluateAutoApprovals(d.prs);
    }

    renderCompletedPrTable(
      d.completedPrs || [],
      d.completedLookbackHours || 24,
      d.completedTotalMatched,
      d.completedDisplayLimit || 10
    );
    if (document.getElementById('systemHealthSummary')) checkHealthStatus();
  } catch (err) {
    if (!isSilent) showBox('prResult', '<div class="test-result result-error">❌ ' + escapeHtml(err.message) + '</div>');
  } finally {
    if (!isSilent) {
      resetCheckPrsButton();
    }
  }
}

function renderPrSummaryBanner(d, attention, mergeCodeCount) {
  const prs = d.prs || [];
  let newCount = 0;
  let holdCount = 0;
  let votedCount = 0;
  let releaseCount = 0;

  for (const pr of prs) {
    if (pr.releaseApproval && pr.releaseApproval.status === 'pending') {
      releaseCount++;
    } else if (isApprovalHeld(pr)) {
      holdCount++;
    } else {
      const myStatus = pr.myApproval && pr.myApproval.status ? String(pr.myApproval.status).toLowerCase() : '';
      if (['approved', 'suggestions', 'rejected', 'waiting-author'].includes(myStatus)) {
        votedCount++;
      } else {
        newCount++;
      }
    }
  }

  const statusText = 'Status: New ' + newCount + ' | Hold ' + holdCount + ' | Voted ' + votedCount + ' | Release ' + releaseCount;

  const attentionText = 'Attention: Critical ' + (attention.critical || 0) +
    ' | Warning ' + (attention.warning || 0) +
    ' | Stale ' + (attention.stale || 0);

  const chips = [
    'Reviewer: ' + escapeHtml(d.reviewerGroup),
    'Fetched: ' + new Date(d.fetchedAt).toLocaleString('th-TH'),
    statusText,
    attentionText
  ];
  if (mergeCodeCount > 0) {
    chips.push('MergeCode manual: ' + mergeCodeCount + ' PR');
  }

  return '<div class="test-result result-success pr-summary-banner">' +
    '<div class="summary-main-line">✅ Found <strong>' + d.count + '</strong> PR waiting approve</div>' +
    '<div class="summary-sub-line">from ' + d.totalActive + ' total active PRs in <code>' + escapeHtml(d.targetBranch) + '</code></div>' +
    '<div class="summary-chip-row">' +
      chips.map(text => '<span class="summary-chip">' + text + '</span>').join('') +
    '</div>' +
  '</div>';
}

function renderPrTable(prs) {
  _allPrs = prs || [];
  window._prCache = {};

  // Populate cache first
  for (const pr of _allPrs) {
    window._prCache[pr.id] = {
      id: pr.id,
      title: pr.title,
      repository: pr.repository,
      reviewers: pr.reviewers || [],
      approval: pr.approval || {},
      myApproval: pr.myApproval || {},
      statusSnapshot: pr.statusSnapshot || {},
      releaseApproval: pr.releaseApproval || {},
      attention: pr.attention || {},
      policyFetched: pr.policyFetched === true,
      isMergeCodeTarget: isMergeCodePr(pr)
    };
  }

  // Split PRs into PR Queue and Release Queue
  const prQueue = _allPrs.filter(pr => !(pr.releaseApproval && pr.releaseApproval.status === 'pending'));
  const releaseQueue = _allPrs.filter(pr => pr.releaseApproval && pr.releaseApproval.status === 'pending');

  // Update Badges
  setText('prQueueBadge', prQueue.length);
  setText('releaseQueueBadge', releaseQueue.length);

  // Show tabs container
  const tabsContainer = document.getElementById('dashboardTabs');
  if (tabsContainer) tabsContainer.hidden = false;

  // Render both tables
  renderPrQueueTable(prQueue);
  renderReleaseQueueTable(releaseQueue);

  // Show/Hide active table container
  updateTabVisibility();
}

window.switchTab = function(tab) {
  window._activeTab = tab;
  try {
    sessionStorage.setItem('activeDashboardTab', tab);
  } catch (e) {}
  updateTabVisibility();
};

function updateTabVisibility() {
  const activeTab = window._activeTab || 'pr';

  const tabPr = document.getElementById('tabPrQueue');
  const tabRelease = document.getElementById('tabReleaseQueue');

  if (tabPr && tabRelease) {
    if (activeTab === 'pr') {
      tabPr.classList.add('active');
      tabRelease.classList.remove('active');
    } else {
      tabPr.classList.remove('active');
      tabRelease.classList.add('active');
    }
  }

  const prContainer = document.getElementById('prTableContainer');
  const releaseContainer = document.getElementById('releaseTableContainer');

  if (prContainer && releaseContainer) {
    if (activeTab === 'pr') {
      prContainer.hidden = false;
      releaseContainer.hidden = true;
    } else {
      prContainer.hidden = true;
      releaseContainer.hidden = false;
    }
  }
}

function renderPrQueueTable(prs) {
  document.getElementById('prMeta').textContent = prs.length + ' items';
  const tbody = document.getElementById('prTableBody');
  tbody.innerHTML = '';

  if (prs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:#9ca3af">— No PR waiting code approval right now —</td></tr>';
    return;
  }

  for (const pr of prs) {
    const tr = document.createElement('tr');
    if (pr.isDraft) tr.classList.add('pr-draft');
    if (isMergeCodePr(pr)) tr.classList.add('pr-mergecode');

    const mergeCodeBadge = isMergeCodePr(pr) ? ' <span class="pr-badge pr-badge-manual">MERGECODE MANUAL</span>' : '';
    const draftBadge = pr.isDraft ? ' <span class="pr-badge">DRAFT</span>' : '';
    const approvalBadge = renderApprovalBadge(pr);
    const statusBadge = renderStatusBadge(pr);
    const myApprovalBadge = renderMyApprovalBadge(pr);
    const attentionBadge = renderAttentionBadge(pr);
    const actionsHtml = renderActions(pr);

    tr.innerHTML =
      '<td class="pr-summary-cell">' + renderPrSummaryCell(pr, draftBadge, mergeCodeBadge) + '</td>' +
      '<td class="pr-branch-cell">' + renderBranchCell(pr) + '</td>' +
      '<td class="pr-approval-cell">' + approvalBadge + '</td>' +
      '<td class="pr-status-cell">' + statusBadge + '</td>' +
      '<td class="pr-attention-cell">' + attentionBadge + '</td>' +
      '<td class="pr-my-approval-cell">' + myApprovalBadge + '</td>' +
      '<td class="pr-actions-cell">' + actionsHtml + '</td>';

    tr.dataset.pr = JSON.stringify({
      id: pr.id, title: pr.title, repository: pr.repository,
      sourceBranch: shortBranch(pr.sourceBranch), targetBranch: shortBranch(pr.targetBranch),
      createdBy: pr.createdBy, repositoryId: pr.repositoryId
    });

    tbody.appendChild(tr);
  }
}

function renderReleaseQueueTable(prs) {
  document.getElementById('releaseMeta').textContent = prs.length + ' items';
  const tbody = document.getElementById('releaseTableBody');
  tbody.innerHTML = '';

  if (prs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:#9ca3af">— No PR waiting release approval right now —</td></tr>';
    return;
  }

  for (const pr of prs) {
    const tr = document.createElement('tr');
    if (pr.isDraft) tr.classList.add('pr-draft');
    if (isMergeCodePr(pr)) tr.classList.add('pr-mergecode');

    const mergeCodeBadge = isMergeCodePr(pr) ? ' <span class="pr-badge pr-badge-manual">MERGECODE MANUAL</span>' : '';
    const draftBadge = pr.isDraft ? ' <span class="pr-badge">DRAFT</span>' : '';
    const targetBranchHtml = renderTargetBranchCell(pr);
    const statusBadge = renderStatusBadge(pr);
    const releaseDefinitionHtml = renderReleaseDefinitionCell(pr);
    const envStatusHtml = renderEnvironmentStatusCell(pr);
    const actionsHtml = renderReleaseActions(pr);

    tr.innerHTML =
      '<td class="pr-summary-cell">' + renderPrSummaryCell(pr, draftBadge, mergeCodeBadge) + '</td>' +
      '<td class="pr-branch-cell">' + targetBranchHtml + '</td>' +
      '<td class="pr-status-cell">' + statusBadge + '</td>' +
      '<td class="pr-release-def-cell">' + releaseDefinitionHtml + '</td>' +
      '<td class="pr-env-status-cell">' + envStatusHtml + '</td>' +
      '<td class="pr-actions-cell">' + actionsHtml + '</td>';

    tr.dataset.pr = JSON.stringify({
      id: pr.id, title: pr.title, repository: pr.repository,
      sourceBranch: shortBranch(pr.sourceBranch), targetBranch: shortBranch(pr.targetBranch),
      createdBy: pr.createdBy, repositoryId: pr.repositoryId
    });

    tbody.appendChild(tr);
  }
}

function renderTargetBranchCell(pr) {
  const targetFull = shortBranch(pr.targetBranch);
  return '<div class="branch-stack">' +
    '<div class="branch-line branch-into">' +
      '<code title="' + escapeHtml(pr.targetBranch) + '">' + escapeHtml(targetFull) + '</code>' +
    '</div>' +
  '</div>';
}

function renderReleaseDefinitionCell(pr) {
  const r = pr.releaseApproval || {};
  const defName = r.releaseDefinitionName || r.cdName || r.expectedCdName || '-';
  return '<span class="release-definition-name" title="' + escapeHtml(defName) + '">' + escapeHtml(defName) + '</span>';
}

function renderEnvironmentStatusCell(pr) {
  const r = pr.releaseApproval || {};
  const status = String(r.status || 'not_found').toLowerCase();
  let cls = 'release-badge release-muted';
  let icon = '○';
  let label = r.label || 'No release yet';
  let envName = r.environmentName || '';

  if (status === 'pending') {
    cls = 'release-badge release-pending';
    icon = '⏳';
    label = 'Approval pending';
  } else if (status === 'expected') {
    cls = 'release-badge release-expected';
    icon = '🔎';
    label = 'Expected';
  } else if (status === 'approved' || status === 'succeeded') {
    cls = 'release-badge release-ok';
    icon = '✅';
    label = status === 'succeeded' ? 'Succeeded' : 'Approved';
  } else if (status === 'failed') {
    cls = 'release-badge release-failed';
    icon = '❌';
    label = 'Failed';
  } else if (status === 'deploying' || status === 'waiting') {
    cls = 'release-badge release-running';
    icon = status === 'deploying' ? '🚀' : '⏳';
    label = r.label || (status === 'deploying' ? 'Deploying' : 'Waiting');
  } else if (status === 'lookup_failed') {
    cls = 'release-badge release-failed';
    icon = '⚠️';
    label = 'Lookup failed';
  }

  return '<div class="release-env-status">' +
    '<span class="' + cls + '" title="' + escapeHtml(label) + '">' +
      '<span class="release-main">' + icon + ' ' + escapeHtml(label) + '</span>' +
      (envName ? '<span class="release-detail">' + escapeHtml(envName) + '</span>' : '') +
    '</span>' +
  '</div>';
}

function renderReleaseActions(pr) {
  const r = pr.releaseApproval || {};
  const status = String(r.status || 'not_found').toLowerCase();
  const openUrl = pr.url ? escapeHtml(pr.url) : '#';
  const openAttrs = pr.url ? ' target="_blank" rel="noopener"' : ' aria-disabled="true" tabindex="-1"';
  const openClass = pr.url ? 'btn-mini btn-open' : 'btn-mini btn-open btn-disabled';
  const releaseUrl = r.releaseUrl ? escapeHtml(r.releaseUrl) : '#';
  const releaseAttrs = r.releaseUrl ? ' target="_blank" rel="noopener"' : ' aria-disabled="true" tabindex="-1"';
  const releaseClass = r.releaseUrl ? 'btn-mini btn-release-link' : 'btn-mini btn-release-link btn-disabled';

  const canApprove = window._currentUser && window._currentUser.canApprovePrs === true;
  const approveButton = !isApprovalHeld(pr) && status === 'pending' && r.approvalId && canApprove
    ? '<button class="btn-mini btn-release" onclick="approveRelease(\'' + pr.id + '\')">Approve Release</button>'
    : '';

  return '<div class="action-cell">' +
    approveButton +
    (r.releaseUrl ? '<a class="' + releaseClass + '" href="' + releaseUrl + '"' + releaseAttrs + '>🚀 Release</a>' : '') +
    '<button class="btn-mini btn-history" onclick="openHistoryModal(\'' + pr.id + '\')">📜</button>' +
    '<a class="' + openClass + '" href="' + openUrl + '"' + openAttrs + '>🔗</a>' +
    '</div>';
}

function renderCompletedPrTable(prs, lookbackHours, totalMatched, displayLimit, pagingMeta) {
  const section = document.getElementById('completedSection');
  const meta = document.getElementById('completedMeta');
  const tbody = document.getElementById('completedTableBody');
  const pager = document.getElementById('completedPager');
  if (!section || !meta || !tbody) return;
  pagingMeta = pagingMeta || {};
  const isServerPaged = Number.isFinite(Number(pagingMeta.page)) && Number.isFinite(Number(pagingMeta.pageSize));

  if (!Array.isArray(prs) || prs.length === 0) {
    section.hidden = false;
    const total = Number.isFinite(Number(totalMatched)) ? Number(totalMatched) : 0;
    meta.textContent = 'Last ' + lookbackHours + ' hours by approval log | showing 0 of ' + total + ' PRs';
    tbody.innerHTML = '';
    if (pager) {
      pager.hidden = true;
      pager.innerHTML = '';
    }
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:22px;color:#9ca3af">— No approval log PRs found in the last ' + escapeHtml(lookbackHours) + ' hours —</td></tr>';
    return;
  }

  section.hidden = false;
  if (isServerPaged) {
    const page = Math.max(Number(pagingMeta.page) || 0, 0);
    const limit = Math.max(1, Number(pagingMeta.pageSize) || Number(displayLimit) || 10);
    const total = Number.isFinite(Number(totalMatched)) ? Number(totalMatched) : prs.length;
    const pageCount = Math.max(1, Math.ceil(total / limit));
    const start = page * limit;
    const end = Math.min(start + prs.length, total);
    window._recentlyApprovedPage = page;
    window._recentlyApprovedServerPaged = true;
    meta.textContent = 'Last ' + lookbackHours + ' hours by approval log | showing ' + (start + 1) + '-' + end + ' of ' + total + ' PRs';
    if (pager) {
      if (pageCount > 1) {
        pager.hidden = false;
        pager.innerHTML =
          '<button class="btn-mini btn-pager" onclick="changeRecentlyApprovedPage(-1)"' + (page === 0 ? ' disabled' : '') + '>Previous</button>' +
          '<span class="pager-label">Page ' + (page + 1) + ' of ' + pageCount + '</span>' +
          '<button class="btn-mini btn-pager" onclick="changeRecentlyApprovedPage(1)"' + (page >= pageCount - 1 ? ' disabled' : '') + '>Next</button>';
      } else {
        pager.hidden = true;
        pager.innerHTML = '';
      }
    }
    tbody.innerHTML = '';
    renderRecentlyApprovedRows(tbody, prs);
    return;
  }
  window._recentlyApprovedServerPaged = false;
  window._recentlyApprovedRows = prs;
  window._recentlyApprovedLookbackHours = lookbackHours;
  window._recentlyApprovedDisplayLimit = Math.max(1, Number(displayLimit) || 10);
  window._recentlyApprovedTotalMatched = Number.isFinite(Number(totalMatched)) ? Number(totalMatched) : prs.length;
  window._recentlyApprovedPage = 0;
  renderRecentlyApprovedPage();
}

function renderRecentlyApprovedPage() {
  const section = document.getElementById('completedSection');
  const meta = document.getElementById('completedMeta');
  const tbody = document.getElementById('completedTableBody');
  const pager = document.getElementById('completedPager');
  const prs = Array.isArray(window._recentlyApprovedRows) ? window._recentlyApprovedRows : [];
  const lookbackHours = window._recentlyApprovedLookbackHours || 24;
  const limit = Math.max(1, Number(window._recentlyApprovedDisplayLimit) || 10);
  const total = Number.isFinite(Number(window._recentlyApprovedTotalMatched))
    ? Number(window._recentlyApprovedTotalMatched)
    : prs.length;
  if (!section || !meta || !tbody) return;
  if (!prs.length) {
    section.hidden = false;
    meta.textContent = 'Last ' + lookbackHours + ' hours by approval log | showing 0 of 0 PRs';
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:22px;color:#9ca3af">— No approval log PRs found in the last ' + escapeHtml(lookbackHours) + ' hours —</td></tr>';
    if (pager) {
      pager.hidden = true;
      pager.innerHTML = '';
    }
    return;
  }

  const pageCount = Math.max(1, Math.ceil(prs.length / limit));
  const page = Math.min(Math.max(Number(window._recentlyApprovedPage) || 0, 0), pageCount - 1);
  window._recentlyApprovedPage = page;
  const start = page * limit;
  const end = Math.min(start + limit, prs.length);
  const pageRows = prs.slice(start, end);
  meta.textContent = 'Last ' + lookbackHours + ' hours by approval log | showing ' + (start + 1) + '-' + end + ' of ' + total + ' PRs';

  if (pager) {
    if (pageCount > 1) {
      pager.hidden = false;
      pager.innerHTML =
        '<button class="btn-mini btn-pager" onclick="changeRecentlyApprovedPage(-1)"' + (page === 0 ? ' disabled' : '') + '>Previous</button>' +
        '<span class="pager-label">Page ' + (page + 1) + ' of ' + pageCount + '</span>' +
        '<button class="btn-mini btn-pager" onclick="changeRecentlyApprovedPage(1)"' + (page >= pageCount - 1 ? ' disabled' : '') + '>Next</button>';
    } else {
      pager.hidden = true;
      pager.innerHTML = '';
    }
  }

  tbody.innerHTML = '';
  renderRecentlyApprovedRows(tbody, pageRows);
}

function renderRecentlyApprovedRows(tbody, rows) {
  for (const pr of rows) {
    const tr = document.createElement('tr');
    const statusBadge = renderRecentlyApprovedStatusBadge(pr);
    const releaseBadge = renderReleaseBadge(pr, {
      showApproveAction: false,
      summarizeExpectedWhenCompleted: true
    });
    const logSourceBadge = renderApprovalLogSourceBadge(pr);
    const approvedAt = pr.approvedAt || pr.closedDate || pr.creationDate;
    const actionsHtml = renderCompletedActions(pr);
    tr.innerHTML =
      '<td class="pr-id-cell">' + renderPrIdInline(pr, 'approved') + '</td>' +
      '<td class="pr-title-cell"><span class="pr-title-text">' + escapeHtml(pr.title) + '</span></td>' +
      '<td class="pr-by-cell">' + escapeHtml(pr.createdBy || '-') + '</td>' +
      '<td class="pr-branch-cell">' + renderBranchCell(pr) + '</td>' +
      '<td class="pr-status-cell">' + statusBadge + '</td>' +
      '<td class="pr-release-cell">' + releaseBadge + '</td>' +
      '<td class="pr-log-source-cell">' + logSourceBadge + '</td>' +
      '<td class="pr-repo-cell">' + escapeHtml(pr.repository || '-') + '</td>' +
      '<td class="pr-created-cell">' + formatDate(approvedAt) + '</td>' +
      '<td class="pr-actions-cell">' + actionsHtml + '</td>';
    tbody.appendChild(tr);
  }
}

function renderApprovalLogSourceBadge(pr) {
  const action = String(pr && pr.approvedAction || '').trim() || 'Approved';
  const source = String(pr && pr.approvedSource || '').trim() || 'Dashboard';
  const actionKey = action.toLowerCase();
  const sourceKey = source.toLowerCase();
  let cls = 'log-source-badge log-source-dashboard';
  let label = action;

  if (actionKey.includes('external') || sourceKey.includes('azure devops')) {
    cls = 'log-source-badge log-source-external';
    label = action.replace(/^External\s+/i, 'External ');
  } else if (sourceKey.includes('teams')) {
    cls = 'log-source-badge log-source-notification';
  }

  return '<span class="' + cls + '" title="' + escapeHtml(action + ' · ' + source) + '">' +
    '<span class="log-source-action">' + escapeHtml(label) + '</span>' +
    '<span class="log-source-name">' + escapeHtml(source) + '</span>' +
    '</span>';
}

window.changeRecentlyApprovedPage = function(delta) {
  const page = Number(window._recentlyApprovedPage) || 0;
  const nextPage = Math.max(page + delta, 0);
  if (window._recentlyApprovedServerPaged) {
    loadPrActivity(nextPage);
    return;
  }
  window._recentlyApprovedPage = nextPage;
  renderRecentlyApprovedPage();
};

function renderPrSummaryCell(pr, draftBadge, mergeCodeBadge) {
  return '<div class="pr-summary">' +
    '<div class="pr-summary-main">' +
      renderPrIdInline(pr, 'active') +
      '<span class="pr-title-text">' + escapeHtml(pr.title) + '</span>' +
      (draftBadge || '') + (mergeCodeBadge || '') +
    '</div>' +
    '<div class="pr-summary-meta">' +
      '<span><strong>Repo:</strong> ' + escapeHtml(pr.repository || '-') + '</span>' +
      '<span><strong>By:</strong> ' + escapeHtml(pr.createdBy || '-') + '</span>' +
      '<span>' + formatDate(pr.creationDate) + '</span>' +
    '</div>' +
  '</div>';
}

function renderPrIdInline(pr, mode) {
  const marker = getPrStateMarker(pr, mode);
  const idText = pr.id ? (typeof pr.id === 'string' && pr.id.startsWith('R') ? pr.id : '#' + pr.id) : '🚀 Release';
  return '<span class="pr-id-wrap" title="' + escapeHtml(marker.title) + '">' +
    '<span class="pr-state-prefix ' + marker.className + '" aria-label="' + escapeHtml(marker.title) + '">' + marker.icon + '</span>' +
    '<strong class="pr-summary-id">' + escapeHtml(idText) + '</strong>' +
    '</span>';
}

function getPrStateMarker(pr, mode) {
  if (pr && typeof pr.id === 'string' && pr.id.startsWith('R')) {
    return { icon: '🚀', className: 'pr-state-pending', title: 'Pending Release Approval' };
  }
  if (mode === 'completed' || mode === 'approved') {
    const summary = getStatusSummaryText(pr);
    if (summary === 'Build Failed' || summary === 'Policy Failed') {
      return { icon: '❌', className: 'pr-state-failed', title: summary };
    }
    if (summary === 'Build Running' || summary === 'Policy Pending') {
      return { icon: '⏳', className: 'pr-state-pending', title: summary };
    }
    if (mode === 'approved' && String(pr.status || '').toLowerCase() === 'active') {
      return { icon: '✅', className: 'pr-state-completed', title: 'Approved PR' };
    }
    if (String(pr.status || '').toLowerCase() === 'completed') {
      return { icon: '✅', className: 'pr-state-completed', title: 'Completed PR' };
    }
    return { icon: '○', className: 'pr-state-muted', title: 'Closed PR' };
  }

  if (isMergeCodePr(pr)) {
    return { icon: '🔒', className: 'pr-state-manual', title: 'Manual action required in Azure DevOps' };
  }

  if (isApprovalHeld(pr)) {
    return { icon: '⏸', className: 'pr-state-hold', title: getHoldReason(pr) || 'Approval is on hold' };
  }

  const attention = pr.attention || {};
  const attentionStatus = String(attention.status || '').toLowerCase();
  if (attentionStatus === 'critical') {
    return { icon: '🚨', className: 'pr-state-critical', title: attention.reason || 'Critical attention required' };
  }
  if (attentionStatus === 'warning' || attentionStatus === 'stale') {
    return { icon: '⚠️', className: 'pr-state-warning', title: attention.reason || 'PR is waiting longer than expected' };
  }

  const myStatus = pr.myApproval && pr.myApproval.status ? String(pr.myApproval.status).toLowerCase() : '';
  if (myStatus === 'approved' || myStatus === 'suggestions') {
    return { icon: '✅', className: 'pr-state-completed', title: 'Your vote has been submitted' };
  }
  if (myStatus === 'rejected') {
    return { icon: '❌', className: 'pr-state-failed', title: 'Your vote is rejected' };
  }

  if (attentionStatus === 'watch') {
    return { icon: '⏳', className: 'pr-state-pending', title: attention.reason || 'Approval is pending' };
  }
  return { icon: '🆕', className: 'pr-state-new', title: 'New PR waiting approve' };
}

function renderActions(pr) {
  const openUrl = pr.url ? escapeHtml(pr.url) : '#';
  const openAttrs = pr.url ? ' target="_blank" rel="noopener"' : ' aria-disabled="true" tabindex="-1"';
  const openClass = pr.url ? 'btn-mini btn-open' : 'btn-mini btn-open btn-disabled';
  const canApprovePrs = window._currentUser && window._currentUser.canApprovePrs === true;
  const requiredRole = window._currentUser && window._currentUser.requiredRole
    ? window._currentUser.requiredRole
    : 'it_support_approve';

  if (isMergeCodePr(pr)) {
    return '<div class="action-cell">' +
      '<span class="manual-action-note">Manual in Azure DevOps</span>' +
      '<button class="btn-mini btn-history" onclick="openHistoryModal(\'' + pr.id + '\')">📜</button>' +
      '<a class="' + openClass + '" href="' + openUrl + '"' + openAttrs + '>🔗 Open ADO</a>' +
      '</div>';
  }

  if (!canApprovePrs) {
    return '<div class="action-cell">' +
      (isApprovalHeld(pr) ? renderHoldStatus(pr) : '') +
      '<button class="btn-mini btn-history" onclick="openHistoryModal(\'' + pr.id + '\')">📜</button>' +
      '<a class="' + openClass + '" href="' + openUrl + '"' + openAttrs + '>🔗</a>' +
      '</div>';
  }

  if (isApprovalHeld(pr)) {
    return '<div class="action-cell">' +
      renderHoldStatus(pr) +
      '<button class="btn-mini btn-unhold" onclick="releaseApprovalHold(\'' + pr.id + '\')">Unlock</button>' +
      '<button class="btn-mini btn-history" onclick="openHistoryModal(\'' + pr.id + '\')">📜</button>' +
      '<a class="' + openClass + '" href="' + openUrl + '"' + openAttrs + '>🔗</a>' +
      '</div>';
  }

  const myStatus = pr.myApproval && pr.myApproval.status ? String(pr.myApproval.status).toLowerCase() : '';
  if (['approved', 'suggestions', 'rejected', 'waiting-author'].includes(myStatus)) {
    return '<div class="action-cell">' +
      '<span class="action-note">Vote submitted</span>' +
      '<button class="btn-mini btn-history" onclick="openHistoryModal(\'' + pr.id + '\')">📜</button>' +
      '<a class="' + openClass + '" href="' + openUrl + '"' + openAttrs + '>🔗</a>' +
      '</div>';
  }

  return '<div class="action-cell">' +
    '<button class="btn-mini btn-approve" onclick="openApproveModal(\'' + pr.id + '\', \'' + pr.repositoryId + '\')">✅ Approve</button>' +
    '<button class="btn-mini btn-reject" onclick="openRejectModal(\'' + pr.id + '\', \'' + pr.repositoryId + '\')">❌ Reject</button>' +
    '<button class="btn-mini btn-hold-mini" onclick="openApprovalHoldModal(\'' + pr.id + '\', \'' + pr.repositoryId + '\')">⏸ Hold</button>' +
    '<button class="btn-mini btn-history" onclick="openHistoryModal(\'' + pr.id + '\')">📜</button>' +
    '<a class="' + openClass + '" href="' + openUrl + '"' + openAttrs + '>🔗</a>' +
    '</div>';
}

function isApprovalHeld(pr) {
  return !!(pr && pr.approvalHold && pr.approvalHold.active);
}

function getHoldReason(pr) {
  return pr && pr.approvalHold && pr.approvalHold.reason ? String(pr.approvalHold.reason) : '';
}

function renderHoldStatus(pr) {
  const hold = pr && pr.approvalHold || {};
  const reason = hold.reason ? '<span class="hold-detail">' + escapeHtml(hold.reason) + '</span>' : '';
  return '<span class="hold-status" title="' + escapeHtml(hold.reason || 'Approval is on hold') + '">' +
    '<span class="hold-label">⏸ On Hold</span>' + reason + '</span>';
}

function renderCompletedActions(pr) {
  const openUrl = pr.url ? escapeHtml(pr.url) : '#';
  const openAttrs = pr.url ? ' target="_blank" rel="noopener"' : ' aria-disabled="true" tabindex="-1"';
  const openClass = pr.url ? 'btn-mini btn-open' : 'btn-mini btn-open btn-disabled';
  return '<div class="action-cell">' +
    '<button class="btn-mini btn-history" onclick="openHistoryModal(\'' + pr.id + '\')">📜</button>' +
    '<a class="' + openClass + '" href="' + openUrl + '"' + openAttrs + '>🔗</a>' +
    '</div>';
}

function isMergeCodePr(pr) {
  return pr && (
    pr.isMergeCodeTarget === true ||
    String(pr.targetBranch || '').toLowerCase().includes('mergecode')
  );
}

function renderMyApprovalBadge(pr) {
  const my = pr.myApproval || {};
  let cls = 'my-approval my-approval-pending';
  let icon = '⭕';
  let label = my.label || 'Not approved';

  if (my.status === 'approved') {
    cls = 'my-approval my-approval-approved';
    icon = '✅';
  } else if (my.status === 'suggestions') {
    cls = 'my-approval my-approval-approved';
    icon = '☑️';
  } else if (my.status === 'rejected') {
    cls = 'my-approval my-approval-rejected';
    icon = '❌';
  } else if (my.status === 'waiting-author') {
    cls = 'my-approval my-approval-warning';
    icon = '⏸';
  } else if (my.status === 'manual') {
    cls = 'my-approval my-approval-manual';
    icon = '🔗';
  } else if (my.status === 'not-reviewer') {
    cls = 'my-approval my-approval-muted';
    icon = '—';
  }

  const detail = my.detail ? '<span class="my-approval-detail">' + escapeHtml(my.detail) + '</span>' : '';
  return '<span class="' + cls + '">' +
    '<span class="my-approval-label">' + icon + ' ' + escapeHtml(label) + '</span>' +
    detail +
    '</span>';
}

function renderStatusBadge(pr) {
  const s = pr.statusSnapshot || {};
  const buildResult = String(s.buildResult || 'unknown').toLowerCase();
  const buildStatus = String(s.buildStatus || 'unknown').toLowerCase();
  const policyStatus = String(s.policyStatus || 'unknown').toLowerCase();
  const mergeStatus = String(s.mergeStatus || '').toLowerCase();

  let cls = 'status-snapshot status-snapshot-muted';
  let icon = '○';
  let buildLabel = 'No build status';
  const hasBuildStatus = buildResult && buildResult !== 'unknown' && buildResult !== 'no_status';

  if (buildResult === 'succeeded') {
    cls = 'status-snapshot status-snapshot-success';
    icon = '✅';
    buildLabel = 'Build Success';
  } else if (buildResult === 'failed' || buildResult === 'error') {
    cls = 'status-snapshot status-snapshot-failed';
    icon = '❌';
    buildLabel = 'Build Failed';
  } else if (buildResult === 'pending' || buildStatus === 'in_progress') {
    cls = 'status-snapshot status-snapshot-pending';
    icon = '⏳';
    buildLabel = 'Build Running';
  } else if (!hasBuildStatus && policyStatus === 'approved') {
    cls = 'status-snapshot status-snapshot-success';
    icon = '✅';
    buildLabel = 'Policy Approved';
  } else if (!hasBuildStatus && policyStatus === 'failed') {
    cls = 'status-snapshot status-snapshot-failed';
    icon = '❌';
    buildLabel = 'Policy Failed';
  } else if (!hasBuildStatus && policyStatus === 'pending') {
    cls = 'status-snapshot status-snapshot-pending';
    icon = '⏳';
    buildLabel = 'Policy Pending';
  }

  const policyLabel = policyStatus && policyStatus !== 'unknown'
    ? 'Policy: ' + policyStatus
    : 'Policy: unknown';
  const mergeLabel = mergeStatus ? 'Merge: ' + mergeStatus : 'Merge: -';
  const title = buildLabel + ' | ' + policyLabel + ' | ' + mergeLabel;
  const inner = '<span class="status-main">' + icon + ' ' + escapeHtml(buildLabel) + '</span>' +
    '<span class="status-detail">' + escapeHtml(policyLabel) + '</span>';

  if (s.adoBuildUrl) {
    return '<a class="' + cls + '" href="' + escapeHtml(s.adoBuildUrl) + '" target="_blank" rel="noopener" title="' + escapeHtml(title) + '">' + inner + '</a>';
  }
  return '<span class="' + cls + '" title="' + escapeHtml(title) + '">' + inner + '</span>';
}

function renderReleaseBadge(pr, options) {
  options = options || {};
  const r = pr.releaseApproval || {};
  const status = String(r.status || 'not_found').toLowerCase();
  let cls = 'release-badge release-muted';
  let icon = '○';
  let label = r.label || 'No release yet';
  let detail = r.environmentName || r.cdName || r.expectedCdName || r.detail || '';

  if (status === 'pending') {
    cls = 'release-badge release-pending';
    icon = '⏳';
    label = 'Release approval pending';
  } else if (status === 'expected') {
    if (options.summarizeExpectedWhenCompleted && isPrCompletedForReleaseSummary(pr)) {
      cls = 'release-badge release-no-pending';
      icon = '✅';
      label = 'No release approval pending';
      detail = detail ? 'Expected CD: ' + detail : 'PR completed';
    } else {
      cls = 'release-badge release-expected';
      icon = '🔎';
      label = 'Release expected';
    }
  } else if (status === 'approved' || status === 'succeeded') {
    cls = 'release-badge release-ok';
    icon = '✅';
    label = status === 'succeeded' ? 'Deploy succeeded' : 'Release approved';
  } else if (status === 'failed') {
    cls = 'release-badge release-failed';
    icon = '❌';
    label = 'Deploy failed';
  } else if (status === 'deploying' || status === 'waiting') {
    cls = 'release-badge release-running';
    icon = status === 'deploying' ? '🚀' : '⏳';
    label = r.label || (status === 'deploying' ? 'Deploying' : 'Waiting release');
  } else if (status === 'lookup_failed') {
    cls = 'release-badge release-failed';
    icon = '⚠️';
    label = 'Release lookup failed';
  }

  const title = [
    label,
    r.releaseName,
    r.releaseDefinitionName || r.cdName,
    r.environmentName,
    r.approver
  ].filter(Boolean).join(' | ');
  const openLink = r.releaseUrl
    ? '<a class="release-link" href="' + escapeHtml(r.releaseUrl) + '" target="_blank" rel="noopener">Open Release</a>'
    : '';
  const canApprove = window._currentUser && window._currentUser.canApprovePrs === true;
  const showApproveAction = options.showApproveAction !== false;
  const approveButton = showApproveAction && !isApprovalHeld(pr) && status === 'pending' && r.approvalId && canApprove
    ? '<button class="btn-mini btn-release" onclick="approveRelease(\'' + pr.id + '\')">Approve Release</button>'
    : '';

  return '<div class="release-cell-stack">' +
    '<span class="' + cls + '" title="' + escapeHtml(title) + '">' +
      '<span class="release-main">' + icon + ' ' + escapeHtml(label) + '</span>' +
      (detail ? '<span class="release-detail">' + escapeHtml(detail) + '</span>' : '') +
    '</span>' +
    (approveButton || openLink ? '<div class="release-actions">' + approveButton + openLink + '</div>' : '') +
  '</div>';
}

function isPrCompletedForReleaseSummary(pr) {
  const status = String(pr && pr.status || '').toLowerCase();
  const approvalStatus = String(pr && pr.approval && pr.approval.status || '').toLowerCase();
  const snapshot = pr && pr.statusSnapshot || {};
  const policyStatus = String(snapshot.policyStatus || '').toLowerCase();
  const buildResult = String(snapshot.buildResult || '').toLowerCase();
  const mergeStatus = String(snapshot.mergeStatus || pr && pr.mergeStatus || '').toLowerCase();

  if (status === 'completed') return true;
  if (buildResult === 'failed' || buildResult === 'error') return false;
  if (policyStatus === 'failed' || policyStatus === 'rejected' || policyStatus === 'pending') return false;
  if (approvalStatus === 'complete' && policyStatus === 'approved') return true;
  return approvalStatus === 'complete' && (mergeStatus === 'succeeded' || mergeStatus === 'completed');
}

function renderAttentionBadge(pr) {
  const a = pr.attention || {};
  const status = String(a.status || 'normal').toLowerCase();
  let cls = 'attention-badge attention-normal';
  let icon = '🟢';
  if (status === 'critical') {
    cls = 'attention-badge attention-critical';
    icon = '🔴';
  } else if (status === 'warning' || status === 'stale') {
    cls = 'attention-badge attention-warning';
    icon = '🟠';
  } else if (status === 'watch') {
    cls = 'attention-badge attention-watch';
    icon = '🟡';
  } else if (status === 'ready') {
    cls = 'attention-badge attention-ready';
    icon = '✅';
  } else if (status === 'manual') {
    cls = 'attention-badge attention-manual';
    icon = '🔗';
  }
  const label = a.label || 'Normal';
  const detail = a.reason ? '<span class="attention-detail">' + escapeHtml(a.reason) + '</span>' : '';
  const title = [label, a.ageLabel, a.reason].filter(Boolean).join(' | ');
  return '<span class="' + cls + '" title="' + escapeHtml(title) + '">' +
    '<span class="attention-label">' + icon + ' ' + escapeHtml(label) + '</span>' +
    detail +
    '</span>';
}

function renderCompletedStatusBadge(pr) {
  const s = pr.statusSnapshot || {};
  const policyStatus = String(s.policyStatus || 'unknown').toLowerCase();
  const mergeStatus = String(s.mergeStatus || pr.mergeStatus || '').toLowerCase();
  const isCompleted = String(pr.status || '').toLowerCase() === 'completed';
  const isMerged = mergeStatus === 'succeeded' || mergeStatus === 'completed';
  const supportingLabel = getStatusSummaryText(pr);
  const isFailed = supportingLabel === 'Build Failed' || supportingLabel === 'Policy Failed';
  const isRunning = supportingLabel === 'Build Running' || supportingLabel === 'Policy Pending';

  let cls = 'status-snapshot status-snapshot-success';
  let icon = '✅';
  let label = 'Completed';

  if (isFailed) {
    cls = 'status-snapshot status-snapshot-failed';
    icon = '❌';
    label = supportingLabel;
  } else if (isRunning) {
    cls = 'status-snapshot status-snapshot-pending';
    icon = '⏳';
    label = supportingLabel;
  } else if (!isCompleted && !isMerged) {
    cls = 'status-snapshot status-snapshot-muted';
    icon = '○';
    label = 'Closed';
  }

  const policyLabel = policyStatus && policyStatus !== 'unknown'
    ? 'Policy: ' + policyStatus
    : 'Policy: unknown';
  const title = label + ' | ' + supportingLabel + ' | ' + policyLabel;
  return '<span class="' + cls + '" title="' + escapeHtml(title) + '">' +
    '<span class="status-main">' + icon + ' ' + escapeHtml(label) + '</span>' +
    '<span class="status-detail">' + escapeHtml(isFailed || isRunning ? 'PR completed' : supportingLabel) + '</span>' +
    '</span>';
}

function renderRecentlyApprovedStatusBadge(pr) {
  const s = pr.statusSnapshot || {};
  const policyStatus = String(s.policyStatus || 'unknown').toLowerCase();
  const mergeStatus = String(s.mergeStatus || pr.mergeStatus || '').toLowerCase();
  const prStatus = String(pr.status || '').toLowerCase();
  const isCompleted = prStatus === 'completed';
  const isMerged = mergeStatus === 'succeeded' || mergeStatus === 'completed';
  const supportingLabel = getStatusSummaryText(pr);
  const isFailed = supportingLabel === 'Build Failed' || supportingLabel === 'Policy Failed';
  const isRunning = supportingLabel === 'Build Running' || supportingLabel === 'Policy Pending';

  let cls = 'status-snapshot status-snapshot-success';
  let icon = '✅';
  let label = 'Approved';
  let detail = supportingLabel && supportingLabel !== 'No build status' ? supportingLabel : 'Waiting completion';

  if (isFailed) {
    cls = 'status-snapshot status-snapshot-failed';
    icon = '❌';
    label = supportingLabel;
    detail = 'PR approved';
  } else if (isRunning) {
    cls = 'status-snapshot status-snapshot-pending';
    icon = '⏳';
    label = supportingLabel;
    detail = 'PR approved';
  } else if (isCompleted || isMerged) {
    label = 'Completed';
    detail = supportingLabel;
  } else if (prStatus && prStatus !== 'active') {
    cls = 'status-snapshot status-snapshot-muted';
    icon = '○';
    label = 'Closed';
    detail = supportingLabel;
  }

  const policyLabel = policyStatus && policyStatus !== 'unknown'
    ? 'Policy: ' + policyStatus
    : 'Policy: unknown';
  const title = label + ' | ' + supportingLabel + ' | ' + policyLabel;
  return '<span class="' + cls + '" title="' + escapeHtml(title) + '">' +
    '<span class="status-main">' + icon + ' ' + escapeHtml(label) + '</span>' +
    '<span class="status-detail">' + escapeHtml(detail) + '</span>' +
    '</span>';
}

function getStatusSummaryText(pr) {
  const s = pr.statusSnapshot || {};
  const buildResult = String(s.buildResult || 'unknown').toLowerCase();
  const buildStatus = String(s.buildStatus || 'unknown').toLowerCase();
  const policyStatus = String(s.policyStatus || 'unknown').toLowerCase();

  if (buildResult === 'succeeded') return 'Build Success';
  if (buildResult === 'failed' || buildResult === 'error') return 'Build Failed';
  if (buildResult === 'pending' || buildStatus === 'in_progress') return 'Build Running';
  if (policyStatus === 'approved') return 'Policy Approved';
  if (policyStatus === 'failed') return 'Policy Failed';
  if (policyStatus === 'pending') return 'Policy Pending';
  return 'No build status';
}

// ===== Approval Badge =====
function renderApprovalBadge(pr) {
  const a = pr.approval || {};
  const approved = a.approvedCount || 0;
  const required = a.requiredCount || 0;
  const status = a.status || 'pending';

  let cls = 'approval-badge approval-pending';
  let icon = '🟡';
  let text = 'Pending';

  if (status === 'rejected') {
    cls = 'approval-badge approval-rejected';
    icon = '🔴';
    text = 'Rejected';
  } else if (status === 'complete') {
    cls = 'approval-badge approval-complete';
    icon = '🟢';
    text = 'Complete';
  }

  const ratio = required > 0 ? approved + '/' + required : approved + '';
  return '<button class="' + cls + '" onclick="openReviewersModal(\'' + pr.id + '\')" title="คลิกดูรายชื่อ reviewers">' +
    '<span class="approval-icon">' + escapeHtml(icon) + '</span>' +
    '<span class="approval-ratio">' + escapeHtml(ratio) + '</span>' +
    '<span class="approval-status">' + escapeHtml(text) + '</span>' +
    '</button>';
}

// ===== Reviewers Modal =====
window.openReviewersModal = function(prId) {
  const data = (window._prCache || {})[prId];
  if (!data) return;
  document.getElementById('reviewersPrId').textContent = '#' + prId;

  const a = data.approval || {};
  let summaryHtml =
    '<div class="rev-summary-row"><strong>Status:</strong> ' + voteStatusText(a.status) + '</div>' +
    '<div class="rev-summary-row"><strong>Approved:</strong> ' + (a.approvedCount || 0) + ' / ' + (a.requiredCount || 0) + '</div>' +
    '<div class="rev-summary-row"><strong>Branch Policy minimum:</strong> ' +
      (a.minApproversFromPolicy || 0) +
      (data.policyFetched ? '' : ' <em style="color:#dc2626">(policy fetch failed)</em>') + '</div>' +
    '<div class="rev-summary-row"><strong>Required reviewers in PR:</strong> ' +
      (a.requiredReviewerApproved || 0) + ' / ' + (a.requiredReviewerTotal || 0) + ' approved</div>';
  if (Array.isArray(a.requiredPendingNames) && a.requiredPendingNames.length > 0) {
    summaryHtml += '<div class="rev-summary-row"><strong>Pending required:</strong> ' +
      escapeHtml(a.requiredPendingNames.join(', ')) + '</div>';
  }
  if (Array.isArray(a.requiredRejectedNames) && a.requiredRejectedNames.length > 0) {
    summaryHtml += '<div class="rev-summary-row"><strong>Rejected required:</strong> ' +
      escapeHtml(a.requiredRejectedNames.join(', ')) + '</div>';
  }
  document.getElementById('reviewersSummary').innerHTML = summaryHtml;

  const reviewers = (data.reviewers || []).slice().sort((x, y) => {
    if (x.isRequired !== y.isRequired) return x.isRequired ? -1 : 1;
    if (x.isContainer !== y.isContainer) return x.isContainer ? -1 : 1;
    return (x.displayName || '').localeCompare(y.displayName || '');
  });

  let listHtml = '<table class="reviewers-table"><thead><tr>' +
    '<th>Reviewer</th><th>Type</th><th>Required</th><th>Vote</th></tr></thead><tbody>';
  if (reviewers.length === 0) {
    listHtml += '<tr><td colspan="4" style="text-align:center;padding:16px;color:#9ca3af">— ไม่มี reviewer —</td></tr>';
  } else {
    for (const r of reviewers) {
      const v = Number(r.vote) || 0;
      let voteIcon = '⏳', voteText = 'No vote', voteClass = '';
      if (v >= 10) { voteIcon = '✅'; voteText = 'Approved'; voteClass = 'log-approved'; }
      else if (v === 5) { voteIcon = '☑️'; voteText = 'Approved with suggestions'; voteClass = 'log-approved'; }
      else if (v === -5) { voteIcon = '⏸'; voteText = 'Waiting for author'; }
      else if (v <= -10) { voteIcon = '❌'; voteText = 'Rejected'; voteClass = 'log-rejected'; }
      const typeIcon = r.isContainer ? '👥 Group' : '👤 Person';
      const reqBadge = r.isRequired ? '<span class="req-badge">REQUIRED</span>' : '<span style="color:#9ca3af">optional</span>';
      listHtml += '<tr>' +
        '<td>' + escapeHtml(r.displayName || '-') + '</td>' +
        '<td>' + typeIcon + '</td>' +
        '<td>' + reqBadge + '</td>' +
        '<td><span class="' + voteClass + '">' + voteIcon + ' ' + voteText + '</span></td>' +
      '</tr>';
    }
  }
  listHtml += '</tbody></table>';
  document.getElementById('reviewersList').innerHTML = listHtml;
  openModal('reviewersModal');
};

function voteStatusText(s) {
  if (s === 'complete') return '<span class="log-approved">🟢 Complete (พร้อม merge)</span>';
  if (s === 'rejected') return '<span class="log-rejected">🔴 Rejected (มี reviewer reject)</span>';
  return '<span style="color:#d97706">🟡 Pending (รอ approver เพิ่ม)</span>';
}

function getPrFromTable(prId) {
  const rows = document.querySelectorAll('#prTableBody tr, #releaseTableBody tr');
  let prData = null;
  rows.forEach(r => {
    if (r.dataset.pr) {
      const p = JSON.parse(r.dataset.pr);
      if (String(p.id) === String(prId)) prData = p;
    }
  });
  return prData;
}

// ===== Approve Modal =====
window.openApproveModal = function(prId, repositoryId) {
  const prData = getPrFromTable(prId);
  if (!prData) return;
  if (isApprovalHeld(prData)) {
    alert('⏸ PR นี้อยู่ใน Approval Hold\n\nReason: ' + (getHoldReason(prData) || '-'));
    return;
  }
  currentPrForAction = Object.assign({}, prData, { repositoryId });

  document.getElementById('approvePrInfo').innerHTML =
    '<div><strong>PR #' + prData.id + '</strong>: ' + escapeHtml(prData.title) + '</div>' +
    '<div style="font-size:13px;color:#6b7280;margin-top:4px">' +
    'Repo: <code>' + escapeHtml(prData.repository) + '</code> | ' +
    '<code>' + escapeHtml(prData.sourceBranch) + '</code> → <code>' + escapeHtml(prData.targetBranch) + '</code></div>';
  openModal('confirmApproveModal');
};

async function doApprove() {
  if (!currentPrForAction) return;
  setButtonLoading('btnConfirmApprove', true, 'Submitting...');
  try {
    const r = await safeFetchJson('/api/approve-pr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prId: currentPrForAction.id,
        repositoryId: currentPrForAction.repositoryId
      })
    });
    if (r.parseError || !r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      alert('❌ Approve ไม่สำเร็จ:\n' + (d.error || 'Unknown') + '\n\n' + (d.detail || d.hint || ''));
    } else {
      const ignoredText = r.data.releaseNotesIgnored > 0
        ? '\nRelease Notes ignored: ' + r.data.releaseNotesIgnored + ' policy'
        : '\nRelease Notes: ไม่พบ policy (ข้าม)';
      alert('✅ Approve สำเร็จ!\n\nPR #' + r.data.prId +
        '\nAuto-Complete: ' + (r.data.autoComplete ? 'เปิดแล้ว' : 'ตั้งไม่สำเร็จ') +
        ignoredText +
        '\nLog SharePoint: ' + r.data.logStatus);
      closeModal('confirmApproveModal');
      checkPrs();
    }
  } catch (err) {
    alert('❌ Error: ' + err.message);
  } finally {
    setButtonLoading('btnConfirmApprove', false);
  }
}

window.approveRelease = async function(prId) {
  const pr = (window._prCache || {})[prId];
  const release = pr && pr.releaseApproval || {};
  if (isApprovalHeld(pr)) {
    alert('⏸ PR นี้อยู่ใน Approval Hold\n\nReason: ' + (getHoldReason(pr) || '-') + '\n\nกรุณา Unlock ก่อน Approve Release');
    return;
  }
  if (!pr || !release.approvalId) {
    alert('ไม่พบ Release approval ที่สามารถอนุมัติได้');
    return;
  }

  const idLabel = typeof pr.id === 'string' && pr.id.startsWith('R') ? 'Virtual Release ' + pr.id : 'PR #' + pr.id;
  const title = 'Approve Release?\n\n' + idLabel +
    '\nRelease: ' + (release.releaseName || '-') +
    '\nEnvironment: ' + (release.environmentName || '-') +
    '\nCD: ' + (release.releaseDefinitionName || release.cdName || '-');
  if (!confirm(title)) return;

  try {
    const r = await safeFetchJson('/api/approve-release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prId: pr.id,
        repository: pr.repository,
        prTitle: pr.title,
        releaseId: release.releaseId,
        approvalId: release.approvalId,
        releaseName: release.releaseName,
        environmentName: release.environmentName,
        releaseUrl: release.releaseUrl
      })
    });
    if (r.parseError || !r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      alert('❌ Approve Release ไม่สำเร็จ:\n' + (d.error || 'Unknown') + '\n\n' + (d.detail || d.hint || ''));
      return;
    }
    alert('✅ Approve Release สำเร็จ!\n\nRelease: ' + (r.data.releaseName || release.releaseName || '-') +
      '\nEnvironment: ' + (r.data.environmentName || release.environmentName || '-') +
      '\nLog SharePoint: ' + (r.data.logStatus || '-'));
    checkPrs();
  } catch (err) {
    alert('❌ Error: ' + err.message);
  }
};

// ===== Reject Modal =====
window.openRejectModal = function(prId, repositoryId) {
  const prData = getPrFromTable(prId);
  if (!prData) return;
  if (isApprovalHeld(prData)) {
    alert('⏸ PR นี้อยู่ใน Approval Hold\n\nReason: ' + (getHoldReason(prData) || '-'));
    return;
  }
  currentPrForAction = Object.assign({}, prData, { repositoryId });

  document.getElementById('rejectPrInfo').innerHTML =
    '<div><strong>PR #' + prData.id + '</strong>: ' + escapeHtml(prData.title) + '</div>' +
    '<div style="font-size:13px;color:#6b7280;margin-top:4px">' +
    'Repo: <code>' + escapeHtml(prData.repository) + '</code></div>';
  document.getElementById('rejectReason').value = '';
  openModal('confirmRejectModal');
};

async function doReject() {
  if (!currentPrForAction) return;
  const reason = document.getElementById('rejectReason').value.trim();
  if (reason.length < 3) {
    alert('⚠️ กรุณาใส่เหตุผลที่ Reject (อย่างน้อย 3 ตัวอักษร)');
    return;
  }
  setButtonLoading('btnConfirmReject', true, 'Submitting...');
  try {
    const r = await safeFetchJson('/api/reject-pr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prId: currentPrForAction.id,
        repositoryId: currentPrForAction.repositoryId,
        reason: reason
      })
    });
    if (r.parseError || !r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      alert('❌ Reject ไม่สำเร็จ:\n' + (d.error || 'Unknown'));
    } else {
      alert('✅ Reject สำเร็จ!\n\nPR #' + r.data.prId + '\nLog: ' + r.data.logStatus);
      closeModal('confirmRejectModal');
      checkPrs();
    }
  } catch (err) {
    alert('❌ Error: ' + err.message);
  } finally {
    setButtonLoading('btnConfirmReject', false);
  }
}

window.openApprovalHoldModal = function(prId, repositoryId) {
  const prData = getPrFromTable(prId);
  if (!prData) return;
  if (isApprovalHeld(prData)) {
    alert('PR นี้อยู่ใน Approval Hold อยู่แล้ว');
    return;
  }
  currentPrForAction = Object.assign({}, prData, { repositoryId });
  document.getElementById('holdPrInfo').innerHTML =
    '<div><strong>PR #' + prData.id + '</strong>: ' + escapeHtml(prData.title) + '</div>' +
    '<div style="font-size:13px;color:#6b7280;margin-top:4px">' +
    'Repo: <code>' + escapeHtml(prData.repository) + '</code> | ' +
    '<code>' + escapeHtml(prData.sourceBranch) + '</code> → <code>' + escapeHtml(prData.targetBranch) + '</code></div>';
  document.getElementById('holdReason').value = '';
  openModal('approvalHoldModal');
};

async function doHold() {
  if (!currentPrForAction) return;
  const reason = document.getElementById('holdReason').value.trim();
  if (reason.length < 3) {
    alert('⚠️ กรุณาใส่เหตุผลที่ Hold (อย่างน้อย 3 ตัวอักษร)');
    return;
  }
  setButtonLoading('btnConfirmHold', true, 'Holding...');
  try {
    const r = await safeFetchJson('/api/approval-hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prId: currentPrForAction.id,
        action: 'hold',
        reason: reason
      })
    });
    if (r.parseError || !r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      alert('❌ Hold ไม่สำเร็จ:\n' + (d.error || 'Unknown') + '\n\n' + (d.detail || d.hint || ''));
      return;
    }
    alert('✅ Approval Hold สำเร็จ\n\nPR #' + r.data.prId + '\nLog SharePoint: ' + (r.data.logStatus || '-'));
    closeModal('approvalHoldModal');
    checkPrs();
  } catch (err) {
    alert('❌ Error: ' + err.message);
  } finally {
    setButtonLoading('btnConfirmHold', false);
  }
}

window.releaseApprovalHold = async function(prId) {
  const pr = (window._prCache || {})[prId] || getPrFromTable(prId);
  if (!pr || !isApprovalHeld(pr)) {
    alert('ไม่พบ Approval Hold ของ PR นี้');
    return;
  }
  const ok = confirm('Unlock Approval Hold?\n\nPR #' + pr.id +
    '\nReason: ' + (getHoldReason(pr) || '-') +
    '\n\nหลัง Unlock จะกลับมากด Approve / Reject ได้ตามปกติ');
  if (!ok) return;
  try {
    const r = await safeFetchJson('/api/approval-hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prId: pr.id,
        action: 'release',
        reason: 'Released from Dashboard'
      })
    });
    if (r.parseError || !r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      alert('❌ Unlock ไม่สำเร็จ:\n' + (d.error || 'Unknown') + '\n\n' + (d.detail || d.hint || ''));
      return;
    }
    alert('✅ Unlock สำเร็จ\n\nPR #' + r.data.prId + '\nLog SharePoint: ' + (r.data.logStatus || '-'));
    checkPrs();
  } catch (err) {
    alert('❌ Error: ' + err.message);
  }
};

// ===== History Modal =====
window.openHistoryModal = async function(prId) {
  document.getElementById('historyPrId').textContent = '#' + prId;
  document.getElementById('historyContent').innerHTML = '⏳ Loading log from SharePoint...';
  openModal('historyModal');

  try {
    const r = await safeFetchJson('/api/pr-history/' + prId);
    if (r.parseError || !r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      document.getElementById('historyContent').innerHTML =
        '<div style="color:#dc2626">❌ ' + escapeHtml(d.error || 'Unknown') +
        '<br/><small>' + escapeHtml(d.hint || d.detail || '') + '</small></div>';
      return;
    }
    const items = r.data.items || [];
    if (items.length === 0) {
      document.getElementById('historyContent').innerHTML =
        '<div style="text-align:center;padding:24px;color:#9ca3af">— ยังไม่มี log สำหรับ PR นี้ —</div>';
      return;
    }
    let html = '<div class="history-table-wrap"><table class="history-table"><thead><tr><th>เวลา</th><th>Action</th><th>โดย</th><th>Source</th><th>Result</th><th>Build</th><th>Policy</th><th>Merge</th><th>Reason</th></tr></thead><tbody>';
    for (const it of items) {
      const actionText = String(it.Action || '');
      const actionClass = actionText.includes('Approved') ? 'log-approved' :
                          actionText.includes('Rejected') ? 'log-rejected' :
                          actionText.includes('Hold') ? 'log-hold' : 'log-failed';
      const buildText = [it.Build_Status, it.Build_Result].filter(Boolean).join(' / ') || '-';
      html += '<tr>' +
        '<td>' + formatDate(it.createdAt) + '</td>' +
        '<td><span class="' + actionClass + '">' + escapeHtml(it.Action || '-') + '</span></td>' +
        '<td>' + escapeHtml(it.User || '-') + '</td>' +
        '<td>' + escapeHtml(it.Log_Source || it.Source || 'Dashboard') + '</td>' +
        '<td>' + escapeHtml(it.Result || '-') + '</td>' +
        '<td>' + escapeHtml(buildText) + '</td>' +
        '<td>' + escapeHtml(it.Policy_Status || '-') + '</td>' +
        '<td>' + escapeHtml(it.Merge_Status || '-') + '</td>' +
        '<td>' + escapeHtml(it.Reason || '-') + '</td>' +
        '</tr>';
    }
    html += '</tbody></table></div>';
    document.getElementById('historyContent').innerHTML = html;
  } catch (err) {
    document.getElementById('historyContent').innerHTML =
      '<div style="color:#dc2626">❌ ' + escapeHtml(err.message) + '</div>';
  }
};

// ===== Audit Logs Page =====
async function loadAuditLogs() {
  if (!document.getElementById('logTableBody')) return;
  setButtonLoading('btnSearchLogs', true, 'Searching...');
  showBox('logResult', '⏳ Loading SharePoint log...', 'info');

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

// ===== Test Functions =====
async function testTeams() {
  setButtonLoading('btnTestTeams', true);
  showResult('⏳ Sending test message...', 'info');
  try {
    const r = await safeFetchJson('/api/test-notification', { method: 'POST' });
    if (r.parseError) { showResult('❌ ตอบกลับไม่ใช่ JSON (HTTP ' + r.status + ')', 'error'); return; }
    if (r.ok && r.data && r.data.ok) showResult('✅ ส่งสำเร็จ! ตรวจ Teams channel', 'success');
    else { const d = r.data || {}; showResult('❌ ' + (d.error || 'Unknown'), 'error'); }
  } catch (err) { showResult('❌ ' + err.message, 'error'); }
  finally { setButtonLoading('btnTestTeams', false); }
}

async function testHealth() {
  setButtonLoading('btnTestHealth', true);
  showResult('⏳ Checking...', 'info');
  try {
    const r = await safeFetchJson('/api/health');
    if (r.ok && r.data) {
      const status = r.data.status || 'unknown';
      const checks = Array.isArray(r.data.checks) ? r.data.checks : [];
      const failed = checks.filter(c => c.status === 'error').length;
      const warning = checks.filter(c => c.status === 'warning').length;
      const type = status === 'healthy' ? 'success' : (failed > 0 ? 'error' : 'info');
      showResult('✅ Health checked: ' + escapeHtml(status) +
        ' | checks ' + checks.length +
        ' | warning ' + warning +
        ' | error ' + failed, type);
      renderSystemHealth(r.data);
    } else { showResult('⚠️ HTTP ' + r.status, 'error'); }
  } catch (err) { showResult('❌ ' + err.message, 'error'); }
  finally { setButtonLoading('btnTestHealth', false); }
}

async function testDailySummary() {
  setButtonLoading('btnTestDailySummary', true);
  showResult('⏳ Generating [TEST] Daily Summary...', 'info');
  try {
    const r = await safeFetchJson('/api/test-daily-summary', { method: 'POST' });
    if (r.parseError) { showResult('❌ Response is not JSON (HTTP ' + r.status + ')', 'error'); return; }
    if (r.ok && r.data && r.data.ok) {
      const counts = r.data.summary && r.data.summary.counts || {};
      showResult('✅ [TEST] Daily Summary sent | New PR ' + (counts.createdToday || 0) +
        ' | Completed ' + (counts.completedToday || 0) +
        ' | Failed ' + (counts.failedOrPolicyFailed || 0), 'success');
    } else {
      const d = r.data || {};
      showResult('❌ ' + (d.error || 'Unknown'), 'error');
    }
  } catch (err) { showResult('❌ ' + err.message, 'error'); }
  finally { setButtonLoading('btnTestDailySummary', false); }
}

async function testExceptionScan() {
  setButtonLoading('btnTestExceptionScan', true);
  showResult('⏳ Scanning Build/Policy exceptions from approval logs...', 'info');
  try {
    const r = await safeFetchJson('/api/test-exception-scan', { method: 'POST' });
    if (r.parseError) { showResult('❌ Response is not JSON (HTTP ' + r.status + ')', 'error'); return; }
    if (r.ok && r.data && r.data.ok) {
      showResult('✅ Exception scan completed | PRs ' + (r.data.checkedPrs || 0) +
        ' | Alerts sent ' + (r.data.sent || 0) +
        ' | Skipped ' + (r.data.skipped || 0), 'success');
      checkHealthStatus();
    } else {
      const d = r.data || {};
      showResult('❌ ' + (d.error || d.detail || 'Unknown'), 'error');
    }
  } catch (err) { showResult('❌ ' + err.message, 'error'); }
  finally { setButtonLoading('btnTestExceptionScan', false); }
}

async function checkHealthStatus() {
  const refreshButton = document.getElementById('btnRefreshHealth');
  if (refreshButton) refreshButton.disabled = true;
  try {
    const r = await safeFetchJson('/api/health');
    if (r.ok && r.data) renderSystemHealth(r.data);
    else renderSystemHealthError('HTTP ' + r.status);
  } catch (e) {
    renderSystemHealthError(e.message || 'unreachable');
  } finally {
    if (refreshButton) refreshButton.disabled = false;
  }
}

// ===== Merge PR CI/CD Lookup =====
async function checkMergeLookup() {
  const input = document.getElementById('mergePrId');
  const details = document.getElementById('mergeLookupDetails');
  if (!input || !details) return;

  const prId = (input.value || '').match(/\d+/);
  if (!prId) {
    showBox('mergeResult', 'กรุณากรอกเลข PR เช่น 342520', 'error');
    details.hidden = true;
    return;
  }

  setButtonLoading('btnMergeLookup', true, 'Checking...');
  showBox('mergeResult', '<span>⏳ Checking Azure DevOps...</span>', 'info');
  details.hidden = true;

  try {
    const r = await safeFetchJson('/api/merge-lookup?prId=' + encodeURIComponent(prId[0]));
    if (r.parseError) {
      showBox('mergeResult', 'Backend response is not JSON (HTTP ' + r.status + ')', 'error');
      return;
    }
    if (!r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      showBox('mergeResult', escapeHtml(d.error || 'Lookup failed'), 'error');
      return;
    }

    renderMergeLookup(r.data);
  } catch (err) {
    showBox('mergeResult', escapeHtml(err.message || 'Lookup failed'), 'error');
  } finally {
    setButtonLoading('btnMergeLookup', false);
  }
}

function renderMergeLookup(data) {
  const details = document.getElementById('mergeLookupDetails');
  if (!details) return;
  const pr = data.pr || {};
  const recommended = data.recommended || {};
  const possible = data.possible || {};
  const recommendation = recommended.ciName ? recommended : possible;
  const hasPossible = !recommended.ciName && !!possible.ciName;
  const detected = data.detected && data.detected.ci || null;
  const result = data.result || {};
  const statusClass = {
    matched: 'merge-ok',
    mismatch: 'merge-warn',
    'mapped-only': 'merge-info',
    'detected-only': 'merge-info',
    possible: 'merge-warn',
    'not-found': 'merge-warn'
  }[result.status] || 'merge-info';

  showBox('mergeResult',
    '<strong>' + escapeHtml(result.message || 'Lookup completed') + '</strong>' +
    '<br><small>PR #' + escapeHtml(pr.id || '-') + ' | ' + escapeHtml(pr.repository || '-') + '</small>',
    result.status === 'mismatch' || result.status === 'not-found' ? 'warning' : 'success');

  const prLink = pr.url
    ? '<a href="' + escapeHtml(pr.url) + '" target="_blank" rel="noopener" class="secondary-button merge-small-link">Open PR</a>'
    : '';
  const ciLink = detected && detected.url
    ? '<a href="' + escapeHtml(detected.url) + '" target="_blank" rel="noopener" class="secondary-button merge-small-link">Open Build</a>'
    : '';

  details.hidden = false;
  details.innerHTML =
    '<div class="merge-result-grid">' +
      '<div class="merge-card merge-card-wide">' +
        '<div class="merge-card-label">Pull Request</div>' +
        '<h2>#' + escapeHtml(pr.id || '-') + ' ' + escapeHtml(pr.title || '-') + '</h2>' +
        '<div class="merge-meta-grid">' +
          '<div><span>Repo</span><strong>' + escapeHtml(pr.repository || '-') + '</strong></div>' +
          '<div><span>By</span><strong>' + escapeHtml(pr.createdBy || '-') + '</strong></div>' +
          '<div><span>Status</span><strong>' + escapeHtml(pr.status || '-') + '</strong></div>' +
          '<div><span>Created</span><strong>' + escapeHtml(formatDateTime(pr.creationDate)) + '</strong></div>' +
        '</div>' +
        '<div class="merge-branch-stack">' +
          '<div><span>From</span><code>' + escapeHtml(pr.sourceBranch || '-') + '</code></div>' +
          '<div><span>Into</span><code>' + escapeHtml(pr.targetBranch || '-') + '</code></div>' +
        '</div>' +
        '<div class="merge-actions">' + prLink + '</div>' +
      '</div>' +
      '<div class="merge-card ' + statusClass + '">' +
        '<div class="merge-card-label">' + escapeHtml(hasPossible ? 'Possible CI/CD' : 'Recommended CI/CD') + '</div>' +
        '<h3>' + escapeHtml(hasPossible ? 'Not confirmed - verify before use' : data.mapping && data.mapping.label || 'No mapping rule') + '</h3>' +
        (hasPossible ? '<div class="merge-warning-note"><strong>⚠ Not a confirmed mapping</strong><span>This is only a suggestion from repository-name matching. Please verify CI/CD in Azure DevOps before using it.</span></div>' : '') +
        '<dl class="merge-definition-list">' +
          '<dt>CI</dt><dd>' + escapeHtml(recommendation.ciName || '-') + '</dd>' +
          '<dt>CD</dt><dd>' + escapeHtml(recommendation.cdName || '-') + '</dd>' +
          '<dt>CI ID</dt><dd>' + escapeHtml(recommendation.ciId || '-') + '</dd>' +
          '<dt>CD ID</dt><dd>' + escapeHtml(recommendation.cdId || '-') + '</dd>' +
          '<dt>Source</dt><dd>' + escapeHtml(recommendation.source || '-') + '</dd>' +
          '<dt>Environment</dt><dd>' + escapeHtml(recommendation.environment || data.mapping && data.mapping.environment || '-') + '</dd>' +
          '<dt>Confidence</dt><dd>' + escapeHtml(recommendation.confidence || data.mapping && data.mapping.confidence || '-') + '</dd>' +
          (hasPossible ? '<dt>Reason</dt><dd>' + escapeHtml(possible.note || '-') + '</dd>' : '') +
        '</dl>' +
      '</div>' +
      '<div class="merge-card ' + statusClass + '">' +
        '<div class="merge-card-label">Detected Build</div>' +
        '<h3>' + escapeHtml(detected && detected.name || 'No build run detected') + '</h3>' +
        '<dl class="merge-definition-list">' +
          '<dt>Run</dt><dd>' + escapeHtml(detected && detected.id || '-') + '</dd>' +
          '<dt>Status</dt><dd>' + escapeHtml(formatBuildRunState(detected)) + '</dd>' +
          '<dt>Branch</dt><dd>' + escapeHtml(detected && detected.branch || '-') + '</dd>' +
          '<dt>Finished</dt><dd>' + escapeHtml(formatDateTime(detected && detected.finishTime)) + '</dd>' +
        '</dl>' +
        '<div class="merge-actions">' + ciLink + '</div>' +
      '</div>' +
    '</div>';
}

function formatBuildRunState(build) {
  if (!build) return '-';
  const result = build.result ? String(build.result) : '';
  const status = build.status ? String(build.status) : '';
  if (result) return status ? status + ' / ' + result : result;
  return status || '-';
}

function saveLastSync(data) {
  try {
    const previous = getLastSync() || {};
    const activityIncluded = data && data.approvedLookback && data.approvedLookback.source !== 'Skipped';
    const payload = {
      at: data && data.fetchedAt || new Date().toISOString(),
      count: data && data.count,
      totalActive: data && data.totalActive,
      completedCount: activityIncluded && Array.isArray(data && data.completedPrs) ? data.completedPrs.length : previous.completedCount,
      completedTotalMatched: activityIncluded ? data && data.completedTotalMatched : previous.completedTotalMatched,
      recentlyApprovedCount: activityIncluded ? data && data.completedTotalMatched : previous.recentlyApprovedCount,
      reviewerGroup: data && data.reviewerGroup,
      targetBranch: data && data.targetBranch
    };
    localStorage.setItem('adoDashboardLastSync', JSON.stringify(payload));
  } catch (e) {}
}

function getLastSync() {
  try {
    return JSON.parse(localStorage.getItem('adoDashboardLastSync') || 'null');
  } catch (e) {
    return null;
  }
}

function renderSystemHealth(data) {
  const grid = document.getElementById('systemHealthGrid');
  const summary = document.getElementById('systemHealthSummary');
  if (!grid && !summary) return;

  const cards = [];
  cards.push(buildHealthCard({
    key: 'auth',
    label: 'Auth',
    status: 'ok',
    message: 'O365 Login OK'
  }));

  const checks = Array.isArray(data.checks) ? data.checks : [];
  for (const check of checks) cards.push(buildHealthCard(check));

  const lastSync = getLastSync();
  cards.push(buildHealthCard({
    key: 'last-sync',
    label: 'Last Sync',
    status: lastSync && lastSync.at ? 'ok' : 'warning',
    message: lastSync && lastSync.at
      ? formatDate(lastSync.at)
      : 'No refresh in this browser yet',
    detail: lastSync && lastSync.at ? {
      pendingPrs: lastSync.count,
      totalActive: lastSync.totalActive,
      approvedLast24h: lastSync.recentlyApprovedCount || lastSync.completedTotalMatched || lastSync.completedCount,
      reviewerGroup: lastSync.reviewerGroup
    } : {}
  }));

  const lastNotification = data.lastNotification || null;
  cards.push(buildHealthCard({
    key: 'last-notification',
    label: 'Last Notification',
    status: lastNotification && lastNotification.at ? 'ok' : 'warning',
    message: lastNotification && lastNotification.at
      ? formatDate(lastNotification.at)
      : 'ยังไม่พบ notification log',
    detail: lastNotification ? {
      source: lastNotification.source,
      result: lastNotification.result,
      title: lastNotification.title
    } : {}
  }));

  const lastExceptionScan = data.lastExceptionScan || null;
  const exceptionScanStatus = getExceptionScanHealthStatus(lastExceptionScan);
  cards.push(buildHealthCard({
    key: 'last-exception-scan',
    label: 'Last Exception Scan',
    status: exceptionScanStatus,
    message: lastExceptionScan && lastExceptionScan.at
      ? formatDate(lastExceptionScan.at)
      : 'ยังไม่พบ exception scan log',
    detail: lastExceptionScan ? {
      result: lastExceptionScan.result,
      checkedPrs: lastExceptionScan.checkedPrs,
      alertsSent: lastExceptionScan.sent,
      skipped: lastExceptionScan.skipped
    } : {}
  }));

  const lastRetentionCleanup = data.lastRetentionCleanup || null;
  const retentionCleanupStatus = getRetentionCleanupHealthStatus(lastRetentionCleanup);
  cards.push(buildHealthCard({
    key: 'last-retention-cleanup',
    label: 'Last Retention Cleanup',
    status: retentionCleanupStatus,
    message: lastRetentionCleanup && lastRetentionCleanup.at
      ? formatDate(lastRetentionCleanup.at)
      : 'ยังไม่พบ retention cleanup log',
    detail: lastRetentionCleanup ? {
      result: lastRetentionCleanup.result,
      archived: lastRetentionCleanup.archived,
      deleted: lastRetentionCleanup.deleted,
      retentionDays: lastRetentionCleanup.retentionDays
    } : {}
  }));

  const nextRun = data.schedule && data.schedule.dailySummary && data.schedule.dailySummary.nextRunAt;
  cards.push(buildHealthCard({
    key: 'next-summary',
    label: 'Next Summary',
    status: data.schedule && data.schedule.dailySummary && data.schedule.dailySummary.enabled ? 'ok' : 'warning',
    message: nextRun ? formatDate(nextRun) : 'Daily summary schedule not ready',
    detail: { schedule: '18:00 Asia/Bangkok' }
  }));

  if (grid) grid.innerHTML = cards.join('');
  if (summary) summary.innerHTML = buildHealthSummary(data);
}

function renderSystemHealthError(message) {
  const grid = document.getElementById('systemHealthGrid');
  const summary = document.getElementById('systemHealthSummary');
  const errorCard = buildHealthCard({
    key: 'system-health',
    label: 'System Health',
    status: 'error',
    message: message || 'unreachable'
  });
  if (grid) grid.innerHTML = errorCard;
  if (summary) summary.innerHTML = errorCard;
}

function buildHealthSummary(data) {
  const status = data && data.status || 'warning';
  const checks = Array.isArray(data && data.checks) ? data.checks : [];
  const errorCount = checks.filter(c => c.status === 'error').length;
  const warningCount = checks.filter(c => c.status === 'warning').length;
  const lastSync = getLastSync();
  const lastNotification = data && data.lastNotification;
  const cls = status === 'healthy' ? 'status-ok' : (errorCount > 0 ? 'status-error' : 'status-pending');
  const icon = status === 'healthy' ? '✅' : (errorCount > 0 ? '❌' : '⚠️');
  const statusLabel = status === 'healthy' ? 'Healthy' : (errorCount > 0 ? 'Degraded' : 'Warning');
  const detail = [
    '<span><strong>Checks:</strong> ' + checks.length + ' total, ' + warningCount + ' warning, ' + errorCount + ' error</span>',
    '<span><strong>Last Sync:</strong> ' + escapeHtml(lastSync && lastSync.at ? formatDate(lastSync.at) : '-') + '</span>',
    '<span><strong>Last Notification:</strong> ' + escapeHtml(lastNotification && lastNotification.at ? formatDate(lastNotification.at) : '-') + '</span>'
  ].join('');

  return '<div class="status-card ' + cls + ' health-summary-card">' +
    '<div class="status-icon">' + icon + '</div>' +
    '<div class="status-text">' +
      '<div class="status-title">System Health: ' + escapeHtml(statusLabel) + '</div>' +
      '<div class="status-desc">ระบบหลักพร้อมใช้งานสำหรับ Dashboard</div>' +
      '<div class="status-detail-list">' + detail + '</div>' +
    '</div>' +
  '</div>';
}

function getExceptionScanHealthStatus(scan) {
  if (!scan || !scan.at) return 'warning';
  const result = String(scan.result || '').toLowerCase();
  const reason = String(scan.reason || '').toLowerCase();
  if (result.includes('error') || reason.includes('error')) return 'error';
  if (result.includes('warn')) return 'warning';
  return 'ok';
}

function getRetentionCleanupHealthStatus(cleanup) {
  if (!cleanup || !cleanup.at) return 'warning';
  const result = String(cleanup.result || '').toLowerCase();
  const reason = String(cleanup.reason || '').toLowerCase();
  if (result.includes('error') || result.includes('fail') || reason.includes('failed')) return 'error';
  if (result.includes('warn') || reason.includes('delete errors')) return 'warning';
  return 'ok';
}

function buildHealthCard(item) {
  const status = item && item.status || 'warning';
  const cls = status === 'ok' ? 'status-ok' : (status === 'error' ? 'status-error' : 'status-pending');
  const icon = status === 'ok' ? '✅' : (status === 'error' ? '❌' : '⚠️');
  const detail = formatHealthDetail(item && item.detail);
  const duration = Number.isFinite(Number(item && item.durationMs))
    ? '<span class="status-chip">' + Number(item.durationMs) + ' ms</span>'
    : '';
  return '<div class="status-card ' + cls + '">' +
    '<div class="status-icon">' + icon + '</div>' +
    '<div class="status-text">' +
      '<div class="status-title">' + escapeHtml(item && item.label || '-') + duration + '</div>' +
      '<div class="status-desc">' + escapeHtml(item && item.message || '-') + '</div>' +
      detail +
    '</div>' +
  '</div>';
}

function formatHealthDetail(detail) {
  if (!detail || typeof detail !== 'object') return '';
  const pairs = Object.entries(detail)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 4);
  if (pairs.length === 0) return '';
  return '<div class="status-detail-list">' + pairs.map(([key, value]) =>
    '<span><strong>' + escapeHtml(humanizeKey(key)) + ':</strong> ' + escapeHtml(String(value)) + '</span>'
  ).join('') + '</div>';
}

function humanizeKey(key) {
  return String(key || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, ch => ch.toUpperCase());
}

// ============================================
// Guarded Auto Approve Frontend Controller
// ============================================
window._autoMode = 'normal';
window._selectedDuration = '60';
window._autoPollerInterval = null;
window._autoCountdownInterval = null;
window._autoPrApprovedCount = 0;
window._autoReleaseApprovedCount = 0;
window._processingAutoApprovals = {};

async function initAutoApprove() {
  const panel = document.getElementById('autoApprovePanel');
  if (!panel) return;

  const canApprove = window._currentUser && window._currentUser.canApprovePrs === true;
  if (!canApprove) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;

  try {
    const r = await safeFetchJson('/api/auto-approve-settings');
    if (r.ok && r.data && r.data.ok) {
      const settings = r.data;
      window._autoMode = settings.autoMode || 'normal';
      
      updateModeButtonsUI(window._autoMode);

      if (window._autoMode !== 'normal') {
        if (window._autoMode === 'active') {
          window._autoPrApprovedCount = parseInt(sessionStorage.getItem('autoPrApprovedCount'), 10) || 0;
          window._autoReleaseApprovedCount = parseInt(sessionStorage.getItem('autoReleaseApprovedCount'), 10) || 0;
          updateStatsUI();
        }
        
        startAutoPoller();
        startCountdown(settings.expiryTime, settings.enabledBy);
      }
    }
  } catch (e) {
    writeToAutoConsole('Failed to initialize Auto settings: ' + e.message, 'error');
  }
}

function updateModeButtonsUI(mode) {
  const btnNormal = document.getElementById('btnModeNormal');
  const btnDryRun = document.getElementById('btnModeDryRun');
  const btnActive = document.getElementById('btnModeActive');
  
  if (btnNormal) {
    if (mode === 'normal') btnNormal.classList.add('active');
    else btnNormal.classList.remove('active');
  }
  if (btnDryRun) {
    if (mode === 'dry-run') btnDryRun.classList.add('active');
    else btnDryRun.classList.remove('active');
  }
  if (btnActive) {
    if (mode === 'active') btnActive.classList.add('active');
    else btnActive.classList.remove('active');
  }

  const indicator = document.getElementById('autoStatusIndicator');
  if (indicator) {
    indicator.className = 'auto-status-indicator';
    if (mode === 'normal') {
      indicator.classList.add('indicator-normal');
      indicator.textContent = 'OFF';
    } else if (mode === 'dry-run') {
      indicator.classList.add('indicator-dryrun');
      indicator.textContent = 'ACTIVE (Manual)';
    } else {
      indicator.classList.add('indicator-active');
      indicator.textContent = 'ACTIVE (Auto-Approve)';
    }
  }

  const durationGroup = document.getElementById('autoDurationGroup');
  if (durationGroup) {
    durationGroup.style.display = mode === 'normal' ? 'none' : 'flex';
  }

  const consoleWrap = document.getElementById('autoConsoleWrap');
  if (consoleWrap) {
    consoleWrap.hidden = mode === 'normal';
  }

  const statsWrap = document.getElementById('autoSessionStats');
  if (statsWrap) {
    statsWrap.hidden = mode !== 'active';
  }
}

window.selectDuration = function(duration) {
  window._selectedDuration = duration;
  
  const buttons = ['60', 'end_of_day'];
  buttons.forEach(b => {
    const id = b === 'end_of_day' ? 'btnDurationEndDay' : 'btnDuration' + b;
    const el = document.getElementById(id);
    if (el) {
      if (b === duration) el.classList.add('active');
      else el.classList.remove('active');
    }
  });

  if (window._autoMode && window._autoMode !== 'normal') {
    changeAutoMode(window._autoMode);
  }
}

window.changeAutoMode = async function(mode) {
  const prevMode = window._autoMode;
  window._autoMode = mode;
  updateModeButtonsUI(mode);

  try {
    const r = await safeFetchJson('/api/auto-approve-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        autoMode: mode,
        durationMinutes: window._selectedDuration || '60'
      })
    });

    if (!r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      throw new Error(d.error || 'Failed to update backend settings');
    }

    const data = r.data;
    if (mode === 'normal') {
      stopAutoPoller();
      stopCountdown();
      writeToAutoConsole('Auto Approve Mode has been disabled.', 'info');
      
      sessionStorage.removeItem('autoPrApprovedCount');
      sessionStorage.removeItem('autoReleaseApprovedCount');
      window._autoPrApprovedCount = 0;
      window._autoReleaseApprovedCount = 0;
    } else {
      if (mode === 'active') {
        window._autoPrApprovedCount = 0;
        window._autoReleaseApprovedCount = 0;
        sessionStorage.setItem('autoPrApprovedCount', 0);
        sessionStorage.setItem('autoReleaseApprovedCount', 0);
        updateStatsUI();
      }
      
      startAutoPoller();
      startCountdown(data.expiryTime, data.enabledBy);
      
      const label = mode === 'active' ? 'ACTIVE (Auto-Approve)' : 'ACTIVE (Manual)';
      writeToAutoConsole('เปิดใช้งานโหมด ' + label + ' สำเร็จ โดย ' + data.enabledBy, 'info');
      
      checkPrs(true);
    }
  } catch (e) {
    window._autoMode = prevMode;
    updateModeButtonsUI(prevMode);
    alert('❌ ตั้งค่าไม่สำเร็จ: ' + e.message);
    writeToAutoConsole('Error setting auto mode: ' + e.message, 'error');
  }
}

function startAutoPoller() {
  stopAutoPoller();
  window._autoPollerInterval = setInterval(() => {
    writeToAutoConsole('Running automatic scan...', 'info');
    checkPrs(true);
  }, 60000);
}

function stopAutoPoller() {
  if (window._autoPollerInterval) {
    clearInterval(window._autoPollerInterval);
    window._autoPollerInterval = null;
  }
}

function startCountdown(expiryIso, userEmail) {
  stopCountdown();
  const wrap = document.getElementById('autoCountdownWrap');
  if (!wrap) return;

  wrap.hidden = false;
  const timerEl = document.getElementById('autoCountdownTimer');
  const userEl = document.getElementById('autoCountdownUser');
  if (userEl) userEl.textContent = 'Enabled by: ' + (userEmail || 'Unknown');

  const expiryTime = new Date(expiryIso).getTime();

  function updateTimer() {
    const now = new Date().getTime();
    const diff = expiryTime - now;

    if (diff <= 0) {
      stopCountdown();
      timerEl.textContent = '00:00';
      writeToAutoConsole('โหมด Auto Approve หมดระยะเวลาควบคุมแล้ว', 'error');
      handleAutoExpiry();
      return;
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    const pad = (num) => String(num).padStart(2, '0');
    
    if (hours > 0) {
      timerEl.textContent = pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
    } else {
      timerEl.textContent = pad(minutes) + ':' + pad(seconds);
    }
  }

  updateTimer();
  window._autoCountdownInterval = setInterval(updateTimer, 1000);
}

function stopCountdown() {
  if (window._autoCountdownInterval) {
    clearInterval(window._autoCountdownInterval);
    window._autoCountdownInterval = null;
  }
  const wrap = document.getElementById('autoCountdownWrap');
  if (wrap) wrap.hidden = true;
  const timerEl = document.getElementById('autoCountdownTimer');
  if (timerEl) timerEl.textContent = '00:00';
  const userEl = document.getElementById('autoCountdownUser');
  if (userEl) userEl.textContent = '';
}

async function handleAutoExpiry() {
  window._autoMode = 'normal';
  updateModeButtonsUI('normal');
  stopAutoPoller();
  stopCountdown();
  
  sessionStorage.removeItem('autoPrApprovedCount');
  sessionStorage.removeItem('autoReleaseApprovedCount');
  window._autoPrApprovedCount = 0;
  window._autoReleaseApprovedCount = 0;

  alert('🧡 โหมด Auto Approve หมดระยะเวลาการควบคุม และสลับกลับเข้าสู่โหมดปกติ (Manual) แล้ว');
  checkPrs(false);
}

function updateStatsUI() {
  const prEl = document.getElementById('autoPrCount');
  const relEl = document.getElementById('autoReleaseCount');
  if (prEl) prEl.textContent = window._autoPrApprovedCount;
  if (relEl) relEl.textContent = window._autoReleaseApprovedCount;
}

function writeToAutoConsole(message, type) {
  const consoleLog = document.getElementById('autoConsoleLog');
  if (!consoleLog) return;

  const placeholder = consoleLog.querySelector('.console-placeholder');
  if (placeholder) placeholder.remove();

  const now = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = document.createElement('div');
  entry.className = 'console-entry';
  
  if (type === 'active') {
    entry.className += ' entry-active';
    entry.textContent = `[${now}] 🟢 [Active] ${message}`;
  } else if (type === 'dryrun') {
    entry.className += ' entry-dryrun';
    entry.textContent = `[${now}] 🟡 [Dry-Run] ${message}`;
  } else if (type === 'error') {
    entry.className += ' entry-error';
    entry.textContent = `[${now}] 🔴 [Error] ${message}`;
  } else {
    entry.textContent = `[${now}] 🔵 [Info] ${message}`;
  }

  consoleLog.appendChild(entry);
  consoleLog.scrollTop = consoleLog.scrollHeight;
}

window.clearAutoConsole = function() {
  const consoleLog = document.getElementById('autoConsoleLog');
  if (!consoleLog) return;
  consoleLog.innerHTML = '<div class="console-placeholder">ไม่มีประวัติการสแกนในเซสชันนี้</div>';
}

async function evaluateAutoApprovals(prs) {
  if (!window._autoMode || window._autoMode === 'normal') return;
  const list = Array.isArray(prs) ? prs : [];

  const eligiblePrs = list.filter(pr => {
    if (typeof pr.id === 'string' && pr.id.startsWith('R')) return false;
    
    const targetRef = String(pr.targetBranch || '').toLowerCase();
    const isStaging = targetRef.startsWith('refs/heads/staging');
    
    const isDraft = pr.isDraft === true;
    const isMergeCode = pr.isMergeCodeTarget === true;
    const hasHold = pr.approvalHold && pr.approvalHold.active === true;
    const notVotedYet = pr.myApproval && pr.myApproval.status === 'not-approved';
    
    const snapshot = pr.statusSnapshot || {};
    const buildResult = String(snapshot.buildResult || 'unknown').toLowerCase();
    const buildStatus = String(snapshot.buildStatus || 'unknown').toLowerCase();
    
    const hasBuild = buildResult && buildResult !== 'unknown' && buildResult !== 'no_status';
    const buildSuccess = !hasBuild || buildResult === 'succeeded' || buildStatus === 'succeeded';
    
    const policyStatus = String(snapshot.policyStatus || 'unknown').toLowerCase();
    const policyOk = policyStatus === 'approved' || policyStatus === 'pending';

    return isStaging && !isDraft && !isMergeCode && !hasHold && notVotedYet && buildSuccess && policyOk;
  });

  const eligibleReleases = list.filter(pr => {
    const r = pr.releaseApproval || {};
    const hasPendingRelease = r.status === 'pending' && r.approvalId;
    if (!hasPendingRelease) return false;

    const definitionName = String(r.releaseDefinitionName || r.cdName || '').toLowerCase().trim();
    if (!definitionName.startsWith('stg')) return false;

    const hasHold = pr.approvalHold && pr.approvalHold.active === true;
    return !hasHold;
  });

  if (window._autoMode === 'dry-run') {
    if (eligiblePrs.length === 0 && eligibleReleases.length === 0) {
      writeToAutoConsole('ผลสแกน: ไม่พบ PR หรือ Release ที่รออนุมัติและผ่านเกณฑ์การตรวจสอบ', 'info');
      return;
    }
    
    eligiblePrs.forEach(pr => {
      writeToAutoConsole(`PR #${pr.id} - ผ่านเกณฑ์การตรวจวิเคราะห์ (พร้อมส่ง Approve PR)`, 'dryrun');
    });
    
    eligibleReleases.forEach(pr => {
      const r = pr.releaseApproval || {};
      const idLabel = typeof pr.id === 'string' && pr.id.startsWith('R') ? 'Virtual Release ' + pr.id : 'PR #' + pr.id;
      writeToAutoConsole(`${idLabel} (Release: ${r.releaseName}) - ผ่านเกณฑ์การตรวจวิเคราะห์ (พร้อมส่ง Approve Release)`, 'dryrun');
    });
    return;
  }

  if (window._autoMode === 'active') {
    if (eligiblePrs.length === 0 && eligibleReleases.length === 0) {
      writeToAutoConsole('ผลสแกน: ไม่พบ PR หรือ Release ที่รออนุมัติและผ่านเกณฑ์การตรวจสอบ', 'info');
      return;
    }
    for (const pr of eligiblePrs) {
      if (window._processingAutoApprovals[pr.id]) continue;
      window._processingAutoApprovals[pr.id] = true;
      
      writeToAutoConsole(`กำลังดำเนินการอนุมัติ PR #${pr.id} อัตโนมัติ...`, 'info');
      try {
        const response = await safeFetchJson('/api/approve-pr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prId: pr.id,
            repositoryId: pr.repositoryId,
            autoApproved: true
          })
        });

        if (response.ok && response.data && response.data.ok) {
          window._autoPrApprovedCount += 1;
          sessionStorage.setItem('autoPrApprovedCount', window._autoPrApprovedCount);
          updateStatsUI();
          writeToAutoConsole(`PR #${pr.id} - อนุมัติสำเร็จ! (Auto-Complete: ${response.data.autoComplete ? 'เปิดใช้งาน' : 'ข้าม'})`, 'active');
        } else {
          const d = response.data || {};
          writeToAutoConsole(`PR #${pr.id} - อนุมัติไม่สำเร็จ: ${d.error || 'Unknown error'}`, 'error');
        }
      } catch (e) {
        writeToAutoConsole(`PR #${pr.id} - Exception: ${e.message}`, 'error');
      } finally {
        delete window._processingAutoApprovals[pr.id];
      }
    }

    for (const pr of eligibleReleases) {
      const r = pr.releaseApproval || {};
      const lockKey = 'rel_' + r.approvalId;
      if (window._processingAutoApprovals[lockKey]) continue;
      window._processingAutoApprovals[lockKey] = true;

      const idLabel = typeof pr.id === 'string' && pr.id.startsWith('R') ? 'Virtual Release ' + pr.id : 'PR #' + pr.id;
      writeToAutoConsole(`กำลังดำเนินการอนุมัติ Release อัตโนมัติ สำหรับ ${idLabel} (Release ID: ${r.releaseId})...`, 'info');
      
      try {
        const response = await safeFetchJson('/api/approve-release', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prId: typeof pr.id === 'string' && pr.id.startsWith('R') ? 0 : parseInt(pr.id, 10),
            repository: pr.repository || '',
            prTitle: pr.title || '',
            releaseId: r.releaseId,
            approvalId: r.approvalId,
            releaseName: r.releaseName,
            environmentName: r.environmentName,
            releaseUrl: r.releaseUrl
          })
        });

        if (response.ok && response.data && response.data.ok) {
          window._autoReleaseApprovedCount += 1;
          sessionStorage.setItem('autoReleaseApprovedCount', window._autoReleaseApprovedCount);
          updateStatsUI();
          writeToAutoConsole(`${idLabel} (Release: ${r.releaseName}) - อนุมัติและปล่อย Release สำเร็จ!`, 'active');
        } else {
          const d = response.data || {};
          writeToAutoConsole(`${idLabel} (Release: ${r.releaseName}) - อนุมัติปล่อย Release ไม่สำเร็จ: ${d.error || 'Unknown error'}`, 'error');
        }
      } catch (e) {
        writeToAutoConsole(`${idLabel} (Release: ${r.releaseName}) - Exception: ${e.message}`, 'error');
      } finally {
        delete window._processingAutoApprovals[lockKey];
      }
    }
  }
}
