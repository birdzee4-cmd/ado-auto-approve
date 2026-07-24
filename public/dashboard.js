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
let _buildSummaryFilter = '';
let _checkPrsInFlight = false;
let _autoScanConsecutiveFailures = 0;
const AUTO_CONSOLE_MAX_ENTRIES = 100;
const AUTO_RESUME_KEY = 'pendingAutoApproveResume';
const AUTO_RESUME_MAX_AGE_MS = 10 * 60 * 1000;
window._adoAuthStatus = {
  connected: false,
  checked: false
};

async function loadAdoAuthStatus() {
  const statusEl = document.getElementById('adoConnectionStatus');
  const connectBtn = document.getElementById('btnConnectAdo');
  const disconnectBtn = document.getElementById('btnDisconnectAdo');
  if (statusEl) statusEl.textContent = 'Checking...';
  try {
    const params = new URLSearchParams(window.location.search || '');
    const statusUrl = params.get('adoConnected') === '1'
      ? '/api/ado-auth-status?recover=1'
      : '/api/ado-auth-status';
    const r = await safeFetchJson(statusUrl);
    const d = r.data || {};
    const connected = !!(r.ok && d.ok && d.connected);
    window._adoAuthStatus = {
      connected: connected,
      checked: true,
      user: d.user || '',
      reason: d.reason || '',
      expiresAt: d.expiresAt || ''
    };
    if (statusEl) {
      statusEl.textContent = connected
        ? 'Connected as ' + (d.user || 'Azure DevOps user')
        : 'Not connected';
      statusEl.className = 'info-value ' + (connected ? 'ado-connected' : 'ado-not-connected');
    }
    if (connectBtn) {
      connectBtn.hidden = false;
      connectBtn.textContent = connected ? 'Reconnect' : 'Connect';
      connectBtn.setAttribute(
        'aria-label',
        connected ? 'Reconnect Azure DevOps' : 'Connect Azure DevOps'
      );
    }
    if (disconnectBtn) disconnectBtn.hidden = !connected;
  } catch (e) {
    window._adoAuthStatus = { connected: false, checked: true, reason: e.message };
    if (statusEl) {
      statusEl.textContent = 'Unable to check';
      statusEl.className = 'info-value ado-not-connected';
    }
    if (connectBtn) {
      connectBtn.hidden = false;
      connectBtn.textContent = 'Connect';
      connectBtn.setAttribute('aria-label', 'Connect Azure DevOps');
    }
    if (disconnectBtn) disconnectBtn.hidden = true;
  }
}

function startAdoConnect() {
  const returnTo = window.location.pathname + window.location.search;
  window.location.href = '/api/ado-auth-start?returnTo=' + encodeURIComponent(returnTo || '/dashboard.html');
}

async function disconnectAdo() {
  if (!confirm('Disconnect Azure DevOps from this browser session?')) return;
  await safeFetchJson('/api/ado-auth-disconnect', { method: 'POST' });
  await loadAdoAuthStatus();
}

async function ensureAdoConnected() {
  if (!window._adoAuthStatus || !window._adoAuthStatus.checked) {
    await loadAdoAuthStatus();
  }
  if (window._adoAuthStatus && window._adoAuthStatus.connected) return true;
  if (confirm('ต้อง Connect Azure DevOps ก่อน เพื่อ Approve ด้วยชื่อบัญชีของคุณเอง\n\nต้องการ Connect ตอนนี้ไหม?')) {
    startAdoConnect();
  }
  return false;
}

function handleAdoAuthRequired(responseData) {
  const connectUrl = responseData && responseData.connectUrl || '/api/ado-auth-start?returnTo=/dashboard.html';
  if (confirm('ต้อง Connect Azure DevOps ก่อน เพื่อดำเนินการด้วยชื่อบัญชีของคุณเอง\n\nต้องการ Connect ตอนนี้ไหม?')) {
    window.location.href = connectUrl;
    return true;
  }
  return false;
}

let _browserAuthRecoveryStarted = false;

function getCurrentDashboardReturnTo() {
  return window.location.pathname + window.location.search + window.location.hash || '/dashboard.html';
}

function savePendingAutoResume(reason) {
  const mode = window._autoMode;
  if (mode !== 'dry-run' && mode !== 'active') return;
  try {
    sessionStorage.setItem(AUTO_RESUME_KEY, JSON.stringify({
      mode: mode,
      reason: reason || '',
      occurredAt: new Date().toISOString(),
      returnTo: getCurrentDashboardReturnTo(),
      prApprovedCount: Number(window._autoPrApprovedCount) || 0,
      releaseApprovedCount: Number(window._autoReleaseApprovedCount) || 0
    }));
  } catch (e) {}
}

function recoverBrowserAuthSession(reason) {
  if (_browserAuthRecoveryStarted) return true;
  _browserAuthRecoveryStarted = true;
  savePendingAutoResume(reason);

  window._autoMode = 'normal';
  updateModeButtonsUI('normal');
  stopAutoPoller();
  stopCountdown();

  const message = reason || 'Browser session expired while calling the API.';
  writeToAutoConsole(message + ' Redirecting to sign in again. No approval was sent.', 'error');
  showAdoAuthNotice(
    'error',
    'Browser session needs sign-in',
    'ระบบกำลังพาไปยืนยันตัวตนใหม่ แล้วจะกลับมาหน้า Dashboard อัตโนมัติ'
  );

  window.setTimeout(() => {
    const returnTo = getCurrentDashboardReturnTo();
    window.location.href = '/.auth/login/aad?post_login_redirect_uri=' + encodeURIComponent(returnTo);
  }, 800);
  return true;
}

function handleBrowserAuthRedirect(response, isSilent) {
  const status = response && Number(response.status);
  if (!response || (!response.authRedirect && status !== 302)) return false;

  const message = 'Automatic scan reached /api/list-prs but Static Web Apps redirected to sign-in (HTTP ' + (status || 302) + ').';
  if (!isSilent) {
    showBox('prResult', '<div class="test-result result-error">❌ Session หมดอายุหรือ auth redirect กรุณารอสักครู่ ระบบจะพาไป sign in ใหม่</div>');
  }
  recoverBrowserAuthSession(message);
  return true;
}

function takePendingAutoResume() {
  let pending = null;
  try {
    const raw = sessionStorage.getItem(AUTO_RESUME_KEY);
    sessionStorage.removeItem(AUTO_RESUME_KEY);
    if (!raw) return null;
    pending = JSON.parse(raw);
  } catch (e) {
    return null;
  }

  const mode = pending && pending.mode;
  if (mode !== 'dry-run' && mode !== 'active') return null;

  const occurredMs = Date.parse(pending.occurredAt || '');
  if (!Number.isFinite(occurredMs)) return null;
  if (Date.now() - occurredMs > AUTO_RESUME_MAX_AGE_MS) return null;

  return pending;
}

async function promptAutoResumeAfterAuth() {
  const pending = takePendingAutoResume();
  if (!pending) return false;

  const label = pending.mode === 'active' ? 'ACTIVE (Auto-Approve)' : 'ACTIVE (Manual)';
  const happened = new Date(pending.occurredAt).toLocaleString('th-TH', {
    dateStyle: 'short',
    timeStyle: 'medium'
  });
  const detail = 'ก่อนหน้านี้โหมด ' + label + ' หยุดเพราะ browser session ต้อง sign-in ใหม่เมื่อ ' + happened + '\n\n' +
    'ต้องการ Resume โหมดนี้ต่อไหม?\n\n' +
    'ระบบจะดึง PR ใหม่จาก backend ก่อน และจะไม่ใช้ผล scan เก่ามา approve';

  if (!confirm(detail)) {
    writeToAutoConsole('Auto Approve resume was skipped after sign-in. Mode remains OFF.', 'info');
    return false;
  }

  writeToAutoConsole('Resuming ' + label + ' after browser sign-in. A fresh scan will run before any action.', 'info');
  await changeAutoMode(pending.mode);
  return true;
}

function consumeAdoAuthCallbackResult() {
  const params = new URLSearchParams(window.location.search || '');
  if (!params.has('adoConnected') && !params.has('adoError')) return;

  const connected = params.get('adoConnected') === '1';
  const error = params.get('adoError') || '';
  const statusConnected = !!(window._adoAuthStatus && window._adoAuthStatus.connected);
  if (connected && statusConnected) {
    showAdoAuthNotice('success', 'Azure DevOps connected', 'พร้อมดำเนินการ Approve / Reject / Approve Release ด้วยบัญชี Azure DevOps ของคุณแล้ว');
  } else if (connected) {
    showAdoAuthNotice('error', 'Azure DevOps connection needs attention', 'ระบบกลับมาจาก OAuth แล้ว แต่ยังตรวจ token ไม่พบ กรุณากด Connect Azure DevOps อีกครั้ง');
  } else {
    showAdoAuthNotice('error', 'Azure DevOps connection failed', error || 'กรุณาลอง Connect Azure DevOps อีกครั้ง');
  }

  params.delete('adoConnected');
  params.delete('adoError');
  const nextQuery = params.toString();
  const nextUrl = window.location.pathname + (nextQuery ? '?' + nextQuery : '') + window.location.hash;
  window.history.replaceState({}, document.title, nextUrl);
}

function showAdoAuthNotice(type, title, detail) {
  const existing = document.getElementById('adoAuthNotice');
  if (existing) existing.remove();

  const notice = document.createElement('div');
  notice.id = 'adoAuthNotice';
  notice.className = 'ado-auth-notice ado-auth-notice-' + (type === 'error' ? 'error' : 'success');
  notice.setAttribute('role', type === 'error' ? 'alert' : 'status');
  notice.innerHTML =
    '<div class="ado-auth-notice-icon">' + (type === 'error' ? '!' : '✓') + '</div>' +
    '<div class="ado-auth-notice-body">' +
      '<div class="ado-auth-notice-title">' + escapeHtml(title) + '</div>' +
      '<div class="ado-auth-notice-detail">' + escapeHtml(detail || '') + '</div>' +
    '</div>' +
    '<button type="button" class="ado-auth-notice-close" aria-label="Dismiss Azure DevOps connection message">×</button>';

  const closeBtn = notice.querySelector('.ado-auth-notice-close');
  if (closeBtn) closeBtn.addEventListener('click', () => notice.remove());
  document.body.appendChild(notice);
  window.setTimeout(() => {
    if (notice.isConnected) notice.remove();
  }, type === 'error' ? 9000 : 6000);
}



// ===== Check PRs =====
async function checkPrs(isSilent) {
  if (!document.getElementById('prTableContainer')) return;
  if (_checkPrsInFlight) {
    if (isSilent && window._autoMode && window._autoMode !== 'normal') {
      writeToAutoConsole('Skipped automatic scan because the previous scan is still running.', 'info');
    }
    return;
  }

  _checkPrsInFlight = true;
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
    const listPrsUrl = isSilent ? '/api/list-prs?scanOnly=true' : '/api/list-prs';
    const r = await safeFetchJson(listPrsUrl, { timeoutMs: 55000 });
    if (handleBrowserAuthRedirect(r, isSilent)) {
      return;
    }
    if (r.parseError) {
      if (!isSilent) showBox('prResult', '<div class="test-result result-error">❌ Backend ตอบไม่ใช่ JSON (HTTP ' + r.status + ')</div>');
      else if (window._autoMode && window._autoMode !== 'normal') {
        logAutoScanFailure(describeAutoScanHttpFailure(r, null));
      }
      return;
    }
    if (!r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      if (!isSilent) {
        showBox('prResult', '<div class="test-result result-error">❌ ' + escapeHtml(d.error || 'Unknown') +
          '<br/><small>' + escapeHtml(d.hint || d.detail || '') + '</small></div>');
      } else if (window._autoMode && window._autoMode !== 'normal') {
        logAutoScanFailure(describeAutoScanHttpFailure(r, d));
      }
      return;
    }
    const d = r.data;
    resetAutoScanFailureState();
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
    if (!isSilent) {
      showBox('prResult', '<div class="test-result result-error">❌ ' + escapeHtml(err.message) + '</div>');
    } else if (window._autoMode && window._autoMode !== 'normal') {
      logAutoScanFailure(describeAutoScanException(err));
    }
  } finally {
    _checkPrsInFlight = false;
    if (!isSilent) {
      resetCheckPrsButton();
    }
  }
}

function resetAutoScanFailureState() {
  if (_autoScanConsecutiveFailures > 0 && window._autoMode && window._autoMode !== 'normal') {
    writeToAutoConsole('Automatic scan recovered after ' + _autoScanConsecutiveFailures + ' failed attempt(s).', 'info');
  }
  _autoScanConsecutiveFailures = 0;
}

function logAutoScanFailure(message) {
  _autoScanConsecutiveFailures += 1;
  const suffix = _autoScanConsecutiveFailures > 1
    ? ' (consecutive failures: ' + _autoScanConsecutiveFailures + ')'
    : '';
  writeToAutoConsole(message + suffix, 'error');
}

function describeAutoScanException(err) {
  const message = err && err.message ? String(err.message) : 'Unknown browser/network error';
  const lower = message.toLowerCase();

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'Automatic scan paused: browser is offline. No approval was sent.';
  }
  if (lower.includes('request timeout')) {
    return 'Automatic scan timed out while calling /api/list-prs. The backend may be busy or warming up. No approval was sent.';
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return 'Automatic scan could not reach /api/list-prs. Likely a brief network, deploy, or Functions warm-up interruption. No approval was sent.';
  }
  return 'Automatic scan failed before receiving an API response: ' + message + '. No approval was sent.';
}

function describeAutoScanHttpFailure(response, data) {
  const status = response && response.status ? Number(response.status) : 0;
  const d = data || {};
  const detail = d.error || d.hint || d.detail || response && response.parseError || '';

  if (status === 401 || status === 403) {
    return 'Automatic scan could not continue because the browser session is not authorized (HTTP ' + status + '). Refresh or sign in again. No approval was sent.';
  }
  if (status === 428) {
    return 'Automatic scan needs Azure DevOps connection refresh (HTTP 428). Connect Azure DevOps again before auto approve can continue.';
  }
  if (status === 429) {
    return 'Automatic scan was rate-limited by an upstream service (HTTP 429). It will retry on the next interval. No approval was sent.';
  }
  if (status >= 500) {
    return 'Automatic scan reached /api/list-prs but the backend returned HTTP ' + status + '. It will retry on the next interval. ' + (detail ? 'Detail: ' + detail : 'No approval was sent.');
  }
  if (response && response.parseError) {
    return 'Automatic scan reached /api/list-prs but received a non-JSON response (HTTP ' + (status || '-') + '). This can happen during auth redirect or deploy warm-up. No approval was sent.';
  }
  return 'Automatic scan reached /api/list-prs but did not receive an OK response' + (status ? ' (HTTP ' + status + ')' : '') + '. ' + (detail || 'No approval was sent.');
}

function renderPrSummaryBanner(d, attention, mergeCodeCount) {
  const prs = d.prs || [];
  const hasMergeCodeWork = Number(mergeCodeCount || 0) > 0;
  let newCount = 0;
  let holdCount = 0;
  let votedCount = 0;
  let releaseCount = 0;
  const buildCounts = {
    success: 0,
    failed: 0,
    running: 0,
    noData: 0
  };

  for (const pr of prs) {
    buildCounts[getBuildSummaryCategory(pr)]++;
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
  const fetchedMeta = document.getElementById('autoFetchedMeta');
  if (fetchedMeta) fetchedMeta.textContent = 'Fetched ' + fetchedStr;

  const renderAttentionSummaryBadge = (label, count, className) => {
    const safeCount = Number(count || 0);
    return '<span class="status-badge-custom ' + className + '">' + label + ' <strong>' + safeCount + '</strong></span>';
  };

  const renderBuildSummaryBadge = (key, label, count, className, title) => {
    const isActive = _buildSummaryFilter === key;
    return '<button type="button" class="status-badge-custom build-summary-filter ' + className +
      (isActive ? ' is-active' : '') + '" data-build-filter="' + key +
      '" aria-pressed="' + (isActive ? 'true' : 'false') +
      '" title="' + escapeHtml(title) +
      '" onclick="filterDashboardByBuild(\'' + key + '\')">' +
      label + ' <strong>' + Number(count || 0) + '</strong></button>';
  };

  let cardsHtml = '';

  // 1. Status Card (First)
  cardsHtml += '<div class="summary-card summary-card-status">' +
    '<span class="card-icon">📊</span>' +
    '<div class="card-body">' +
      '<span class="card-label">Status</span>' +
      '<div class="summary-status-group">' +
        '<span class="summary-status-group-label">Workflow</span>' +
        '<div class="card-badges">' +
          '<span class="status-badge-custom badge-blue">New <strong>' + newCount + '</strong></span>' +
          '<span class="status-badge-custom badge-orange">Hold <strong>' + holdCount + '</strong></span>' +
          '<span class="status-badge-custom badge-green">Voted <strong>' + votedCount + '</strong></span>' +
          '<span class="status-badge-custom badge-purple">Release <strong>' + releaseCount + '</strong></span>' +
        '</div>' +
      '</div>' +
      '<div class="summary-status-group">' +
        '<span class="summary-status-group-label">Build</span>' +
        '<div class="card-badges">' +
          renderBuildSummaryBadge('success', '✓ Success', buildCounts.success, 'badge-green', 'PRs whose latest build succeeded') +
          renderBuildSummaryBadge('failed', '✕ Failed', buildCounts.failed, 'badge-red', 'PRs whose latest build failed or completed unsuccessfully') +
          renderBuildSummaryBadge('running', '⏳ Running', buildCounts.running, 'badge-orange', 'PRs whose latest build is still running') +
          renderBuildSummaryBadge('noData', '○ No Data', buildCounts.noData, 'badge-slate', 'PRs without a recognized latest build status') +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';

  // 2. Attention Card (Second)
  cardsHtml += '<div class="summary-card summary-card-attention">' +
    '<span class="card-icon">⚠️</span>' +
    '<div class="card-body">' +
      '<span class="card-label">Attention</span>' +
      '<div class="card-badges">' +
        renderAttentionSummaryBadge('Critical', attention.critical, 'badge-red') +
        renderAttentionSummaryBadge('Warning', attention.warning, 'badge-orange') +
        renderAttentionSummaryBadge('Stale', attention.stale, 'badge-slate') +
      '</div>' +
    '</div>' +
  '</div>';

  cardsHtml += '<div class="summary-card mergecode-card' + (hasMergeCodeWork ? ' mergecode-card-active' : '') + '">' +
    '<span class="card-icon">🔗</span>' +
    '<div class="card-body">' +
      '<span class="card-label">MergeCode Manual</span>' +
      '<div class="mergecode-card-value">' +
        '<strong class="card-value text-amber">' + mergeCodeCount + ' PR</strong>' +
        (hasMergeCodeWork ? '<span class="mergecode-action-label">Action required</span>' : '') +
      '</div>' +
    '</div>' +
  '</div>';


  return '<div class="test-result result-success pr-summary-banner">' +
    '<div class="summary-cards-container">' +
      cardsHtml +
    '</div>' +
  '</div>';
}


function getBuildSummaryCategory(pr) {
  const snapshot = pr && pr.statusSnapshot || {};
  const buildResult = String(snapshot.buildResult || 'unknown').toLowerCase();
  const buildStatus = String(snapshot.buildStatus || 'unknown').toLowerCase();
  if (buildResult === 'succeeded' || buildResult === 'success') return 'success';
  if (buildResult === 'failed' || buildResult === 'error' ||
      buildResult === 'canceled' || buildResult === 'partiallysucceeded') return 'failed';
  if (buildResult === 'pending' || buildStatus === 'in_progress' ||
      buildStatus === 'not_started' || buildStatus === 'notstarted') return 'running';
  return 'noData';
}

function getBuildSummaryLabel(category) {
  return { success: 'Success', failed: 'Failed', running: 'Running', noData: 'No Data' }[category] || category;
}

window.filterDashboardByBuild = function(category) {
  _buildSummaryFilter = _buildSummaryFilter === category ? '' : category;
  document.querySelectorAll('.build-summary-filter').forEach(button => {
    const isActive = button.dataset.buildFilter === _buildSummaryFilter;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
  renderPrTable(_allPrs, true);
};

function renderPrTable(prs, preserveAllPrs) {
  if (!preserveAllPrs) _allPrs = prs || [];
  const displayedPrs = _buildSummaryFilter
    ? _allPrs.filter(pr => getBuildSummaryCategory(pr) === _buildSummaryFilter)
    : _allPrs;
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
  const prQueue = displayedPrs.filter(pr => !(pr.releaseApproval && pr.releaseApproval.status === 'pending'));
  const releaseQueue = displayedPrs.filter(pr => pr.releaseApproval && pr.releaseApproval.status === 'pending');

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
  document.getElementById('prMeta').textContent = prs.length + ' items' +
    (_buildSummaryFilter ? ' · Build: ' + getBuildSummaryLabel(_buildSummaryFilter) : '');
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
  document.getElementById('releaseMeta').textContent = prs.length + ' items' +
    (_buildSummaryFilter ? ' · Build: ' + getBuildSummaryLabel(_buildSummaryFilter) : '');
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
  return '<code class="release-branch-tag" title="' + escapeHtml(pr.targetBranch) + '">' + escapeHtml(targetFull) + '</code>';
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
    '<div class="rev-summary-row"><strong>Approved:</strong> ' + (a.approvedCount || 0) + ' / ' + (a.requiredCount || 0) + '</div>';
  if (data.policyFetched) {
    summaryHtml += '<div class="rev-summary-row"><strong>Branch Policy minimum:</strong> ' +
      (a.minApproversFromPolicy || 0) + '</div>';
  }
  summaryHtml += '<div class="rev-summary-row"><strong>Required reviewers in PR:</strong> ' +
      (a.requiredReviewerApproved || 0) + ' / ' + (a.requiredReviewerTotal || 0) + ' approved</div>';
  if (Array.isArray(a.requiredPendingNames) && a.requiredPendingNames.length > 0) {
    summaryHtml += '<div class="rev-summary-row rev-summary-alert"><strong>Pending required:</strong> ' +
      renderNameChips(a.requiredPendingNames, 'required-pending-chip') + '</div>';
  }
  if (Array.isArray(a.requiredRejectedNames) && a.requiredRejectedNames.length > 0) {
    summaryHtml += '<div class="rev-summary-row rev-summary-rejected"><strong>Rejected required:</strong> ' +
      renderNameChips(a.requiredRejectedNames, 'required-rejected-chip') + '</div>';
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
      const rowClass = r.isRequired && v <= -10
        ? ' class="reviewer-row-required-rejected"'
        : r.isRequired && v < 10
        ? ' class="reviewer-row-required-pending"'
        : '';
      listHtml += '<tr' + rowClass + '>' +
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

function renderNameChips(names, className) {
  return names
    .map(name => '<span class="' + className + '">' + escapeHtml(name) + '</span>')
    .join(' ');
}

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
window.openApproveModal = async function(prId, repositoryId) {
  if (!(await ensureAdoConnected())) return;
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
      if (r.status === 428 || d.connectUrl) {
        if (handleAdoAuthRequired(d)) return;
      }
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
  if (!(await ensureAdoConnected())) return;
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
      if (r.status === 428 || d.connectUrl) {
        if (handleAdoAuthRequired(d)) return;
      }
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
window.openRejectModal = async function(prId, repositoryId) {
  if (!(await ensureAdoConnected())) return;
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
      if (r.status === 428 || d.connectUrl) {
        if (handleAdoAuthRequired(d)) return;
      }
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
window._autoCompletedPrApprovals = loadAutoPrApprovalSet();

function loadAutoPrApprovalSet() {
  try {
    const values = JSON.parse(sessionStorage.getItem('autoCompletedPrApprovals') || '[]');
    return new Set(Array.isArray(values) ? values.map(String) : []);
  } catch (e) {
    return new Set();
  }
}

function rememberAutoPrApproval(prId) {
  const key = String(prId || '');
  if (!key) return;
  window._autoCompletedPrApprovals.add(key);
  sessionStorage.setItem('autoCompletedPrApprovals', JSON.stringify(Array.from(window._autoCompletedPrApprovals)));
}

function hasCompletedAutoPrApproval(prId) {
  return window._autoCompletedPrApprovals.has(String(prId || ''));
}

function resetAutoPrApprovalMemory() {
  window._autoCompletedPrApprovals = new Set();
  sessionStorage.removeItem('autoCompletedPrApprovals');
}

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
    resetAutoPrApprovalMemory();
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

  const bee = ensureAutoBeeMascot();
  if (bee) {
    const beeWrap = bee.closest('.auto-bee-wrap');
    const beeState = mode === 'active'
      ? {
        wrapClassName: 'auto-bee-wrap bee-flying',
        className: 'auto-bee-mascot bee-flying',
        src: '/assets/bee_fly.gif',
        alt: 'Auto approve bee is flying'
      }
      : mode === 'dry-run'
        ? {
          wrapClassName: 'auto-bee-wrap bee-read',
          className: 'auto-bee-mascot bee-read',
          src: '/assets/bee_read.gif',
          alt: 'Auto approve bee is reading'
        }
        : {
          wrapClassName: 'auto-bee-wrap bee-sleep',
          className: 'auto-bee-mascot bee-sleep',
          src: '/assets/bee_sleep.gif',
          alt: 'Auto approve bee is sleeping'
        };
    if (beeWrap) beeWrap.className = beeState.wrapClassName;
    bee.className = beeState.className;
    if (bee.getAttribute('src') !== beeState.src) bee.setAttribute('src', beeState.src);
    bee.setAttribute('alt', beeState.alt);
    bee.setAttribute('title', beeState.alt);
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

function ensureAutoBeeMascot() {
  let bee = document.getElementById('autoBeeMascot');
  if (bee) return bee;

  const indicator = document.getElementById('autoStatusIndicator');
  if (!indicator || !indicator.parentElement) return null;

  const wrap = document.createElement('span');
  wrap.className = 'auto-bee-wrap bee-sleep';
  wrap.setAttribute('aria-live', 'polite');

  bee = document.createElement('img');
  bee.id = 'autoBeeMascot';
  bee.className = 'auto-bee-mascot bee-sleep';
  bee.src = '/assets/bee_sleep.gif';
  bee.alt = 'Auto approve bee is sleeping';
  bee.width = 96;
  bee.height = 72;
  bee.draggable = false;

  wrap.appendChild(bee);
  const cssBee = document.createElement('span');
  cssBee.className = 'auto-bee-css';
  cssBee.setAttribute('aria-hidden', 'true');
  wrap.appendChild(cssBee);
  indicator.insertAdjacentElement('afterend', wrap);
  return bee;
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
      resetAutoPrApprovalMemory();
      window._autoPrApprovedCount = 0;
      window._autoReleaseApprovedCount = 0;
    } else {
      if (mode === 'active') {
        window._autoPrApprovedCount = 0;
        window._autoReleaseApprovedCount = 0;
        resetAutoPrApprovalMemory();
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
    if (_checkPrsInFlight) {
      writeToAutoConsole('Skipped automatic scan because the previous scan is still running.', 'info');
      return;
    }
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
  resetAutoPrApprovalMemory();
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
  while (consoleLog.children.length > AUTO_CONSOLE_MAX_ENTRIES) {
    consoleLog.removeChild(consoleLog.firstElementChild);
  }
  consoleLog.scrollTop = consoleLog.scrollHeight;
}

window.clearAutoConsole = function() {
  const consoleLog = document.getElementById('autoConsoleLog');
  if (!consoleLog) return;
  consoleLog.innerHTML = '<div class="console-placeholder">ไม่มีประวัติการสแกนในเซสชันนี้</div>';
}

function getAutoApprovalStagingPrefix() {
  const lastSync = getLastSync() || {};
  return String(lastSync.targetBranch || 'refs/heads/staging').toLowerCase();
}

function isAutoApprovalStagingBranch(targetBranch) {
  const targetRef = String(targetBranch || '').toLowerCase();
  const configuredPrefix = getAutoApprovalStagingPrefix();
  return targetRef.startsWith('refs/heads/staging') ||
    targetRef.startsWith('refs/heads/stag') ||
    targetRef.startsWith('refs/heads/stg') ||
    (configuredPrefix && targetRef.startsWith(configuredPrefix));
}

function getAutoPrEligibility(pr) {
  if (!pr || (typeof pr.id === 'string' && pr.id.startsWith('R'))) {
    return { eligible: false, candidate: false, reason: 'not a pull request' };
  }
  if (hasCompletedAutoPrApproval(pr.id)) {
    return { eligible: false, candidate: false, reason: 'already processed in this session' };
  }
  if (!isAutoApprovalStagingBranch(pr.targetBranch)) {
    return { eligible: false, candidate: false, reason: 'target is not staging' };
  }
  if (pr.isDraft === true) {
    return { eligible: false, candidate: true, reason: 'PR is draft' };
  }
  if (pr.isMergeCodeTarget === true) {
    return { eligible: false, candidate: true, reason: 'MergeCode branch requires manual ADO approval' };
  }
  if (pr.approvalHold && pr.approvalHold.active === true) {
    return { eligible: false, candidate: true, reason: 'Approval Hold is active' };
  }

  const myStatus = pr.myApproval && pr.myApproval.status ? String(pr.myApproval.status).toLowerCase() : '';
  if (myStatus !== 'not-approved') {
    return { eligible: false, candidate: false, reason: 'no pending approval for current user/group' };
  }

  const snapshot = pr.statusSnapshot || {};
  const buildResult = String(snapshot.buildResult || 'unknown').toLowerCase();
  const buildStatus = String(snapshot.buildStatus || 'unknown').toLowerCase();
  const hasBuild = buildResult && buildResult !== 'unknown' && buildResult !== 'no_status';
  const buildSuccess = !hasBuild || buildResult === 'succeeded' || buildStatus === 'succeeded';
  if (!buildSuccess) {
    if (buildResult === 'failed' || buildResult === 'error') {
      return { eligible: false, candidate: true, reason: 'build failed' };
    }
    return { eligible: false, candidate: true, reason: 'build is not ready (' + (buildResult || buildStatus || 'unknown') + ')' };
  }

  const policyStatus = String(snapshot.policyStatus || 'unknown').toLowerCase();
  const allowUnknownPolicyWithoutBuild = !hasBuild && policyStatus === 'unknown';
  const policyOk = policyStatus === 'approved' || policyStatus === 'pending' || allowUnknownPolicyWithoutBuild;
  if (!policyOk) {
    return { eligible: false, candidate: true, reason: 'policy is ' + (policyStatus || 'unknown') };
  }

  return {
    eligible: true,
    candidate: true,
    reason: allowUnknownPolicyWithoutBuild ? 'ready: no build status + policy unknown allowed' : 'ready',
    allowedUnknownPolicyWithoutBuild: allowUnknownPolicyWithoutBuild
  };
}

function getAutoReleaseEligibility(pr) {
  const r = pr && pr.releaseApproval || {};
  const hasPendingRelease = r.status === 'pending' && r.approvalId;
  if (!hasPendingRelease) {
    return { eligible: false, candidate: false, reason: 'no pending release approval' };
  }

  const definitionName = String(r.releaseDefinitionName || r.cdName || '').toLowerCase().trim();
  const isStagingDefinition = definitionName.startsWith('stg') ||
    definitionName.includes(' stg') ||
    definitionName.includes('-stg') ||
    definitionName.includes('_stg');
  if (!isStagingDefinition) {
    return { eligible: false, candidate: true, reason: 'release definition is not staging (' + (r.releaseDefinitionName || r.cdName || '-') + ')' };
  }

  if (pr.approvalHold && pr.approvalHold.active === true) {
    return { eligible: false, candidate: true, reason: 'Approval Hold is active' };
  }

  return { eligible: true, candidate: true, reason: 'ready' };
}

function logNoAutoApprovalEligible(skippedPrs, skippedReleases) {
  writeToAutoConsole('ผลสแกน: ไม่พบ PR หรือ Release ที่รออนุมัติและผ่านเกณฑ์การตรวจสอบ', 'info');

  const skipped = []
    .concat((skippedPrs || []).map(item => ({
      label: 'PR #' + item.pr.id,
      reason: item.reason
    })))
    .concat((skippedReleases || []).map(item => {
      const r = item.pr.releaseApproval || {};
      const idLabel = typeof item.pr.id === 'string' && item.pr.id.startsWith('R')
        ? 'Virtual Release ' + item.pr.id
        : 'PR #' + item.pr.id;
      return {
        label: idLabel + ' (Release: ' + (r.releaseName || '-') + ')',
        reason: item.reason
      };
    }));

  skipped.slice(0, 5).forEach(item => {
    writeToAutoConsole(item.label + ' - ข้าม Auto Approve: ' + item.reason, 'info');
  });
  if (skipped.length > 5) {
    writeToAutoConsole('ยังมีรายการที่ถูกข้ามอีก ' + (skipped.length - 5) + ' รายการ', 'info');
  }
}

function getAutoApprovalReadyNote(pr) {
  const result = getAutoPrEligibility(pr);
  return result && result.allowedUnknownPolicyWithoutBuild
    ? ' (อนุญาตพิเศษ: No build status + Policy unknown)'
    : '';
}

async function evaluateAutoApprovals(prs) {
  if (!window._autoMode || window._autoMode === 'normal') return;
  const list = Array.isArray(prs) ? prs : [];

  const prEligibility = list.map(pr => ({ pr, result: getAutoPrEligibility(pr) }));
  const eligiblePrs = prEligibility
    .filter(item => item.result.eligible)
    .map(item => Object.assign({}, item.pr, {
      _autoEligibilityReason: item.result.reason,
      _autoAllowedUnknownPolicyWithoutBuild: item.result.allowedUnknownPolicyWithoutBuild === true
    }));
  const skippedPrs = prEligibility
    .filter(item => item.result.candidate && !item.result.eligible)
    .map(item => ({ pr: item.pr, reason: item.result.reason }));

  const releaseEligibility = list.map(pr => ({ pr, result: getAutoReleaseEligibility(pr) }));
  const eligibleReleases = releaseEligibility
    .filter(item => item.result.eligible)
    .map(item => item.pr);
  const skippedReleases = releaseEligibility
    .filter(item => item.result.candidate && !item.result.eligible)
    .map(item => ({ pr: item.pr, reason: item.result.reason }));

  if (window._autoMode === 'dry-run') {
    if (eligiblePrs.length === 0 && eligibleReleases.length === 0) {
      logNoAutoApprovalEligible(skippedPrs, skippedReleases);
      return;
    }
    
    eligiblePrs.forEach(pr => {
      writeToAutoConsole(`PR #${pr.id} - ผ่านเกณฑ์การตรวจวิเคราะห์${getAutoApprovalReadyNote(pr)} (พร้อมส่ง Approve PR)`, 'dryrun');
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
      logNoAutoApprovalEligible(skippedPrs, skippedReleases);
      return;
    }
    for (const pr of eligiblePrs) {
      if (hasCompletedAutoPrApproval(pr.id)) continue;
      if (window._processingAutoApprovals[pr.id]) continue;
      window._processingAutoApprovals[pr.id] = true;
      
      writeToAutoConsole(`กำลังดำเนินการอนุมัติ PR #${pr.id} อัตโนมัติ${getAutoApprovalReadyNote(pr)}...`, 'info');
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
          rememberAutoPrApproval(pr.id);
          if (response.data.skipped || response.data.lockStatus === 'completed') {
            const by = response.data.approvedBy || response.data.user || 'another approver';
            writeToAutoConsole(`PR #${pr.id} - ข้าม เพราะมีการอนุมัติไปแล้วโดย ${by}`, 'info');
          } else {
            window._autoPrApprovedCount += 1;
            sessionStorage.setItem('autoPrApprovedCount', window._autoPrApprovedCount);
            updateStatsUI();
            writeToAutoConsole(`PR #${pr.id} - อนุมัติสำเร็จ! (Auto-Complete: ${response.data.autoComplete ? 'เปิดใช้งาน' : 'ข้าม'})`, 'active');
          }
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
  bind('btnConnectAdo', startAdoConnect);
  bind('btnDisconnectAdo', disconnectAdo);
  await loadAdoAuthStatus();
  consumeAdoAuthCallbackResult();
  
  // Intercept page reload/navigation when auto mode is active
  window.addEventListener('beforeunload', (e) => {
    if (window._autoMode === 'dry-run' || window._autoMode === 'active') {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });
  
  await initAutoApprove();
  const resumedAutoMode = await promptAutoResumeAfterAuth();
  if (!resumedAutoMode) {
    await checkPrs();
  }
})();
