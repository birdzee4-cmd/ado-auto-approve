// ============================================
// ADO Auto-Approve - Git Tag Hub & Bulk Tagging Script
// ============================================

let _allDeployments = [];
let _repositories = [];
let _repositoryMap = new Map(); // Name -> Repo Object
let _currentRepoBranches = [];
let _currentRepoId = '';
let _currentRepoName = '';
let _organization = '';
let _project = '';
let _selectedDeployment = null; // For single tag modal

window._currentUser = {
  roles: [],
  requiredRole: 'it_support_approve',
  canApprovePrs: false
};

(async function init() {
  try {
    // 1) Authenticate user
    const authResp = await fetch('/.auth/me');
    const authData = await authResp.json();
    if (!authData.clientPrincipal) {
      window.location.href = '/';
      return;
    }
    const principal = authData.clientPrincipal;
    setText('userName', principal.userDetails || 'Unknown');

    // 2) Get user info & permissions
    try {
      const userResp = await fetch('/api/userinfo');
      if (userResp.ok) {
        const userData = await userResp.json();
        const roles = Array.isArray(userData.userRoles) ? userData.userRoles : [];
        window._currentUser.roles = roles;
        window._currentUser.requiredRole = userData.requiredRole || window._currentUser.requiredRole;
        window._currentUser.canApprovePrs = !!(userData.permissions && userData.permissions.canApprovePrs);
      }
    } catch (e) {
      console.warn('Unable to load user role permissions:', e);
    }

    // 3) Bind UI events
    bind('btnRefreshDeployments', () => loadDeployments(false));
    bind('btnSearchDeployments', filterAndRenderDeploymentsTable);
    bind('btnConfirmCreateTag', doCreateTagSingle);

    // Bind Tabs
    bind('tabDeployments', () => switchTab('deployments'));
    bind('tabAllRepos', () => switchTab('allRepos'));

    // Search enter-key
    const searchInput = document.getElementById('deploySearchKeyword');
    if (searchInput) {
      searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') filterAndRenderDeploymentsTable();
      });
    }

    // Status select change filter
    const statusSelect = document.getElementById('deployFilterTagStatus');
    if (statusSelect) {
      statusSelect.addEventListener('change', filterAndRenderDeploymentsTable);
    }

    // Repo Tab Filters & Events
    const repoSearch = document.getElementById('repoSearchInput');
    if (repoSearch) {
      repoSearch.addEventListener('input', handleRepoSelection);
    }

    const branchSearch = document.getElementById('repoBranchSearchInput');
    if (branchSearch) {
      branchSearch.addEventListener('input', filterAndRenderRepoRefsTable);
    }

    const repoTagFilter = document.getElementById('repoTagFilter');
    if (repoTagFilter) {
      repoTagFilter.addEventListener('change', filterAndRenderRepoRefsTable);
    }

    const templateInput = document.getElementById('repoTagTemplateInput');
    if (templateInput) {
      templateInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') applyNamingTemplate();
      });
    }

    bind('btnApplyTemplate', applyNamingTemplate);

    // Checkbox select all
    const selectAllRefsCheckbox = document.getElementById('selectAllRefs');
    if (selectAllRefsCheckbox) {
      selectAllRefsCheckbox.addEventListener('change', handleSelectAllRefs);
    }

    // Bulk action panel triggers
    bind('btnBulkTag', triggerBulkTagging);
    bind('btnCancelBulkSelect', clearBulkSelection);
    bind('btnBulkProgressDone', () => {
      closeModal('bulkProgressModal');
      if (_currentRepoId) {
        loadRepoRefs(_currentRepoId, _currentRepoName); // Reload branches to show new tags
      }
    });

    // Close buttons for modals
    document.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', () => closeModal(el.getAttribute('data-close')));
    });
    document.querySelectorAll('.modal-backdrop').forEach(bd => {
      bd.addEventListener('click', (e) => {
        if (e.target === bd && bd.id !== 'bulkProgressModal') closeModal(bd.id);
      });
    });

    // 4) Initial Loads
    await loadDeployments(true);
    await loadRepositoriesList();

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
function showBox(id, html, type) {
  const box = document.getElementById(id);
  if (!box) return;
  box.hidden = false;
  box.className = type ? 'test-result result-' + type : '';
  box.innerHTML = html;
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
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.hidden = false;
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.hidden = true;
}
function formatDateThai(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    return d.toLocaleString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  } catch (e) {
    return iso;
  }
}

// ===== Tab Management =====
function switchTab(tabName) {
  const tabDeployments = document.getElementById('tabDeployments');
  const tabAllRepos = document.getElementById('tabAllRepos');
  const sectionDeployments = document.getElementById('sectionDeployments');
  const sectionAllRepos = document.getElementById('sectionAllRepos');

  // Hide floating panel when switching tabs
  const bulkPanel = document.getElementById('floatingBulkPanel');
  if (bulkPanel) bulkPanel.classList.remove('show');

  if (tabName === 'deployments') {
    tabDeployments.classList.add('active');
    tabAllRepos.classList.remove('active');
    sectionDeployments.hidden = false;
    sectionAllRepos.hidden = true;
  } else {
    tabDeployments.classList.remove('active');
    tabAllRepos.classList.add('active');
    sectionDeployments.hidden = true;
    sectionAllRepos.hidden = false;
  }
}

// ===== Load Repositories List (Tab 2 Combobox) =====
async function loadRepositoriesList() {
  try {
    const resp = await fetch('/api/list-repositories');
    if (!resp.ok) {
      console.error('Failed to load repositories list:', resp.status);
      return;
    }
    const data = await resp.json();
    if (data.ok && Array.isArray(data.repositories)) {
      _repositories = data.repositories;
      
      const datalist = document.getElementById('repoList');
      if (datalist) {
        datalist.innerHTML = '';
        _repositoryMap.clear();
        for (const repo of _repositories) {
          _repositoryMap.set(repo.name.toLowerCase(), repo);
          
          const option = document.createElement('option');
          option.value = repo.name;
          datalist.appendChild(option);
        }
      }
    }
  } catch (err) {
    console.error('Error in loadRepositoriesList:', err);
  }
}

// ===== Handle Repository Selection =====
function handleRepoSelection() {
  const inputVal = (document.getElementById('repoSearchInput').value || '').trim().toLowerCase();
  const matchedRepo = _repositoryMap.get(inputVal);
  
  if (matchedRepo) {
    // Repository matched exactly, load its branches on-demand
    loadRepoRefs(matchedRepo.id, matchedRepo.name);
  }
}

// ===== Fetch Branches & Tags for Repo On-Demand =====
async function loadRepoRefs(repoId, repoName) {
  _currentRepoId = repoId;
  _currentRepoName = repoName;

  const tbody = document.getElementById('allReposTableBody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:#9ca3af">⏳ กำลังโหลดรายชื่อสาขาและแท็กสำหรับคลัง <strong>${escapeHtml(repoName)}</strong>...</td></tr>`;
  }

  // Reset check all checkbox
  const selectAllRefsCheckbox = document.getElementById('selectAllRefs');
  if (selectAllRefsCheckbox) selectAllRefsCheckbox.checked = false;
  updateBulkPanelState();

  try {
    const resp = await fetch(`/api/list-repo-refs?repositoryId=${encodeURIComponent(repoId)}`);
    if (!resp.ok) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:#dc2626">❌ โหลดข้อมูลล้มเหลว (HTTP ${resp.status})</td></tr>`;
      }
      return;
    }
    const data = await resp.json();
    if (data.ok && Array.isArray(data.branches)) {
      _currentRepoBranches = data.branches;
      filterAndRenderRepoRefsTable();
    } else {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:#dc2626">❌ ข้อมูลตอบกลับผิดพลาด: ${escapeHtml(data.error || 'Unknown')}</td></tr>`;
      }
    }
  } catch (err) {
    console.error('Error in loadRepoRefs:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:#dc2626">❌ เกิดข้อผิดพลาด: ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

// ===== Filter and Render Repository Refs =====
function filterAndRenderRepoRefsTable() {
  const branchKeyword = (document.getElementById('repoBranchSearchInput').value || '').trim().toLowerCase();
  const tagFilter = document.getElementById('repoTagFilter').value || 'all';

  const filtered = _currentRepoBranches.filter(b => {
    const matchesKeyword = !branchKeyword || b.branchName.toLowerCase().includes(branchKeyword);
    
    let matchesTag = true;
    if (tagFilter === 'tagged') {
      matchesTag = b.isTagged === true;
    } else if (tagFilter === 'untagged') {
      matchesTag = b.isTagged === false;
    }

    return matchesKeyword && matchesTag;
  });

  renderRepoRefsTable(filtered);
}

// ===== Render Repo Branches Grid =====
function renderRepoRefsTable(branches) {
  const tbody = document.getElementById('allReposTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (branches.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:#9ca3af">— ไม่พบสาขาที่ตรงตามตัวกรองสำหรับคลัง ${_currentRepoName} —</td></tr>`;
    return;
  }

  const canApprove = window._currentUser && window._currentUser.canApprovePrs === true;
  const template = (document.getElementById('repoTagTemplateInput').value || '').trim();

  branches.forEach((b, index) => {
    const tr = document.createElement('tr');
    const shortSha = b.commitSha.substring(0, 8);
    
    const commitUrl = _organization && _project && _currentRepoName
      ? `https://dev.azure.com/${_organization}/${_project}/_git/${_currentRepoName}/commit/${b.commitSha}`
      : null;
    const branchUrl = _organization && _project && _currentRepoName
      ? `https://dev.azure.com/${_organization}/${_project}/_git/${_currentRepoName}?version=GB${encodeURIComponent(b.branchName)}`
      : null;

    // Generate smart suggestion tag
    const suggestedTagName = generateSuggestedTagName(_currentRepoName, b.branchName, template);

    // Render Tag badge
    let tagBadgeHtml = '';
    if (b.isTagged) {
      tagBadgeHtml = `<span class="tag-badge tag-badge-ok" title="Tagged with: ${escapeHtml(b.tagName)}">✅ Tag: ${escapeHtml(b.tagName)}</span>`;
    } else {
      tagBadgeHtml = '<span class="tag-badge tag-badge-none">○ No Tag</span>';
    }

    // Render checkbox (disabled if already tagged)
    const checkboxHtml = b.isTagged
      ? `<input type="checkbox" disabled style="cursor:not-allowed; opacity:0.4;" />`
      : `<input type="checkbox" class="ref-select-checkbox" data-index="${index}" style="cursor:pointer; width:16px; height:16px;" onchange="updateBulkPanelState()" />`;

    // Action button
    let actionBtnHtml = '';
    if (b.isTagged) {
      actionBtnHtml = `<button class="btn-mini btn-mini-tag" disabled title="Commit นี้ผ่านการทำ Tag แล้ว">🏷&nbsp;Tagged</button>`;
    } else {
      if (canApprove) {
        actionBtnHtml = `<button class="btn-mini btn-mini-tag" onclick="openTagConfirmModalFromRefBrowser('${escapeHtml(b.commitSha)}', '${escapeHtml(_currentRepoName)}', '${escapeHtml(b.branchName)}', ${index})">🏷&nbsp;Tag</button>`;
      } else {
        actionBtnHtml = `<button class="btn-mini btn-mini-tag" disabled title="คุณไม่มีสิทธิ์ในการสร้าง Tag (ต้องมี Role: it_support_approve)">🏷&nbsp;Tag</button>`;
      }
    }

    const commitLinkHtml = commitUrl 
      ? `<a href="${commitUrl}" target="_blank" rel="noopener" class="pr-link" style="font-family: monospace;">${shortSha}</a>`
      : `<code style="font-family: monospace;">${shortSha}</code>`;

    const branchLinkHtml = branchUrl
      ? `<a href="${branchUrl}" target="_blank" rel="noopener" class="pr-link" style="font-family: monospace; font-size:11px;">${escapeHtml(b.branchName)}</a>`
      : `<code style="font-family: monospace; font-size:11px;">${escapeHtml(b.branchName)}</code>`;

    // Tag name text input (disabled if tagged)
    const tagInputHtml = b.isTagged
      ? `<input type="text" class="tag-input" disabled value="${escapeHtml(b.tagName)}" style="background:#f3f4f6; color:#9ca3af; font-weight:500;" />`
      : `<input type="text" id="tagInput_${index}" class="tag-input ref-tag-name-input" data-index="${index}" value="${escapeHtml(suggestedTagName)}" placeholder="ชื่อ Tag ที่จะสร้าง..." />`;

    tr.innerHTML = `
      <td style="text-align:center;">${checkboxHtml}</td>
      <td><strong>${escapeHtml(_currentRepoName)}</strong></td>
      <td>
        <div class="branch-stack">
          <div class="branch-line">
            <span></span>
            ${branchLinkHtml}
          </div>
        </div>
      </td>
      <td>${commitLinkHtml}</td>
      <td>${tagInputHtml}</td>
      <td>${tagBadgeHtml}</td>
      <td class="pr-actions-cell">
        <div class="action-cell">
          ${actionBtnHtml}
          ${commitUrl ? `<a href="${commitUrl}" target="_blank" rel="noopener" class="btn-mini btn-mini-link" title="ดู Commit ใน Azure DevOps">🔗 ADO</a>` : ''}
        </div>
      </td>
    `;

    // Save initial object values directly in elements to read later
    tr.dataset.branchName = b.branchName;
    tr.dataset.commitSha = b.commitSha;
    tr.dataset.repoName = _currentRepoName;

    tbody.appendChild(tr);
  });
}

// ===== Generate Tag Name dynamically based on templates =====
function generateSuggestedTagName(repoName, branchName, template) {
  if (!template) template = '{repo}_{branch}';
  
  // Extract version if available (e.g. VC12.00 or V12)
  let version = 'N/A';
  const cleanRest = branchName;
  const versionMatch = cleanRest.match(/_VC([\d.]+)/i) || 
                       cleanRest.match(/_V([\d.]+)/i) || 
                       cleanRest.match(/_Version_([\d.]+)/i);
  if (versionMatch) {
    version = `VC${versionMatch[1]}`;
  }

  // Parse template
  let result = template
    .replace(/{repo}/g, repoName)
    .replace(/{branch}/g, branchName)
    .replace(/{version}/g, version);

  // Clean tags (Git ref rules: no spaces, clean special characters)
  result = result.trim().replace(/\s+/g, '_');
  // strip some characters that git tags won't like
  result = result.replace(/[^a-zA-Z0-9_\-\.\/]/g, '');
  
  return result;
}

// ===== Apply Naming Template to all input fields in Refs Browser =====
function applyNamingTemplate() {
  const template = (document.getElementById('repoTagTemplateInput').value || '').trim();
  if (!template) return;

  const inputs = document.querySelectorAll('.ref-tag-name-input');
  inputs.forEach(input => {
    const idx = parseInt(input.dataset.index);
    const branch = _currentRepoBranches[idx];
    if (branch && !branch.isTagged) {
      const suggested = generateSuggestedTagName(_currentRepoName, branch.branchName, template);
      input.value = suggested;
    }
  });
}

// ===== Handle Checkbox Header (Select All) =====
function handleSelectAllRefs() {
  const selectAll = document.getElementById('selectAllRefs').checked;
  const checkboxes = document.querySelectorAll('.ref-select-checkbox');
  checkboxes.forEach(cb => {
    if (!cb.disabled) {
      cb.checked = selectAll;
    }
  });
  updateBulkPanelState();
}

// ===== Update Floating Bulk Operations Panel =====
window.updateBulkPanelState = function() {
  const checkboxes = document.querySelectorAll('.ref-select-checkbox:checked');
  const count = checkboxes.length;
  
  setText('bulkSelectedCount', count);
  
  const bulkPanel = document.getElementById('floatingBulkPanel');
  if (bulkPanel) {
    if (count > 0 && window._currentUser && window._currentUser.canApprovePrs) {
      bulkPanel.classList.add('show');
    } else {
      bulkPanel.classList.remove('show');
    }
  }

  // Sync Select All checkbox header
  const totalSelectable = document.querySelectorAll('.ref-select-checkbox').length;
  const selectAllRefsCheckbox = document.getElementById('selectAllRefs');
  if (selectAllRefsCheckbox) {
    selectAllRefsCheckbox.checked = (totalSelectable > 0 && count === totalSelectable);
  }
};

// ===== Clear checkbox selection =====
function clearBulkSelection() {
  const checkboxes = document.querySelectorAll('.ref-select-checkbox');
  checkboxes.forEach(cb => cb.checked = false);
  const selectAllRefsCheckbox = document.getElementById('selectAllRefs');
  if (selectAllRefsCheckbox) selectAllRefsCheckbox.checked = false;
  updateBulkPanelState();
}

// ===== Open Tag Confirm Modal from Ref Browser =====
window.openTagConfirmModalFromRefBrowser = function(commitSha, repoName, branchName, index) {
  // Read value from tag input box corresponding to row
  const inputEl = document.getElementById(`tagInput_${index}`);
  const tagName = inputEl ? inputEl.value.trim() : `${repoName}_${branchName}`;

  _selectedDeployment = { commitSha, projectName: repoName, version: branchName, repositoryName: repoName };

  setText('modalWhitelabelName', repoName);
  setText('modalVersion', branchName);
  setText('modalCommitSha', commitSha);

  const modalInput = document.getElementById('modalTagNameInput');
  if (modalInput) {
    modalInput.value = tagName;
  }

  openModal('confirmTagModal');
};

// ===== API: Load Deployments (Tab 1 History) =====
async function loadDeployments(isSilent) {
  if (!isSilent) {
    setButtonLoading('btnRefreshDeployments', true, 'Loading...');
    showBox('deploymentResult', '<div class="test-result result-info">⏳ กำลังเรียกข้อมูลประวัติการขึ้นระบบจาก Azure DevOps...</div>');
  }

  try {
    const resp = await fetch('/api/list-deployments');
    const text = await resp.text();
    let r = { ok: resp.ok, status: resp.status, data: null };
    try { r.data = JSON.parse(text); } catch (e) {}

    if (!r.ok || !r.data || !r.data.ok) {
      const errDetail = r.data && r.data.error ? r.data.error : 'Unknown error';
      const errDetailMsg = r.data && r.data.detail ? `<br/><small style="color: #dc2626; font-weight: bold;">Detail: ${escapeHtml(r.data.detail)}</small>` : '';
      const hint = r.data && r.data.hint ? `<br/><small>${r.data.hint}</small>` : '';
      showBox('deploymentResult', `❌ ${escapeHtml(errDetail)}${errDetailMsg}${hint}`, 'error');
      return;
    }

    const d = r.data;
    console.log('list-deployments debug:', d.debug);
    _allDeployments = d.deployments || [];
    _organization = d.organization || '';
    _project = d.project || '';

    // Calculate stats
    calculateStats(_allDeployments);

    if (!isSilent) {
      showBox('deploymentResult', `✅ โหลดข้อมูลสำเร็จ พบประวัติการขึ้นระบบทั้งหมด <strong>${_allDeployments.length}</strong> รายการ`, 'success');
      setTimeout(() => {
        const resultBox = document.getElementById('deploymentResult');
        if (resultBox) resultBox.hidden = true;
      }, 4000);
    }

    filterAndRenderDeploymentsTable();

  } catch (err) {
    console.error('Failed to load deployments:', err);
    showBox('deploymentResult', `❌ เกิดข้อผิดพลาด: ${escapeHtml(err.message)}`, 'error');
  } finally {
    if (!isSilent) {
      setButtonLoading('btnRefreshDeployments', false);
    }
  }
}

function calculateStats(deployments) {
  setText('statTotalDeployments', deployments.length);

  // Unique Whitelabels
  const uniqueWhitelabels = new Set(deployments.map(d => d.projectName));
  setText('statTotalWhitelabels', uniqueWhitelabels.size);

  // Tagged Ratio
  const taggedCount = deployments.filter(d => d.isTagged).length;
  const untaggedCount = deployments.length - taggedCount;
  setText('statTaggedRatio', `${taggedCount} / ${untaggedCount}`);
}

function filterAndRenderDeploymentsTable() {
  const keyword = (document.getElementById('deploySearchKeyword').value || '').trim().toLowerCase();
  const filterTag = (document.getElementById('deployFilterTagStatus').value || 'all');

  const filtered = _allDeployments.filter(d => {
    const matchesKeyword = !keyword || 
      d.projectName.toLowerCase().includes(keyword) || 
      d.version.toLowerCase().includes(keyword) || 
      d.commitSha.toLowerCase().includes(keyword) ||
      d.branchName.toLowerCase().includes(keyword);

    let matchesTag = true;
    if (filterTag === 'tagged') {
      matchesTag = d.isTagged === true;
    } else if (filterTag === 'untagged') {
      matchesTag = d.isTagged === false;
    }

    return matchesKeyword && matchesTag;
  });

  renderDeploymentsTable(filtered);
}

function renderDeploymentsTable(deployments) {
  const tbody = document.getElementById('deploymentTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (deployments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:#9ca3af">— ไม่พบรายการประวัติการขึ้นระบบตามเงื่อนไขที่ค้นหา —</td></tr>';
    return;
  }

  const canApprove = window._currentUser && window._currentUser.canApprovePrs === true;

  for (const d of deployments) {
    const tr = document.createElement('tr');

    const formattedTime = formatDateThai(d.timestamp);
    const shortSha = d.commitSha.substring(0, 8);
    const commitUrl = _organization && _project && d.repositoryName
      ? `https://dev.azure.com/${_organization}/${_project}/_git/${d.repositoryName}/commit/${d.commitSha}`
      : null;
    const branchUrl = _organization && _project && d.repositoryName
      ? `https://dev.azure.com/${_organization}/${_project}/_git/${d.repositoryName}?version=GB${encodeURIComponent(d.branchName)}`
      : null;

    let tagBadgeHtml = '';
    if (d.isTagged) {
      tagBadgeHtml = `<span class="tag-badge tag-badge-ok" title="Tagged with: ${escapeHtml(d.tagName)}">✅ Tag: ${escapeHtml(d.tagName)}</span>`;
    } else {
      tagBadgeHtml = '<span class="tag-badge tag-badge-none">○ No Tag</span>';
    }

    let actionBtnHtml = '';
    if (d.isTagged) {
      actionBtnHtml = `<button class="btn-mini btn-mini-tag" disabled title="Commit นี้ผ่านการทำ Tag แล้ว">🏷️ Tagged</button>`;
    } else {
      if (canApprove) {
        actionBtnHtml = `<button class="btn-mini btn-mini-tag" onclick="openTagConfirmModal('${escapeHtml(d.commitSha)}', '${escapeHtml(d.projectName)}', '${escapeHtml(d.version)}', '${escapeHtml(d.repositoryName)}')">🏷️ Create Tag</button>`;
      } else {
        actionBtnHtml = `<button class="btn-mini btn-mini-tag" disabled title="คุณไม่มีสิทธิ์ในการสร้าง Tag (ต้องมี Role: it_support_approve)">🏷️ Create Tag</button>`;
      }
    }

    const commitLinkHtml = commitUrl 
      ? `<a href="${commitUrl}" target="_blank" rel="noopener" class="pr-link" style="font-family: monospace;">${shortSha}</a>`
      : `<code style="font-family: monospace;">${shortSha}</code>`;

    const branchLinkHtml = branchUrl
      ? `<a href="${branchUrl}" target="_blank" rel="noopener" class="pr-link" style="font-family: monospace; font-size:11px;">${escapeHtml(d.branchName)}</a>`
      : `<code style="font-family: monospace; font-size:11px;">${escapeHtml(d.branchName)}</code>`;

    tr.innerHTML = `
      <td><strong>${formattedTime}</strong></td>
      <td>
        <span class="whitelabel-badge">${escapeHtml(d.projectName)}</span>
        <div style="font-size: 10px; color: #6b7280; margin-top: 4px;">Repo: ${escapeHtml(d.repositoryName)}</div>
      </td>
      <td><span class="version-badge">${escapeHtml(d.version)}</span></td>
      <td>${commitLinkHtml}</td>
      <td>
        <div class="branch-stack">
          <div class="branch-line">
            <span></span>
            ${branchLinkHtml}
          </div>
        </div>
      </td>
      <td>${tagBadgeHtml}</td>
      <td class="pr-actions-cell">
        <div class="action-cell">
          ${actionBtnHtml}
          ${commitUrl ? `<a href="${commitUrl}" target="_blank" rel="noopener" class="btn-mini btn-mini-link" title="ดู Commit ใน Azure DevOps">🔗 ADO</a>` : ''}
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  }
}

// ===== API Modals & Tag Creation (Single) =====
window.openTagConfirmModal = function(commitSha, projectName, version, repositoryName) {
  _selectedDeployment = { commitSha, projectName, version, repositoryName };

  setText('modalWhitelabelName', projectName);
  setText('modalVersion', version);
  setText('modalCommitSha', commitSha);

  const defaultTagName = `${projectName}_${version}`;
  const inputEl = document.getElementById('modalTagNameInput');
  if (inputEl) {
    inputEl.value = defaultTagName;
  }

  openModal('confirmTagModal');
};

async function doCreateTagSingle() {
  if (!_selectedDeployment) return;

  const inputEl = document.getElementById('modalTagNameInput');
  const tagName = inputEl ? inputEl.value.trim() : '';

  if (!tagName) {
    alert('กรุณากรอกชื่อ Git Tag');
    return;
  }

  if (/\s/.test(tagName)) {
    alert('ชื่อ Git Tag ต้องไม่มีเว้นวรรค (Whitespace)');
    return;
  }

  setButtonLoading('btnConfirmCreateTag', true, 'Creating...');

  try {
    const response = await fetch('/api/create-tag', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        commitSha: _selectedDeployment.commitSha,
        tagName: tagName,
        repositoryName: _selectedDeployment.repositoryName
      })
    });

    const text = await response.text();
    let r = { ok: response.ok, status: response.status, data: null };
    try { r.data = JSON.parse(text); } catch (e) {}

    if (!r.ok || !r.data || !r.data.ok) {
      const errDetail = r.data && r.data.error ? r.data.error : 'Failed to create tag';
      const detail = r.data && r.data.detail ? ` (${r.data.detail})` : '';
      alert(`❌ เกิดข้อผิดพลาด: ${errDetail}${detail}`);
      return;
    }

    closeModal('confirmTagModal');
    
    // Show success alert
    showBox('deploymentResult', `✅ สร้าง Git Tag <strong>${escapeHtml(tagName)}</strong> สำเร็จ!`, 'success');
    
    setTimeout(() => {
      const resultBox = document.getElementById('deploymentResult');
      if (resultBox) resultBox.hidden = true;
    }, 4000);

    // Refresh whichever tab is active
    await loadDeployments(true);
    if (_currentRepoId) {
      await loadRepoRefs(_currentRepoId, _currentRepoName);
    }

  } catch (err) {
    console.error('Error in doCreateTagSingle:', err);
    alert(`❌ เกิดข้อผิดพลาดที่ไม่คาดคิด: ${err.message}`);
  } finally {
    setButtonLoading('btnConfirmCreateTag', false);
  }
}

// ===== Throttled Bulk Tagging Execution (Queue) =====
async function triggerBulkTagging() {
  const checkedBoxes = document.querySelectorAll('.ref-select-checkbox:checked');
  if (checkedBoxes.length === 0) return;

  const bulkTasks = [];
  let nameError = false;

  checkedBoxes.forEach(cb => {
    const idx = parseInt(cb.dataset.index);
    const branch = _currentRepoBranches[idx];
    const tagInput = document.getElementById(`tagInput_${idx}`);
    const tagName = tagInput ? tagInput.value.trim() : '';

    if (!tagName) {
      nameError = true;
      tagInput.style.borderColor = '#dc2626';
    } else {
      if (tagInput) tagInput.style.borderColor = '#d1d5db';
      bulkTasks.push({
        repoName: _currentRepoName,
        branchName: branch.branchName,
        commitSha: branch.commitSha,
        tagName: tagName
      });
    }
  });

  if (nameError) {
    alert('กรุณากรอกชื่อ Git Tag สำหรับสาขาที่เลือกให้ครบถ้วน');
    return;
  }

  // Confirm bulk action
  if (!confirm(`คุณต้องการสร้าง Git Tag ทั้งหมด ${bulkTasks.length} รายการ บน Azure DevOps ใช่หรือไม่?`)) {
    return;
  }

  // Open progress modal
  const progressText = document.getElementById('bulkProgressText');
  const progressPercentage = document.getElementById('bulkProgressPercentage');
  const progressBar = document.getElementById('bulkProgressBar');
  const progressLog = document.getElementById('bulkProgressLog');
  const btnClose = document.getElementById('btnProgressClose');
  const btnDone = document.getElementById('btnBulkProgressDone');

  progressText.textContent = `กำลังเตรียมสร้าง: 0 / ${bulkTasks.length} รายการ`;
  progressPercentage.textContent = '0%';
  progressBar.style.width = '0%';
  progressLog.innerHTML = '<div style="color:#9ca3af; font-style:italic;">🚀 กำลังจัดเตรียมคิวสร้าง Git Tag...</div>';
  
  btnClose.style.display = 'none';
  btnDone.style.display = 'none';
  
  openModal('bulkProgressModal');

  // Hide the bulk panel
  const bulkPanel = document.getElementById('floatingBulkPanel');
  if (bulkPanel) bulkPanel.classList.remove('show');

  // Concurrency limit: 5 requests at a time
  const limit = 5;
  let activeCount = 0;
  let currentIndex = 0;
  let completedCount = 0;
  let successCount = 0;
  let failCount = 0;

  progressLog.innerHTML = ''; // Clear initial log

  async function processNext() {
    if (currentIndex >= bulkTasks.length) return;
    
    const taskIndex = currentIndex++;
    const task = bulkTasks[taskIndex];
    activeCount++;

    const logRow = document.createElement('div');
    logRow.className = 'bulk-log-row';
    logRow.innerHTML = `<span>[${escapeHtml(task.repoName)}] / ${escapeHtml(task.branchName)} &rarr; ⏳ กำลังส่งคำขอ...</span>`;
    progressLog.appendChild(logRow);
    progressLog.scrollTop = progressLog.scrollHeight; // Auto-scroll

    try {
      const res = await fetch('/api/create-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commitSha: task.commitSha,
          tagName: task.tagName,
          repositoryName: task.repoName
        })
      });

      const data = await res.json();
      completedCount++;

      if (res.ok && data.ok) {
        successCount++;
        logRow.innerHTML = `<span>[${escapeHtml(task.repoName)}] / ${escapeHtml(task.branchName)} &rarr; ${escapeHtml(task.tagName)}</span><span class="bulk-log-ok">✅ สำเร็จ</span>`;
      } else {
        failCount++;
        const err = data.error || 'Failed';
        logRow.innerHTML = `<span>[${escapeHtml(task.repoName)}] / ${escapeHtml(task.branchName)} &rarr; ${escapeHtml(task.tagName)}</span><span class="bulk-log-err">❌ ล้มเหลว (${escapeHtml(err)})</span>`;
      }
    } catch (err) {
      completedCount++;
      failCount++;
      logRow.innerHTML = `<span>[${escapeHtml(task.repoName)}] / ${escapeHtml(task.branchName)} &rarr; ${escapeHtml(task.tagName)}</span><span class="bulk-log-err">❌ ล้มเหลว (${escapeHtml(err.message)})</span>`;
    }

    // Update progress bar
    const pct = Math.round((completedCount / bulkTasks.length) * 100);
    progressPercentage.textContent = `${pct}%`;
    progressBar.style.width = `${pct}%`;
    progressText.textContent = `ดำเนินการแล้ว: ${completedCount} / ${bulkTasks.length} รายการ (สำเร็จ: ${successCount}, ล้มเหลว: ${failCount})`;

    activeCount--;
    
    // Trigger next task if available
    if (currentIndex < bulkTasks.length) {
      await processNext();
    }
  }

  // Start initial pool of workers up to the limit
  const workers = [];
  const initialPoolSize = Math.min(limit, bulkTasks.length);
  for (let i = 0; i < initialPoolSize; i++) {
    workers.push(processNext());
  }

  // Wait for all workers to finish
  await Promise.all(workers);

  // Clear checked boxes and select all header
  clearBulkSelection();

  // Show close and done buttons
  btnClose.style.display = 'block';
  btnDone.style.display = 'block';

  // Add final log line
  const finalSummary = document.createElement('div');
  finalSummary.style.marginTop = '10px';
  finalSummary.style.fontWeight = 'bold';
  finalSummary.style.textAlign = 'center';
  finalSummary.style.color = failCount === 0 ? '#34d399' : '#fb923c';
  finalSummary.innerHTML = `🎉 ดำเนินการเสร็จสิ้น! สำเร็จ ${successCount} รายการ, ล้มเหลว ${failCount} รายการ`;
  progressLog.appendChild(finalSummary);
  progressLog.scrollTop = progressLog.scrollHeight;
}
