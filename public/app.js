// ============================================
// ADO Auto-Approve - Dashboard Script (Phase 3.1)
// ============================================

let currentPrForAction = null;
window._prCache = {};
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

    await checkHealthStatus();

    bind('btnCheckPrs', checkPrs);
    bind('btnTestTeams', testTeams);
    bind('btnTestDailySummary', testDailySummary);
    bind('btnTestHealth', testHealth);
    bind('btnRefreshHealth', checkHealthStatus);
    bind('btnMergeLookup', checkMergeLookup);
    bind('btnSearchLogs', loadAuditLogs);
    bind('btnClearLogFilters', clearAuditLogFilters);
    bind('btnConfirmApprove', doApprove);
    bind('btnConfirmReject', doReject);

    document.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', () => closeModal(el.getAttribute('data-close')));
    });
    document.querySelectorAll('.modal-backdrop').forEach(bd => {
      bd.addEventListener('click', (e) => {
        if (e.target === bd) closeModal(bd.id);
      });
    });

    if (document.getElementById('btnCheckPrs')) checkPrs();
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

// ===== Check PRs =====
async function checkPrs() {
  if (!document.getElementById('prTableContainer')) return;
  setButtonLoading('btnCheckPrs', true, 'Loading...');
  document.getElementById('prTableContainer').hidden = true;
  showBox('prResult', '<div class="test-result result-info">⏳ Calling ADO API...</div>');

  try {
    const r = await safeFetchJson('/api/list-prs');
    if (r.parseError) {
      showBox('prResult', '<div class="test-result result-error">❌ Backend ตอบไม่ใช่ JSON (HTTP ' + r.status + ')</div>');
      return;
    }
    if (!r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      showBox('prResult', '<div class="test-result result-error">❌ ' + escapeHtml(d.error || 'Unknown') +
        '<br/><small>' + escapeHtml(d.hint || d.detail || '') + '</small></div>');
      return;
    }
    const d = r.data;
    saveLastSync(d);
    const mergeCodeCount = (d.prs || []).filter(isMergeCodePr).length;
    const attention = d.attentionSummary || {};
    showBox('prResult', renderPrSummaryBanner(d, attention, mergeCodeCount));
    renderPrTable(d.prs);
    renderCompletedPrTable(
      d.completedPrs || [],
      d.completedLookbackHours || 24,
      d.completedTotalMatched,
      d.completedDisplayLimit || 10
    );
    checkHealthStatus();
    document.getElementById('prTableContainer').hidden = false;
  } catch (err) {
    showBox('prResult', '<div class="test-result result-error">❌ ' + escapeHtml(err.message) + '</div>');
  } finally {
    resetCheckPrsButton();
  }
}

function renderPrSummaryBanner(d, attention, mergeCodeCount) {
  const attentionText = 'Attention: Critical ' + (attention.critical || 0) +
    ' | Warning ' + (attention.warning || 0) +
    ' | Stale ' + (attention.stale || 0);
  const chips = [
    'Reviewer: ' + escapeHtml(d.reviewerGroup),
    'Fetched: ' + new Date(d.fetchedAt).toLocaleString('th-TH'),
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
  document.getElementById('prMeta').textContent = prs.length + ' items';
  const tbody = document.getElementById('prTableBody');
  tbody.innerHTML = '';
  window._prCache = {};

  if (prs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:#9ca3af">— No PR waiting approve right now —</td></tr>';
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

    window._prCache[pr.id] = {
      id: pr.id,
      title: pr.title,
      repository: pr.repository,
      reviewers: pr.reviewers || [],
      approval: pr.approval || {},
      myApproval: pr.myApproval || {},
      statusSnapshot: pr.statusSnapshot || {},
      attention: pr.attention || {},
      policyFetched: pr.policyFetched === true,
      isMergeCodeTarget: isMergeCodePr(pr)
    };
    tbody.appendChild(tr);
  }
}

function renderCompletedPrTable(prs, lookbackHours, totalMatched, displayLimit) {
  const section = document.getElementById('completedSection');
  const meta = document.getElementById('completedMeta');
  const tbody = document.getElementById('completedTableBody');
  const pager = document.getElementById('completedPager');
  if (!section || !meta || !tbody) return;

  if (!Array.isArray(prs) || prs.length === 0) {
    section.hidden = false;
    const total = Number.isFinite(Number(totalMatched)) ? Number(totalMatched) : 0;
    meta.textContent = 'Last ' + lookbackHours + ' hours | showing 0 of ' + total + ' PRs approved';
    tbody.innerHTML = '';
    if (pager) {
      pager.hidden = true;
      pager.innerHTML = '';
    }
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:22px;color:#9ca3af">— No approved PRs found in the last ' + escapeHtml(lookbackHours) + ' hours —</td></tr>';
    return;
  }

  section.hidden = false;
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
    meta.textContent = 'Last ' + lookbackHours + ' hours | showing 0 of 0 PRs approved';
    tbody.innerHTML = '';
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
  meta.textContent = 'Last ' + lookbackHours + ' hours | showing ' + (start + 1) + '-' + end + ' of ' + total + ' PRs approved';

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

  for (const pr of pageRows) {
    const tr = document.createElement('tr');
    const statusBadge = renderRecentlyApprovedStatusBadge(pr);
    const approvedAt = pr.approvedAt || pr.closedDate || pr.creationDate;
    const actionsHtml = renderCompletedActions(pr);
    tr.innerHTML =
      '<td class="pr-id-cell">' + renderPrIdInline(pr, 'approved') + '</td>' +
      '<td class="pr-title-cell"><span class="pr-title-text">' + escapeHtml(pr.title) + '</span></td>' +
      '<td class="pr-by-cell">' + escapeHtml(pr.createdBy || '-') + '</td>' +
      '<td class="pr-branch-cell">' + renderBranchCell(pr) + '</td>' +
      '<td class="pr-status-cell">' + statusBadge + '</td>' +
      '<td class="pr-repo-cell">' + escapeHtml(pr.repository || '-') + '</td>' +
      '<td class="pr-created-cell">' + formatDate(approvedAt) + '</td>' +
      '<td class="pr-actions-cell">' + actionsHtml + '</td>';
    tbody.appendChild(tr);
  }
}

window.changeRecentlyApprovedPage = function(delta) {
  const page = Number(window._recentlyApprovedPage) || 0;
  window._recentlyApprovedPage = page + delta;
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
  return '<span class="pr-id-wrap" title="' + escapeHtml(marker.title) + '">' +
    '<span class="pr-state-prefix ' + marker.className + '" aria-label="' + escapeHtml(marker.title) + '">' + marker.icon + '</span>' +
    '<strong class="pr-summary-id">#' + escapeHtml(pr.id) + '</strong>' +
    '</span>';
}

function getPrStateMarker(pr, mode) {
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
      '<button class="btn-mini btn-history" onclick="openHistoryModal(' + pr.id + ')">📜</button>' +
      '<a class="' + openClass + '" href="' + openUrl + '"' + openAttrs + '>🔗 Open ADO</a>' +
      '</div>';
  }

  if (!canApprovePrs) {
    return '<div class="action-cell">' +
      '<button class="btn-mini btn-history" onclick="openHistoryModal(' + pr.id + ')">📜</button>' +
      '<a class="' + openClass + '" href="' + openUrl + '"' + openAttrs + '>🔗</a>' +
      '</div>';
  }

  const myStatus = pr.myApproval && pr.myApproval.status ? String(pr.myApproval.status).toLowerCase() : '';
  if (['approved', 'suggestions', 'rejected', 'waiting-author'].includes(myStatus)) {
    return '<div class="action-cell">' +
      '<span class="action-note">Vote submitted</span>' +
      '<button class="btn-mini btn-history" onclick="openHistoryModal(' + pr.id + ')">📜</button>' +
      '<a class="' + openClass + '" href="' + openUrl + '"' + openAttrs + '>🔗</a>' +
      '</div>';
  }

  return '<div class="action-cell">' +
    '<button class="btn-mini btn-approve" onclick="openApproveModal(' + pr.id + ', \'' + pr.repositoryId + '\')">✅ Approve</button>' +
    '<button class="btn-mini btn-reject" onclick="openRejectModal(' + pr.id + ', \'' + pr.repositoryId + '\')">❌ Reject</button>' +
    '<button class="btn-mini btn-history" onclick="openHistoryModal(' + pr.id + ')">📜</button>' +
    '<a class="' + openClass + '" href="' + openUrl + '"' + openAttrs + '>🔗</a>' +
    '</div>';
}

function renderCompletedActions(pr) {
  const openUrl = pr.url ? escapeHtml(pr.url) : '#';
  const openAttrs = pr.url ? ' target="_blank" rel="noopener"' : ' aria-disabled="true" tabindex="-1"';
  const openClass = pr.url ? 'btn-mini btn-open' : 'btn-mini btn-open btn-disabled';
  return '<div class="action-cell">' +
    '<button class="btn-mini btn-history" onclick="openHistoryModal(' + pr.id + ')">📜</button>' +
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
  return '<button class="' + cls + '" onclick="openReviewersModal(' + pr.id + ')" title="คลิกดูรายชื่อ reviewers">' +
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

// ===== Approve Modal =====
window.openApproveModal = function(prId, repositoryId) {
  const rows = document.querySelectorAll('#prTableBody tr');
  let prData = null;
  rows.forEach(r => {
    if (r.dataset.pr) {
      const p = JSON.parse(r.dataset.pr);
      if (p.id === prId) prData = p;
    }
  });
  if (!prData) return;
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

// ===== Reject Modal =====
window.openRejectModal = function(prId, repositoryId) {
  const rows = document.querySelectorAll('#prTableBody tr');
  let prData = null;
  rows.forEach(r => {
    if (r.dataset.pr) {
      const p = JSON.parse(r.dataset.pr);
      if (p.id === prId) prData = p;
    }
  });
  if (!prData) return;
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
                          actionText.includes('Rejected') ? 'log-rejected' : 'log-failed';
      const buildText = [it.Build_Status, it.Build_Result].filter(Boolean).join(' / ') || '-';
      html += '<tr>' +
        '<td>' + formatDate(it.createdAt) + '</td>' +
        '<td><span class="' + actionClass + '">' + escapeHtml(it.Action || '-') + '</span></td>' +
        '<td>' + escapeHtml(it.User || '-') + '</td>' +
        '<td>' + escapeHtml(it.Source || 'Dashboard') + '</td>' +
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
    const payload = {
      at: data && data.fetchedAt || new Date().toISOString(),
      count: data && data.count,
      totalActive: data && data.totalActive,
      completedCount: Array.isArray(data && data.completedPrs) ? data.completedPrs.length : 0,
      completedTotalMatched: data && data.completedTotalMatched,
      recentlyApprovedCount: data && data.completedTotalMatched,
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
