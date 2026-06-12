import {
  safeFetchJson, escapeHtml, showBox, setButtonLoading,
  bind, formatDateTime, initPage
} from './core.js';

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

// Page initialization
(async function init() {
  await initPage();
  bind('btnMergeLookup', checkMergeLookup);
  const input = document.getElementById('mergePrId');
  if (input) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') checkMergeLookup();
    });
  }
})();