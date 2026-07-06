// ============================================
// ADO Auto-Approve - Dashboard Script (Phase 3.1)
// ============================================



window._prCache = {};
window._activeTab = 'pr';
try {
  const savedTab = sessionStorage.getItem('activeDashboardTab');
  if (savedTab === 'pr' || savedTab === 'release') window._activeTab = savedTab;
} catch (e) {}
window._currentUser = {
  roles: [],
  requiredRole: 'it_support_approve',
  canApprovePrs: false,
  canManageAppServices: false
};

function getUserEmailForDisplay(user, fallback) {
  const source = user || {};
  return String(source.email || source.userDetails || fallback || 'Authorized User').trim() || 'Authorized User';
}

async function initPage() {
  try {
    const authResp = await fetch('/.auth/me');
    const authData = await authResp.json();
    if (!authData.clientPrincipal) {
      window.location.href = '/';
      return;
    }
    const principal = authData.clientPrincipal;
    setText('userName', getUserEmailForDisplay(principal, 'Unknown'));
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
        }
        setText('userName', getUserEmailForDisplay(userData, principal.userDetails));
        if (userData.email) setText('userEmail', userData.email);
        const roles = Array.isArray(userData.userRoles) ? userData.userRoles : [];
        window._currentUser.roles = roles;
        window._currentUser.requiredRole = userData.requiredRole || window._currentUser.requiredRole;
        window._currentUser.canApprovePrs = !!(userData.permissions && userData.permissions.canApprovePrs);
        window._currentUser.canManageAppServices = !!(userData.permissions && userData.permissions.canManageAppServices);
        setText('userRole', formatDisplayRoles(roles));
      }
    } catch (e) {
      setText('userRole', 'Unable to load role');
    }

    if (document.getElementById('systemHealthGrid') || document.getElementById('systemHealthSummary')) {
      await checkHealthStatus();
    }

    document.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', () => closeModal(el.getAttribute('data-close')));
    });
    document.querySelectorAll('.modal-backdrop').forEach(bd => {
      bd.addEventListener('click', (e) => {
        if (e.target === bd) closeModal(bd.id);
      });
    });

  } catch (err) {
    console.error('Init failed:', err);
    window.location.href = '/';
  }
}



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
    tester_appservice_manager: 'Tester App Service Manager',
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

function initThemeToggle() {
  // Theme toggle logic removed
}

function renderSkeletonRows(columnsCount, rowsCount) {
  let rowsHtml = '';
  for (let r = 0; r < rowsCount; r++) {
    rowsHtml += '<tr>';
    for (let c = 0; c < columnsCount; c++) {
      const randomWidth = 40 + Math.floor(Math.random() * 50);
      rowsHtml += `<td><div class="skeleton skeleton-text" style="width: ${randomWidth}%; margin: 6px 0;"></div></td>`;
    }
    rowsHtml += '</tr>';
  }
  return rowsHtml;
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
  const fetchOptions = Object.assign({}, options || {});
  const timeoutMs = Number(fetchOptions.timeoutMs) || 0;
  delete fetchOptions.timeoutMs;
  const isApiRequest = typeof url === 'string' && url.startsWith('/api/');
  if (isApiRequest && !fetchOptions.redirect) {
    fetchOptions.redirect = 'manual';
  }

  let timeoutId = null;
  if (timeoutMs > 0 && !fetchOptions.signal && typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    fetchOptions.signal = controller.signal;
    timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  }

  let resp;
  try {
    resp = await fetch(url, fetchOptions);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error('Request timeout after ' + Math.round(timeoutMs / 1000) + 's');
    }
    throw err;
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }

  const responseUrl = resp.url || '';
  const isAuthRedirect = resp.type === 'opaqueredirect' ||
    resp.status === 0 ||
    resp.status === 302 ||
    responseUrl.includes('/.auth/login/');
  if (isApiRequest && isAuthRedirect) {
    return {
      ok: false,
      status: resp.status || 302,
      contentType: resp.headers.get('Content-Type') || '',
      data: null,
      rawBody: '',
      parseError: 'Authentication redirect',
      authRedirect: true,
      redirectUrl: responseUrl
    };
  }

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
  const copyIntoButton = isMergeCodePr(pr)
    ? '<button type="button" class="branch-copy-btn" title="Copy Into branch" aria-label="Copy Into branch" data-branch="' + escapeHtml(targetFull) + '" onclick="copyBranchInto(this)">📋</button>'
    : '';

  return '<div class="branch-stack">' +
    '<div class="branch-line branch-from">' +
      '<span class="branch-label">From</span>' +
      '<code title="' + escapeHtml(sourceFull) + '">' + escapeHtml(sourceText) + '</code>' +
    '</div>' +
    '<div class="branch-line branch-into">' +
      '<span class="branch-label">Into</span>' +
      '<span class="branch-copy-wrap">' +
        '<code title="' + escapeHtml(targetFull) + '">' + escapeHtml(targetFull) + '</code>' +
        copyIntoButton +
      '</span>' +
    '</div>' +
  '</div>';
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

window.copyBranchInto = async function(button) {
  const text = button && button.dataset ? String(button.dataset.branch || '') : '';
  if (!text) return;
  const originalText = button.textContent;
  const originalTitle = button.getAttribute('title') || '';
  try {
    await copyTextToClipboard(text);
    button.textContent = '✓';
    button.classList.add('copied');
    button.setAttribute('title', 'Copied');
    window.setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove('copied');
      button.setAttribute('title', originalTitle);
    }, 1200);
  } catch (err) {
    button.textContent = '!';
    button.classList.add('copy-failed');
    button.setAttribute('title', 'Copy failed');
    window.setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove('copy-failed');
      button.setAttribute('title', originalTitle);
    }, 1200);
  }
};
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.hidden = false;
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.hidden = true;
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
                          actionText.includes('Rejected') ? 'log-rejected' :
                          actionText.includes('Hold') ? 'log-hold' : 'log-failed';
      const buildText = [it.Build_Status, it.Build_Result].filter(Boolean).join(' / ') || '-';
      html += '<tr>' +
        '<td>' + formatDate(it.createdAt) + '</td>' +
        '<td><span class="' + actionClass + '">' + escapeHtml(it.Action || '-') + '</span></td>' +
        '<td>' + renderHistoryUserCell(it) + '</td>' +
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

function renderHistoryUserCell(item) {
  const rawUser = String(item && item.User || '').trim();
  const email = String(item && item.User_Email || '').trim() || rawUser;
  const displayName = String(item && item.User_Display_Name || '').trim();
  const jobTitle = String(item && item.User_Job_Title || '').trim();
  const department = String(item && item.User_Department || '').trim();
  const position = [jobTitle, department].filter(Boolean).join(' · ');

  if (!displayName && !position) {
    return '<span class="history-user-email">' + escapeHtml(rawUser || '-') + '</span>';
  }

  return '<div class="history-user-cell">' +
    '<div class="history-user-name">' + escapeHtml(displayName || rawUser || '-') + '</div>' +
    (position ? '<div class="history-user-position">' + escapeHtml(position) + '</div>' : '') +
    (email ? '<div class="history-user-email">' + escapeHtml(email) + '</div>' : '') +
    '</div>';
}



// ===== Shared State & Storage Helpers =====
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
      targetBranch: data && data.targetBranch,
      readSource: data && data.readSource,
      readIdentity: data && data.readIdentity
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

// ===== Shared PR Helpers =====
function isApprovalHeld(pr) {
  return !!(pr && pr.approvalHold && pr.approvalHold.active);
}

function getHoldReason(pr) {
  return pr && pr.approvalHold && pr.approvalHold.reason ? String(pr.approvalHold.reason) : '';
}

function isMergeCodePr(pr) {
  return pr && (
    pr.isMergeCodeTarget === true ||
    String(pr.targetBranch || '').toLowerCase().includes('mergecode')
  );
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

function renderPrIdInline(pr, mode) {
  const marker = getPrStateMarker(pr, mode);
  const idText = pr.id ? (typeof pr.id === 'string' && pr.id.startsWith('R') ? pr.id : '#' + pr.id) : '🚀 Release';
  return '<span class="pr-id-wrap" title="' + escapeHtml(marker.title) + '">' +
    '<span class="pr-state-prefix ' + marker.className + '" aria-label="' + escapeHtml(marker.title) + '">' + marker.icon + '</span>' +
    '<strong class="pr-summary-id">' + escapeHtml(idText) + '</strong>' +
    '</span>';
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
    label = r.label || (status === 'deploying' ? 'Deploying' : 'Waiting');
  } else if (status === 'lookup_failed') {
    cls = 'release-badge release-failed';
    icon = '⚠️';
    label = 'Lookup failed';
  }

  const openLink = !options.hideOpenLink && pr.url ? '<a class="btn-mini btn-open" href="' + escapeHtml(pr.url) + '" target="_blank" rel="noopener" title="Open ADO PR">🔗</a>' : '';
  const approveButton = options.showApproveAction && !isApprovalHeld(pr) && status === 'pending' && r.approvalId && window._currentUser && window._currentUser.canApprovePrs === true
    ? '<button class="btn-mini btn-release" onclick="approveRelease(\'' + pr.id + '\')">Approve Release</button>'
    : '';

  return '<div class="release-badge-wrap">' +
    '<span class="' + cls + '" title="' + escapeHtml(label) + '">' +
      '<span class="release-main">' + icon + ' ' + escapeHtml(label) + '</span>' +
      (detail ? '<span class="release-detail">' + escapeHtml(detail) + '</span>' : '') +
    '</span>' +
    (approveButton || openLink ? '<div class="release-actions">' + approveButton + openLink + '</div>' : '') +
  '</div>';
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

function renderCompletedActions(pr) {
  const openUrl = pr.url ? escapeHtml(pr.url) : '#';
  const openAttrs = pr.url ? ' target="_blank" rel="noopener"' : ' aria-disabled="true" tabindex="-1"';
  const openClass = pr.url ? 'btn-mini btn-open' : 'btn-mini btn-open btn-disabled';
  return '<div class="action-cell">' +
    '<button class="btn-mini btn-history" onclick="openHistoryModal(\'' + pr.id + '\')">📜</button>' +
    '<a class="' + openClass + '" href="' + openUrl + '"' + openAttrs + '>🔗</a>' +
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
  const innerHtml = '<span class="status-main">' + icon + ' ' + escapeHtml(label) + '</span>' +
    '<span class="status-detail">' + escapeHtml(detail) + '</span>';

  const buildId = s.buildRunId || (s.adoBuildUrl && (s.adoBuildUrl.match(/[?&]buildId=(\d+)/i) || s.adoBuildUrl.match(/\/build\/results\?buildId=(\d+)/i) || [])[1]) || '';
  if (buildId && isFailed) {
    return '<a class="' + cls + '" href="/build-diagnostics.html?buildId=' + encodeURIComponent(buildId) + '" title="' + escapeHtml(title) + '">' + innerHtml + '</a>';
  }
  return '<span class="' + cls + '" title="' + escapeHtml(title) + '">' +
    innerHtml +
    '</span>';
}

function renderRecentlyApprovedRows(tbody, rows) {
  for (const pr of rows) {
    const tr = document.createElement('tr');
    const statusBadge = renderRecentlyApprovedStatusBadge(pr);
    const releaseBadge = renderReleaseBadge(pr, {
      showApproveAction: false,
      summarizeExpectedWhenCompleted: true,
      hideOpenLink: true
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
  
  // Directly render the page if it's local pagination
  const pageCount = Math.max(1, Math.ceil(prs.length / displayLimit));
  const start = 0;
  const end = Math.min(displayLimit, prs.length);
  const pageRows = prs.slice(start, end);
  meta.textContent = 'Last ' + lookbackHours + ' hours by approval log | showing ' + (start + 1) + '-' + end + ' of ' + total + ' PRs';

  if (pager) {
    if (pageCount > 1) {
      pager.hidden = false;
      pager.innerHTML =
        '<button class="btn-mini btn-pager" onclick="changeRecentlyApprovedPage(-1)" disabled>Previous</button>' +
        '<span class="pager-label">Page 1 of ' + pageCount + '</span>' +
        '<button class="btn-mini btn-pager" onclick="changeRecentlyApprovedPage(1)">Next</button>';
    } else {
      pager.hidden = true;
      pager.innerHTML = '';
    }
  }

  tbody.innerHTML = '';
  renderRecentlyApprovedRows(tbody, pageRows);
}

// ===== Shared Health Status Helpers =====
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

  const lastHourlySync = data.lastHourlySync || null;
  const hourlySyncStatus = getHourlySyncHealthStatus(lastHourlySync);
  cards.push(buildHealthCard({
    key: 'last-hourly-sync',
    label: 'Last Hourly Sync',
    status: hourlySyncStatus,
    message: lastHourlySync && lastHourlySync.at
      ? formatDate(lastHourlySync.at)
      : 'ยังไม่พบ hourly sync log',
    detail: lastHourlySync ? {
      result: lastHourlySync.result,
      checkedPrs: lastHourlySync.checkedPrs,
      inserted: lastHourlySync.inserted,
      skipped: lastHourlySync.skipped,
      lookbackHours: lastHourlySync.lookbackHours
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

  const lastTableRetentionCleanup = data.lastTableRetentionCleanup || null;
  const tableRetentionCleanupStatus = getRetentionCleanupHealthStatus(lastTableRetentionCleanup);
  cards.push(buildHealthCard({
    key: 'last-table-retention-cleanup',
    label: 'Last Table Cleanup',
    status: tableRetentionCleanupStatus,
    message: lastTableRetentionCleanup && lastTableRetentionCleanup.at
      ? formatDate(lastTableRetentionCleanup.at)
      : 'ยังไม่พบ table cleanup log',
    detail: lastTableRetentionCleanup ? {
      result: lastTableRetentionCleanup.result,
      matched: lastTableRetentionCleanup.matched,
      deleted: lastTableRetentionCleanup.deleted,
      dryRun: lastTableRetentionCleanup.dryRun
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

  const nextLineRun = data.schedule && data.schedule.lineDailySummary && data.schedule.lineDailySummary.nextRunAt;
  cards.push(buildHealthCard({
    key: 'next-line-summary',
    label: 'Next LINE Summary',
    status: data.schedule && data.schedule.lineDailySummary && data.schedule.lineDailySummary.enabled ? 'ok' : 'warning',
    message: nextLineRun ? formatDate(nextLineRun) : 'LINE daily summary schedule not ready',
    detail: { schedule: '23:59 Asia/Bangkok' }
  }));

  const nextHourlyRun = data.schedule && data.schedule.hourlyLogSync && data.schedule.hourlyLogSync.nextRunAt;
  cards.push(buildHealthCard({
    key: 'next-hourly-sync',
    label: 'Next Hourly Sync',
    status: data.schedule && data.schedule.hourlyLogSync && data.schedule.hourlyLogSync.enabled ? 'ok' : 'warning',
    message: nextHourlyRun ? formatDate(nextHourlyRun) : 'Hourly sync schedule not ready',
    detail: { schedule: 'Every 1 hour' }
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

function getHourlySyncHealthStatus(sync) {
  if (!sync || !sync.at) return 'warning';
  const ageMs = Date.now() - Date.parse(sync.at);
  if (!Number.isFinite(ageMs)) return 'warning';
  if (ageMs > 2 * 60 * 60 * 1000) return 'warning';
  if (Number(sync.errors || 0) > 0) return 'warning';
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

// Exports for ES Modules
export {
  bind,
  setText,
  getUserEmailForDisplay,
  formatDisplayRoles,
  showBox,
  initThemeToggle,
  renderSkeletonRows,
  setButtonLoading,
  resetCheckPrsButton,
  escapeHtml,
  safeFetchJson,
  formatDate,
  formatDateTime,
  shortBranch,
  compactBranchName,
  renderBranchCell,
  openModal,
  closeModal,
  initPage,
  saveLastSync,
  getLastSync,
  isApprovalHeld,
  getHoldReason,
  isMergeCodePr,
  getPrStateMarker,
  renderPrIdInline,
  renderReleaseBadge,
  renderApprovalLogSourceBadge,
  renderCompletedActions,
  isPrCompletedForReleaseSummary,
  getStatusSummaryText,
  renderRecentlyApprovedStatusBadge,
  renderRecentlyApprovedRows,
  renderCompletedPrTable,
  checkHealthStatus,
  renderSystemHealth,
  renderSystemHealthError,
  buildHealthSummary,
  getExceptionScanHealthStatus,
  getHourlySyncHealthStatus,
  getRetentionCleanupHealthStatus,
  buildHealthCard,
  formatHealthDetail,
  humanizeKey
};
