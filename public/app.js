// ============================================
// ADO Auto-Approve - Dashboard Script (Phase 3)
// ============================================

let currentPrForAction = null; // เก็บ PR ปัจจุบันที่กำลังจะ approve/reject

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
      }
    } catch (e) {}

    await checkHealthStatus();

    // Buttons
    bind('btnCheckPrs', checkPrs);
    bind('btnTestTeams', testTeams);
    bind('btnTestHealth', testHealth);
    bind('btnConfirmApprove', doApprove);
    bind('btnConfirmReject', doReject);

    // Modal close buttons
    document.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', () => closeModal(el.getAttribute('data-close')));
    });
    document.querySelectorAll('.modal-backdrop').forEach(bd => {
      bd.addEventListener('click', (e) => {
        if (e.target === bd) closeModal(bd.id);
      });
    });

    // Auto-load PR list
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
  if (loadingText) {
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
    showBox('prResult',
      '<div class="test-result result-success">✅ พบ <strong>' + d.count + '</strong> PR ที่รออนุมัติ ' +
      '(จาก ' + d.totalActive + ' active PRs ทั้งหมดใน <code>' + escapeHtml(d.targetBranch) + '</code>)' +
      '<br/><small>Filter: reviewer group = <strong>' + escapeHtml(d.reviewerGroup) + '</strong> | ดึงเมื่อ ' +
      new Date(d.fetchedAt).toLocaleString('th-TH') + '</small></div>');
    renderPrTable(d.prs);
    document.getElementById('prTableContainer').hidden = false;
  } catch (err) {
    showBox('prResult', '<div class="test-result result-error">❌ ' + escapeHtml(err.message) + '</div>');
  } finally {
    setButtonLoading('btnCheckPrs', false);
  }
}

function renderPrTable(prs) {
  document.getElementById('prMeta').textContent = 'พบ ' + prs.length + ' รายการ';
  const tbody = document.getElementById('prTableBody');
  tbody.innerHTML = '';

  if (prs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:#9ca3af">— ไม่มี PR ที่รอ Approve ตอนนี้ —</td></tr>';
    return;
  }

  for (const pr of prs) {
    const tr = document.createElement('tr');
    if (pr.isDraft) tr.classList.add('pr-draft');

    const draftBadge = pr.isDraft ? ' <span class="pr-badge">DRAFT</span>' : '';
    const actionsHtml =
      '<div class="action-cell">' +
      '<button class="btn-mini btn-approve" onclick="openApproveModal(' + pr.id + ', \'' + pr.repositoryId + '\')">✅ Approve</button>' +
      '<button class="btn-mini btn-reject" onclick="openRejectModal(' + pr.id + ', \'' + pr.repositoryId + '\')">❌ Reject</button>' +
      '<button class="btn-mini btn-history" onclick="openHistoryModal(' + pr.id + ')">📜</button>' +
      '<a class="btn-mini btn-open" href="' + pr.url + '" target="_blank">🔗</a>' +
      '</div>';

    tr.innerHTML =
      '<td><strong>#' + pr.id + '</strong></td>' +
      '<td>' + escapeHtml(pr.title) + draftBadge + '</td>' +
      '<td>' + escapeHtml(pr.createdBy || '-') + '</td>' +
      '<td><code>' + escapeHtml(shortBranch(pr.sourceBranch)) + '</code> → <code>' + escapeHtml(shortBranch(pr.targetBranch)) + '</code></td>' +
      '<td>' + escapeHtml(pr.repository || '-') + '</td>' +
      '<td>' + formatDate(pr.creationDate) + '</td>' +
      '<td>' + actionsHtml + '</td>';

    // เก็บข้อมูล PR ลงใน row dataset เผื่อใช้ภายหลัง
    tr.dataset.pr = JSON.stringify({
      id: pr.id, title: pr.title, repository: pr.repository,
      sourceBranch: shortBranch(pr.sourceBranch), targetBranch: shortBranch(pr.targetBranch),
      createdBy: pr.createdBy, repositoryId: pr.repositoryId
    });
    tbody.appendChild(tr);
  }
}

// ===== Approve Modal =====
window.openApproveModal = function(prId, repositoryId) {
  const row = document.querySelector('#prTableBody tr td strong');
  // หา row ของ PR นี้
  const rows = document.querySelectorAll('#prTableBody tr');
  let prData = null;
  rows.forEach(r => {
    if (r.dataset.pr) {
      const p = JSON.parse(r.dataset.pr);
      if (p.id === prId) prData = p;
    }
  });
  if (!prData) return;
  currentPrForAction = { ...prData, repositoryId };

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
      alert('✅ Approve สำเร็จ!\n\nPR #' + r.data.prId +
        '\nAuto-Complete: ' + (r.data.autoComplete ? 'เปิดแล้ว' : 'ตั้งไม่สำเร็จ') +
        '\nLog SharePoint: ' + r.data.logStatus);
      closeModal('confirmApproveModal');
      checkPrs(); // refresh list
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
  currentPrForAction = { ...prData, repositoryId };

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

// ===== Test Functions (เดิม) =====
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
