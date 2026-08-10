import {
  safeFetchJson, escapeHtml, showBox, setButtonLoading,
  renderSkeletonRows, bind, formatDate, renderBranchCell,
  initPage, saveLastSync, renderCompletedPrTable, renderRecentlyApprovedRows
} from './core.js';

// ===== Activity Page =====
async function loadPrActivity(page) {
  if (!document.getElementById('completedSection')) return;
  const nextPage = Math.max(Number(page) || 0, 0);
  window._recentlyApprovedPage = nextPage;
  setButtonLoading('btnRefreshActivity', true, 'Loading...');
  
  const tbody = document.getElementById('completedTableBody');
  if (tbody) tbody.innerHTML = renderSkeletonRows(10, 5);
  
  showBox('activityResult', '<div class="test-result result-info">⏳ Loading PR activity...</div>');

  try {
    const params = new URLSearchParams();
    params.set('includeActivity', 'true');
    params.set('activityPage', String(nextPage));
    params.set('activityPageSize', '10');
    const statusFilter = (document.getElementById('activityFilterStatus') || {}).value || '';
    const sourceFilter = (document.getElementById('activityFilterSource') || {}).value || '';
    const activityQuery = String((document.getElementById('activityQuery') || {}).value || '').trim();
    const activityQueryType = (document.getElementById('activityQueryType') || {}).value || 'auto';
    if (statusFilter) params.set('activityStatus', statusFilter);
    if (sourceFilter) params.set('activitySource', sourceFilter);
    if (activityQuery) {
      params.set('activityQuery', activityQuery);
      params.set('activityQueryType', activityQueryType);
    }
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
    const reconcileHtml = renderActivityReconcileSummary(window._activityReconcileResult);
    window._activityReconcileResult = null;
    showBox('activityResult',
      '<div class="test-result result-success">✅ Loaded <strong>' +
      escapeHtml(d.completedTotalMatched || 0) +
      '</strong> PRs from approval logs in the last ' +
      escapeHtml(d.completedLookbackHours || 24) +
      ' hours</div>' +
      reconcileHtml +
      renderActivityLookupSummary(d.activityLookup, d.completedLookbackHours || 24)
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

function renderActivityLookupSummary(lookup, lookbackHours) {
  if (!lookup) return '';
  if (!lookup.found) {
    return '<div class="test-result result-error activity-lookup-summary">' +
      '<div class="activity-lookup-title">❌ ไม่พบรายการที่ค้นหา</div>' +
      '<div>' + escapeHtml(lookup.error || 'ไม่พบ PR หรือ Build ที่ระบุ') + '</div>' +
      '</div>';
  }

  const pr = lookup.pr || {};
  const build = lookup.build || {};
  const reasons = Array.isArray(lookup.reasons) ? lookup.reasons : [];
  const reasonLabels = {
    'target-branch-not-staging': 'Target branch ไม่อยู่ภายใต้ staging',
    'reviewer-group-not-found': 'ไม่พบ reviewer group IT Support Approve',
    'approval-log-missing': 'พบ PR ใน Azure DevOps แต่ยังไม่มี Approval Log ใน SharePoint',
    'approval-log-older-than-lookback': 'Approval Log เก่ากว่าช่วง ' + lookbackHours + ' ชั่วโมง',
    'sharepoint-log-query-failed': 'ไม่สามารถตรวจ SharePoint Approval Log ได้',
    'build-has-no-linked-pr': 'Build นี้ไม่มี PR ที่เชื่อมโยงใน trigger information',
    'linked-pr-not-found-or-inaccessible': 'ไม่พบหรือไม่มีสิทธิ์อ่าน PR ที่เชื่อมกับ Build'
  };
  const reasonHtml = reasons.length
    ? '<ul class="activity-lookup-reasons">' + reasons.map(reason =>
      '<li>' + escapeHtml(reasonLabels[reason] || reason) + '</li>'
    ).join('') + '</ul>'
    : '';
  const statusClass = lookup.eligibleForActivity ? 'result-success' : 'result-info';
  const title = lookup.eligibleForActivity
    ? '✅ PR #' + escapeHtml(lookup.prId) + ' อยู่ใน Activity'
    : 'ℹ️ พบ PR #' + escapeHtml(lookup.prId) + ' แต่ยังไม่เข้าเงื่อนไข Activity';
  const prLink = pr.url
    ? '<a href="' + escapeHtml(pr.url) + '" target="_blank" rel="noopener">Open PR</a>'
    : '';
  const buildLink = build.url
    ? '<a href="' + escapeHtml(build.url) + '" target="_blank" rel="noopener">Open Build #' +
      escapeHtml(build.id) + '</a>'
    : '';
  return '<div class="test-result ' + statusClass + ' activity-lookup-summary">' +
    '<div class="activity-lookup-title">' + title + '</div>' +
    '<div class="activity-lookup-details">' +
      '<span>Repository: <strong>' + escapeHtml(pr.repository || '-') + '</strong></span>' +
      '<span>Status: <strong>' + escapeHtml(pr.status || '-') + '</strong></span>' +
      '<span>Branch: <strong>' + escapeHtml(pr.targetBranch || '-') + '</strong></span>' +
      '<span>Approval Log: <strong>' + (lookup.approvalLogWithinLookback ? 'ล่าสุด' : lookup.approvalLogFound ? 'เกินช่วงเวลา' : 'ไม่พบ') + '</strong></span>' +
      prLink + buildLink +
    '</div>' +
    (lookup.error ? '<div>' + escapeHtml(lookup.error) + '</div>' : '') +
    reasonHtml +
  '</div>';
}

function renderActivityReconcileSummary(result) {
  if (!result) return '';
  const cls = result.ok ? 'result-success' : 'result-error';
  return '<div class="test-result ' + cls + '">' +
    (result.ok ? '✅' : '❌') + ' Reconciliation checked <strong>' +
    escapeHtml(result.checkedPrs || 0) + '</strong> PRs and inserted <strong>' +
    escapeHtml(result.inserted || 0) + '</strong> missing approval logs.' +
    (result.errors && result.errors.length ? '<br/><small>' + escapeHtml(result.errors.join(' | ')) + '</small>' : '') +
    '</div>';
}

function bindActivityFilters() {
  ['activityFilterStatus', 'activityFilterSource'].forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.dataset.bound === 'true') return;
    el.dataset.bound = 'true';
    el.addEventListener('change', () => loadPrActivity(0));
  });
}

function bindActivitySearch() {
  bind('btnSearchActivity', () => loadPrActivity(0));
  bind('btnClearActivitySearch', () => {
    const query = document.getElementById('activityQuery');
    const type = document.getElementById('activityQueryType');
    if (query) query.value = '';
    if (type) type.value = 'auto';
    loadPrActivity(0);
  });
  const query = document.getElementById('activityQuery');
  if (query && query.dataset.bound !== 'true') {
    query.dataset.bound = 'true';
    query.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        loadPrActivity(0);
      }
    });
  }
}

async function reconcileActivity() {
  setButtonLoading('btnReconcileActivity', true, 'Reconciling...');
  try {
    const r = await safeFetchJson('/api/activity-reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lookbackHours: 48, maxPrs: 100 }),
      timeoutMs: 120000
    });
    if (!r.ok || !r.data) {
      throw new Error((r.data && (r.data.error || r.data.detail)) || 'Reconciliation failed (HTTP ' + r.status + ')');
    }
    window._activityReconcileResult = r.data;
    await loadPrActivity(0);
  } catch (err) {
    showBox('activityResult', '<div class="test-result result-error">❌ ' + escapeHtml(err.message) + '</div>');
  } finally {
    setButtonLoading('btnReconcileActivity', false);
  }
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
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:22px;color:#9ca3af">— No approval log PRs found in the last ' + escapeHtml(lookbackHours) + ' hours —</td></tr>';
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

// Page initialization
(async function init() {
  await initPage();
  const roles = window._currentUser && Array.isArray(window._currentUser.roles) ? window._currentUser.roles : [];
  const reconcileButton = document.getElementById('btnReconcileActivity');
  if (reconcileButton && roles.some(role => String(role).toLowerCase() === 'admin')) {
    reconcileButton.hidden = false;
  }
  bind('btnRefreshActivity', loadPrActivity);
  bind('btnReconcileActivity', reconcileActivity);
  bindActivityFilters();
  bindActivitySearch();
  await loadPrActivity();
})();
