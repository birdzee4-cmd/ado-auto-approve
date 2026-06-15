import {
  safeFetchJson, escapeHtml, showBox, setText, setButtonLoading,
  renderSkeletonRows, bind, shortBranch, compactBranchName,
  renderBranchCell, formatDate, formatDateTime, resetCheckPrsButton,
  saveLastSync, getLastSync, isApprovalHeld, getHoldReason,
  isMergeCodePr, getPrStateMarker, renderPrIdInline, renderReleaseBadge,
  renderApprovalLogSourceBadge, renderCompletedActions,
  isPrCompletedForReleaseSummary, getStatusSummaryText,
  renderRecentlyApprovedStatusBadge, renderRecentlyApprovedRows,
  renderCompletedPrTable, initPage, checkHealthStatus,
  openModal, closeModal
} from './core.js';

let currentPrForAction = null;
let _allPrs = [];



// ===== Check PRs =====
async function checkPrs(isSilent) {
  if (!document.getElementById('prTableContainer')) return;
  if (!isSilent) {
    setButtonLoading('btnCheckPrs', true, 'Loading...');
    
    const prTbody = document.getElementById('prTableBody');
    const relTbody = document.getElementById('releaseTableBody');
    if (prTbody) prTbody.innerHTML = renderSkeletonRows(7, 4);
    if (relTbody) relTbody.innerHTML = renderSkeletonRows(6, 2);
    
    if (document.getElementById('prTableContainer')) document.getElementById('prTableContainer').hidden = false;
    if (document.getElementById('releaseTableContainer')) document.getElementById('releaseTableContainer').hidden = false;
    if (document.getElementById('dashboardTabs')) document.getElementById('dashboardTabs').hidden = false;
    
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

  const fetchedStr = new Date(d.fetchedAt).toLocaleString('th-TH');

  let cardsHtml = '';

  // 1. Status Card (First)
  cardsHtml += '<div class="summary-card">' +
    '<span class="card-icon">📊</span>' +
    '<div class="card-body">' +
      '<span class="card-label">Status</span>' +
      '<div class="card-badges">' +
        '<span class="status-badge-custom badge-blue">New <strong>' + newCount + '</strong></span>' +
        '<span class="status-badge-custom badge-orange">Hold <strong>' + holdCount + '</strong></span>' +
        '<span class="status-badge-custom badge-green">Voted <strong>' + votedCount + '</strong></span>' +
        '<span class="status-badge-custom badge-purple">Release <strong>' + releaseCount + '</strong></span>' +
      '</div>' +
    '</div>' +
  '</div>';

  // 2. Attention Card (Second)
  cardsHtml += '<div class="summary-card">' +
    '<span class="card-icon">⚠️</span>' +
    '<div class="card-body">' +
      '<span class="card-label">Attention</span>' +
      '<div class="card-badges">' +
        '<span class="status-badge-custom badge-red">Critical <strong>' + (attention.critical || 0) + '</strong></span>' +
        '<span class="status-badge-custom badge-orange">Warning <strong>' + (attention.warning || 0) + '</strong></span>' +
        '<span class="status-badge-custom badge-slate">Stale <strong>' + (attention.stale || 0) + '</strong></span>' +
      '</div>' +
    '</div>' +
  '</div>';

  // 3. Fetched Card (Third)
  cardsHtml += '<div class="summary-card">' +
    '<span class="card-icon">🕒</span>' +
    '<div class="card-body">' +
      '<span class="card-label">Fetched</span>' +
      '<strong class="card-value">' + fetchedStr + '</strong>' +
    '</div>' +
  '</div>';

  // Optional: MergeCode Card
  if (mergeCodeCount > 0) {
    cardsHtml += '<div class="summary-card mergecode-card">' +
      '<span class="card-icon">🔗</span>' +
      '<div class="card-body">' +
        '<span class="card-label">MergeCode Manual</span>' +
        '<strong class="card-value text-amber">' + mergeCodeCount + ' PR</strong>' +
      '</div>' +
    '</div>';
  }


  return '<div class="test-result result-success pr-summary-banner">' +
    '<div class="summary-main-line">✅ Found <strong>' + d.count + '</strong> PR waiting approve</div>' +
    '<div class="summary-sub-line">from ' + d.totalActive + ' total active PRs in <code>' + escapeHtml(d.targetBranch) + '</code></div>' +
    '<div class="summary-cards-container">' +
      cardsHtml +
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





function renderHoldStatus(pr) {
  const hold = pr && pr.approvalHold || {};
  const reason = hold.reason ? '<span class="hold-detail">' + escapeHtml(hold.reason) + '</span>' : '';
  return '<span class="hold-status" title="' + escapeHtml(hold.reason || 'Approval is on hold') + '">' +
    '<span class="hold-label">⏸ On Hold</span>' + reason + '</span>';
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
    const buildId = s.buildRunId || (s.adoBuildUrl.match(/[?&]buildId=(\d+)/i) || s.adoBuildUrl.match(/\/build\/results\?buildId=(\d+)/i) || [])[1] || '';
    if (buildId && (buildResult === 'failed' || buildResult === 'error')) {
      return '<a class="' + cls + '" href="/build-diagnostics.html?buildId=' + encodeURIComponent(buildId) + '" title="' + escapeHtml(title) + '">' + inner + '</a>';
    }
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
  const innerHtml = '<span class="status-main">' + icon + ' ' + escapeHtml(label) + '</span>' +
    '<span class="status-detail">' + escapeHtml(isFailed || isRunning ? 'PR completed' : supportingLabel) + '</span>';

  const buildId = s.buildRunId || (s.adoBuildUrl && (s.adoBuildUrl.match(/[?&]buildId=(\d+)/i) || s.adoBuildUrl.match(/\/build\/results\?buildId=(\d+)/i) || [])[1]) || '';
  if (buildId && isFailed) {
    return '<a class="' + cls + '" href="/build-diagnostics.html?buildId=' + encodeURIComponent(buildId) + '" title="' + escapeHtml(title) + '">' + innerHtml + '</a>';
  }
  return '<span class="' + cls + '" title="' + escapeHtml(title) + '">' +
    innerHtml +
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
    // Reset to OFF (normal) on load/refresh!
    window._autoMode = 'normal';
    updateModeButtonsUI('normal');
    stopCountdown();
    stopAutoPoller();
    
    // Reset sessionStorage stats
    sessionStorage.removeItem('autoPrApprovedCount');
    sessionStorage.removeItem('autoReleaseApprovedCount');
    window._autoPrApprovedCount = 0;
    window._autoReleaseApprovedCount = 0;

    // Send update to backend to disable the mode on SharePoint too
    await safeFetchJson('/api/auto-approve-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        autoMode: 'normal',
        durationMinutes: 'end_of_day'
      })
    });
    
    writeToAutoConsole('Auto Approve Mode has been initialized to OFF.', 'info');
  } catch (e) {
    writeToAutoConsole('Failed to reset Auto settings on load: ' + e.message, 'error');
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

  const consoleWrap = document.getElementById('autoConsoleWrap');
  if (consoleWrap) {
    consoleWrap.hidden = mode === 'normal';
  }

  const statsWrap = document.getElementById('autoSessionStats');
  if (statsWrap) {
    statsWrap.hidden = mode !== 'active';
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
        durationMinutes: 'end_of_day'
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

// Page initialization
(async function init() {
  await initPage();
  
  // Dashboard-specific event bindings
  bind('btnCheckPrs', async () => {
    if (window._autoMode === 'dry-run' || window._autoMode === 'active') {
      const modeLabel = window._autoMode === 'active' ? 'ACTIVE (Auto-Approve)' : 'ACTIVE (Manual)';
      const ok = confirm(`คุณต้องการปิดโหมด ${modeLabel} และดึงข้อมูล PR ใหม่ใช่หรือไม่?`);
      if (!ok) return;
    }
    if (window._currentUser && window._currentUser.canApprovePrs === true) {
      await changeAutoMode('normal');
    }
    await checkPrs(false);
  });
  
  bind('btnConfirmApprove', doApprove);
  bind('btnConfirmReject', doReject);
  bind('btnConfirmHold', doHold);
  
  // Intercept page reload/navigation when auto mode is active
  window.addEventListener('beforeunload', (e) => {
    if (window._autoMode === 'dry-run' || window._autoMode === 'active') {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });
  
  await initAutoApprove();
  await checkPrs();
})();

