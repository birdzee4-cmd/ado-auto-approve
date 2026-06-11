// ============================================
// ADO Auto-Approve - Deployments Dashboard Script
// ============================================

let _allDeployments = [];
let _organization = '';
let _project = '';
let _repository = '';
let _selectedDeployment = null;

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

    // 3) Bind events
    bind('btnRefreshDeployments', () => loadDeployments(false));
    bind('btnSearchDeployments', filterAndRenderTable);
    bind('btnConfirmCreateTag', doCreateTag);

    // Enter key search
    const searchInput = document.getElementById('deploySearchKeyword');
    if (searchInput) {
      searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') filterAndRenderTable();
      });
    }

    // Dropdown change filter
    const statusSelect = document.getElementById('deployFilterTagStatus');
    if (statusSelect) {
      statusSelect.addEventListener('change', filterAndRenderTable);
    }

    // Close buttons for modals
    document.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', () => closeModal(el.getAttribute('data-close')));
    });
    document.querySelectorAll('.modal-backdrop').forEach(bd => {
      bd.addEventListener('click', (e) => {
        if (e.target === bd) closeModal(bd.id);
      });
    });

    // 4) Load Deployments on load
    await loadDeployments(true);

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

// ===== API Core Functions =====
async function loadDeployments(isSilent) {
  if (!isSilent) {
    setButtonLoading('btnRefreshDeployments', true, 'Loading...');
    showBox('deploymentResult', '<div class="test-result result-info">⏳ กำลังเรียกข้อมูลจาก Azure DevOps...</div>');
  }

  try {
    const resp = await fetch('/api/list-deployments');
    const text = await resp.text();
    let r = { ok: resp.ok, status: resp.status, data: null };
    try { r.data = JSON.parse(text); } catch (e) {}

    if (!r.ok || !r.data || !r.data.ok) {
      const errDetail = r.data && r.data.error ? r.data.error : 'Unknown error';
      const hint = r.data && r.data.hint ? `<br/><small>${r.data.hint}</small>` : '';
      showBox('deploymentResult', `❌ ${escapeHtml(errDetail)}${hint}`, 'error');
      return;
    }

    const d = r.data;
    _allDeployments = d.deployments || [];
    _organization = d.organization || '';
    _project = d.project || '';
    _repository = d.repository || '';

    // Calculate stats
    calculateStats(_allDeployments);

    if (!isSilent) {
      showBox('deploymentResult', `✅ โหลดข้อมูลสำเร็จ พบประวัติการขึ้นระบบทั้งหมด <strong>${_allDeployments.length}</strong> รายการ`, 'success');
      // Hide banner after 4 seconds
      setTimeout(() => {
        const resultBox = document.getElementById('deploymentResult');
        if (resultBox) resultBox.hidden = true;
      }, 4000);
    }

    filterAndRenderTable();

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

function filterAndRenderTable() {
  const keyword = (document.getElementById('deploySearchKeyword').value || '').trim().toLowerCase();
  const filterTag = (document.getElementById('deployFilterTagStatus').value || 'all');

  const filtered = _allDeployments.filter(d => {
    // Keyword filter (checks project name, version, and commit SHA)
    const matchesKeyword = !keyword || 
      d.projectName.toLowerCase().includes(keyword) || 
      d.version.toLowerCase().includes(keyword) || 
      d.commitSha.toLowerCase().includes(keyword) ||
      d.branchName.toLowerCase().includes(keyword);

    // Tag status filter
    let matchesTag = true;
    if (filterTag === 'tagged') {
      matchesTag = d.isTagged === true;
    } else if (filterTag === 'untagged') {
      matchesTag = d.isTagged === false;
    }

    return matchesKeyword && matchesTag;
  });

  renderTable(filtered);
}

function renderTable(deployments) {
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
    const commitUrl = _organization && _project && _repository
      ? `https://dev.azure.com/${_organization}/${_project}/_git/${_repository}/commit/${d.commitSha}`
      : null;
    const branchUrl = _organization && _project && _repository
      ? `https://dev.azure.com/${_organization}/${_project}/_git/${_repository}?version=GB${encodeURIComponent(d.branchName)}`
      : null;

    // Render tag status badge
    let tagBadgeHtml = '';
    if (d.isTagged) {
      tagBadgeHtml = `<span class="tag-badge tag-badge-ok" title="Tagged with: ${escapeHtml(d.tagName)}">✅ Tag: ${escapeHtml(d.tagName)}</span>`;
    } else {
      tagBadgeHtml = '<span class="tag-badge tag-badge-none">○ No Tag</span>';
    }

    // Action button
    let actionBtnHtml = '';
    if (d.isTagged) {
      actionBtnHtml = `<button class="btn-mini btn-mini-tag" disabled title="Commit นี้ผ่านการทำ Tag แล้ว">🏷️ Tagged</button>`;
    } else {
      if (canApprove) {
        actionBtnHtml = `<button class="btn-mini btn-mini-tag" onclick="openTagConfirmModal('${escapeHtml(d.commitSha)}', '${escapeHtml(d.projectName)}', '${escapeHtml(d.version)}')">🏷️ Create Tag</button>`;
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
      <td><span class="whitelabel-badge">${escapeHtml(d.projectName)}</span></td>
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

// ===== Modals & Tag Creation logic =====
window.openTagConfirmModal = function(commitSha, projectName, version) {
  _selectedDeployment = { commitSha, projectName, version };

  setText('modalWhitelabelName', projectName);
  setText('modalVersion', version);
  setText('modalCommitSha', commitSha);

  // Suggest a default tag name (e.g. Website_WhiteLabel_GDH_VC12.00)
  const defaultTagName = `${projectName}_${version}`;
  const inputEl = document.getElementById('modalTagNameInput');
  if (inputEl) {
    inputEl.value = defaultTagName;
  }

  openModal('confirmTagModal');
};

async function doCreateTag() {
  if (!_selectedDeployment) return;

  const inputEl = document.getElementById('modalTagNameInput');
  const tagName = inputEl ? inputEl.value.trim() : '';

  if (!tagName) {
    alert('กรุณากรอกชื่อ Git Tag');
    return;
  }

  // Validate tag name (no spaces, basic git tag validation)
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
        tagName: tagName
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
    
    // Show success alert and reload data
    showBox('deploymentResult', `✅ สร้าง Git Tag <strong>${escapeHtml(tagName)}</strong> สำเร็จ!`, 'success');
    
    // Hide banner after 4 seconds
    setTimeout(() => {
      const resultBox = document.getElementById('deploymentResult');
      if (resultBox) resultBox.hidden = true;
    }, 4000);

    await loadDeployments(true);

  } catch (err) {
    console.error('Error in doCreateTag:', err);
    alert(`❌ เกิดข้อผิดพลาดที่ไม่คาดคิด: ${err.message}`);
  } finally {
    setButtonLoading('btnConfirmCreateTag', false);
  }
}
