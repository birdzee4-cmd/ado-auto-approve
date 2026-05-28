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
        if (userData.name)  setText('displayName', userData.name);
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
    bind('btnTestHealth', testHealth);
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

    checkPrs();

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
  btn.innerHTML = '<span>🔄</span><span>เรียกดูข้อมูล</span>';
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
  const sourceText = compactBranchName(pr.sourceBranch, 42);

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
  setButtonLoading('btnCheckPrs', true, 'กำลังโหลด...');
  document.getElementById('prTableContainer').hidden = true;
  showBox('prResult', '<div class="test-result result-info">⏳ กำลังเรียก ADO API...</div>');

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
    const mergeCodeCount = (d.prs || []).filter(isMergeCodePr).length;
    const mergeCodeNote = mergeCodeCount > 0
      ? '<br/><small><strong>MergeCode manual:</strong> พบ ' + mergeCodeCount + ' PR ที่ต้องเปิดไปทำเองใน Azure DevOps</small>'
      : '';
    showBox('prResult',
      '<div class="test-result result-success">✅ พบ <strong>' + d.count + '</strong> PR ที่รออนุมัติ ' +
      '(จาก ' + d.totalActive + ' active PRs ทั้งหมดใน <code>' + escapeHtml(d.targetBranch) + '</code>)' +
      '<br/><small>Filter: reviewer group = <strong>' + escapeHtml(d.reviewerGroup) + '</strong> | ดึงเมื่อ ' +
      new Date(d.fetchedAt).toLocaleString('th-TH') + '</small>' + mergeCodeNote + '</div>');
    renderPrTable(d.prs);
    document.getElementById('prTableContainer').hidden = false;
  } catch (err) {
    showBox('prResult', '<div class="test-result result-error">❌ ' + escapeHtml(err.message) + '</div>');
  } finally {
    resetCheckPrsButton();
  }
}

function renderPrTable(prs) {
  document.getElementById('prMeta').textContent = 'พบ ' + prs.length + ' รายการ';
  const tbody = document.getElementById('prTableBody');
  tbody.innerHTML = '';
  window._prCache = {};

  if (prs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:#9ca3af">— ไม่มี PR ที่รอ Approve ตอนนี้ —</td></tr>';
    return;
  }

  for (const pr of prs) {
    const tr = document.createElement('tr');
    if (pr.isDraft) tr.classList.add('pr-draft');
    if (isMergeCodePr(pr)) tr.classList.add('pr-mergecode');

    const mergeCodeBadge = isMergeCodePr(pr) ? ' <span class="pr-badge pr-badge-manual">MERGECODE MANUAL</span>' : '';
    const draftBadge = pr.isDraft ? ' <span class="pr-badge">DRAFT</span>' : '';
    const approvalBadge = renderApprovalBadge(pr);
    const myApprovalBadge = renderMyApprovalBadge(pr);
    const actionsHtml = renderActions(pr);

    tr.innerHTML =
      '<td class="pr-id-cell"><strong>#' + pr.id + '</strong></td>' +
      '<td class="pr-title-cell"><span class="pr-title-text">' + escapeHtml(pr.title) + '</span>' + draftBadge + mergeCodeBadge + '</td>' +
      '<td class="pr-by-cell">' + escapeHtml(pr.createdBy || '-') + '</td>' +
      '<td class="pr-branch-cell">' + renderBranchCell(pr) + '</td>' +
      '<td class="pr-approval-cell">' + approvalBadge + '</td>' +
      '<td class="pr-my-approval-cell">' + myApprovalBadge + '</td>' +
      '<td class="pr-repo-cell">' + escapeHtml(pr.repository || '-') + '</td>' +
      '<td class="pr-created-cell">' + formatDate(pr.creationDate) + '</td>' +
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
      policyFetched: pr.policyFetched === true,
      isMergeCodeTarget: isMergeCodePr(pr)
    };
    tbody.appendChild(tr);
  }
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
      '<button class="btn-mini btn-approve" disabled title="ต้องมี role: ' + escapeHtml(requiredRole) + '">✅ Approve</button>' +
      '<button class="btn-mini btn-reject" disabled title="ต้องมี role: ' + escapeHtml(requiredRole) + '">❌ Reject</button>' +
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
  const label = icon + ' ' + ratio + ' ' + text;
  return '<button class="' + cls + '" onclick="openReviewersModal(' + pr.id + ')" title="คลิกดูรายชื่อ reviewers">' +
    escapeHtml(label) + '</button>';
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
  setButtonLoading('btnConfirmApprove', true, 'กำลังส่ง...');
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
  setButtonLoading('btnConfirmReject', true, 'กำลังส่ง...');
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
  document.getElementById('historyContent').innerHTML = '⏳ กำลังโหลด log จาก SharePoint...';
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
    let html = '<table class="pr-table"><thead><tr><th>เวลา</th><th>Action</th><th>โดย</th><th>Result</th><th>Reason</th></tr></thead><tbody>';
    for (const it of items) {
      const actionClass = it.Action === 'Approved' ? 'log-approved' :
                          it.Action === 'Rejected' ? 'log-rejected' : 'log-failed';
      html += '<tr>' +
        '<td>' + formatDate(it.createdAt) + '</td>' +
        '<td><span class="' + actionClass + '">' + escapeHtml(it.Action || '-') + '</span></td>' +
        '<td>' + escapeHtml(it.User || '-') + '</td>' +
        '<td>' + escapeHtml(it.Result || '-') + '</td>' +
        '<td>' + escapeHtml(it.Reason || '-') + '</td>' +
        '</tr>';
    }
    html += '</tbody></table>';
    document.getElementById('historyContent').innerHTML = html;
  } catch (err) {
    document.getElementById('historyContent').innerHTML =
      '<div style="color:#dc2626">❌ ' + escapeHtml(err.message) + '</div>';
  }
};

// ===== Test Functions =====
async function testTeams() {
  setButtonLoading('btnTestTeams', true);
  showResult('⏳ กำลังส่งข้อความทดสอบ...', 'info');
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
  showResult('⏳ กำลังตรวจ...', 'info');
  try {
    const r = await safeFetchJson('/api/health');
    if (r.ok && r.data && r.data.status === 'healthy') {
      showResult('✅ Backend OK | Node ' + escapeHtml(r.data.node_version) + ' | Uptime ' + r.data.uptime_seconds + 's', 'success');
    } else { showResult('⚠️ HTTP ' + r.status, 'error'); }
  } catch (err) { showResult('❌ ' + err.message, 'error'); }
  finally { setButtonLoading('btnTestHealth', false); }
}

async function checkHealthStatus() {
  try {
    const resp = await fetch('/api/health');
    const card = document.getElementById('apiStatus');
    if (!card) return;
    if (resp.ok) {
      card.querySelector('.status-icon').textContent = '✅';
      card.querySelector('.status-desc').textContent = 'OK';
    } else {
      card.querySelector('.status-icon').textContent = '❌';
      card.querySelector('.status-desc').textContent = 'HTTP ' + resp.status;
    }
  } catch (e) {
    const card = document.getElementById('apiStatus');
    if (card) {
      card.querySelector('.status-icon').textContent = '⚠️';
      card.querySelector('.status-desc').textContent = 'unreachable';
    }
  }
}
