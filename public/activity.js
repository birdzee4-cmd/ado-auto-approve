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

// Page initialization
(async function init() {
  await initPage();
  bind('btnRefreshActivity', loadPrActivity);
  bindActivityFilters();
  await loadPrActivity();
})();