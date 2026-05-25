// ============================================
// ADO Auto-Approve - Dashboard Script (Phase 2 - Polling)
// ============================================

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
    setText('userId', principal.userId || '-');
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
    } catch (e) {
      console.warn('userinfo API not available:', e);
    }

    await checkHealthStatus();

    document.getElementById('btnCheckPrs')   && document.getElementById('btnCheckPrs').addEventListener('click', checkPrs);
    document.getElementById('btnTestTeams')  && document.getElementById('btnTestTeams').addEventListener('click', testTeams);
    document.getElementById('btnTestHealth') && document.getElementById('btnTestHealth').addEventListener('click', testHealth);

  } catch (err) {
    console.error('Init failed:', err);
    window.location.href = '/';
  }
})();

// ===== Helpers =====
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
  const box = document.getElementById('testResult');
  if (box) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    try { data = JSON.parse(text); }
    catch (e) { parseError = e.message; }
  } else {
    parseError = 'Empty response body';
  }
  return { ok: resp.ok, status: resp.status, contentType, data, rawBody: text, parseError };
}

function formatDate(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('th-TH', {
      dateStyle: 'short', timeStyle: 'short'
    });
  } catch (e) { return iso; }
}

function shortBranch(ref) {
  if (!ref) return '-';
  return ref.replace(/^refs\/heads\//, '');
}

// ===== Main: Check PRs =====
async function checkPrs() {
  setButtonLoading('btnCheckPrs', true, 'กำลังดึงข้อมูล...');
  const tableContainer = document.getElementById('prTableContainer');
  if (tableContainer) tableContainer.hidden = true;
  showBox('prResult', '<div class="test-result result-info">⏳ กำลังเรียก ADO API...</div>');

  try {
    const r = await safeFetchJson('/api/list-prs');

    if (r.parseError) {
      const isHtml = r.contentType.indexOf('text/html') >= 0 || r.rawBody.indexOf('<') === 0;
      showBox('prResult',
        '<div class="test-result result-error">' +
        '❌ <strong>ตอบกลับไม่ใช่ JSON</strong> (HTTP ' + r.status + ')<br/>' +
        '<small>' + (isHtml ? 'Session อาจหมดอายุ — refresh แล้วลองใหม่' : 'Function อาจยัง deploy ไม่เสร็จ') + '</small><br/>' +
        '<code style="display:block;padding:8px;background:#fff;border-radius:4px;font-size:11px;margin-top:6px;white-space:pre-wrap;word-break:break-all">' +
        escapeHtml((r.rawBody || '(empty)').substring(0, 300)) + '</code></div>');
      return;
    }

    if (!r.ok || !r.data || !r.data.ok) {
      const d = r.data || {};
      showBox('prResult',
        '<div class="test-result result-error">' +
        '❌ <strong>เรียก ADO ไม่สำเร็จ:</strong> ' + escapeHtml(d.error || 'Unknown') + ' (HTTP ' + r.status + ')<br/>' +
        '<small>' + escapeHtml(d.hint || d.detail || '') + '</small></div>');
      return;
    }

    // Success — render table
    const d = r.data;
    showBox('prResult',
      '<div class="test-result result-success">✅ <strong>ดึงสำเร็จ:</strong> พบ ' + d.count + ' PR ใน ' +
      escapeHtml(d.organization) + '/' + escapeHtml(d.project) +
      ' (target: <code>' + escapeHtml(d.targetBranch) + '</code>)<br/>' +
      '<small>เวลาที่ดึง: ' + new Date(d.fetchedAt).toLocaleString('th-TH') + '</small></div>');

    renderPrTable(d.prs);
    if (tableContainer) tableContainer.hidden = false;

  } catch (err) {
    showBox('prResult',
      '<div class="test-result result-error">❌ <strong>เกิดข้อผิดพลาด (network):</strong> ' +
      escapeHtml(err.message) + '</div>');
  } finally {
    setButtonLoading('btnCheckPrs', false);
  }
}

function renderPrTable(prs) {
  const meta = document.getElementById('prMeta');
  if (meta) meta.textContent = 'พบ ' + prs.length + ' รายการ';

  const tbody = document.getElementById('prTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (prs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:#9ca3af">— ไม่มี PR active ใน branch นี้ตอนนี้ —</td></tr>';
    return;
  }

  for (const pr of prs) {
    const tr = document.createElement('tr');
    if (pr.isDraft) tr.classList.add('pr-draft');
    tr.innerHTML =
      '<td><strong>#' + pr.id + '</strong></td>' +
      '<td>' + escapeHtml(pr.title) + (pr.isDraft ? ' <span class="pr-badge">DRAFT</span>' : '') + '</td>' +
      '<td>' + escapeHtml(pr.createdBy || '-') + '</td>' +
      '<td><code>' + escapeHtml(shortBranch(pr.sourceBranch)) + '</code> → <code>' + escapeHtml(shortBranch(pr.targetBranch)) + '</code></td>' +
      '<td>' + escapeHtml(pr.repository || '-') + '</td>' +
      '<td>' + escapeHtml(pr.mergeStatus || '-') + '</td>' +
      '<td>' + formatDate(pr.creationDate) + '</td>' +
      '<td>' + (pr.url ? '<a href="' + pr.url + '" target="_blank" class="pr-link">Open ↗</a>' : '-') + '</td>';
    tbody.appendChild(tr);
  }
}

// ===== Test Functions =====
async function testTeams() {
  setButtonLoading('btnTestTeams', true);
  showResult('⏳ กำลังส่งข้อความทดสอบเข้า Teams...', 'info');
  try {
    const r = await safeFetchJson('/api/test-notification', { method: 'POST' });
    if (r.parseError) {
      const isHtml = r.contentType.indexOf('text/html') >= 0;
      showResult(
        '❌ <strong>ตอบกลับไม่ใช่ JSON</strong> (HTTP ' + r.status + ')<br/>' +
        '<small>' + (isHtml ? 'Session อาจหมดอายุ — refresh แล้วลองใหม่' : 'Function ยัง deploy ไม่เสร็จ') + '</small>',
        'error');
      return;
    }
    if (r.ok && r.data && r.data.ok) {
      showResult('✅ <strong>ส่งสำเร็จ!</strong> ตรวจดู Teams channel<br/><small>โดย: ' +
        escapeHtml(r.data.sentBy) + '</small>', 'success');
    } else {
      const d = r.data || {};
      showResult('❌ <strong>ส่งไม่สำเร็จ:</strong> ' + escapeHtml(d.error || 'Unknown') +
        '<br/><small>' + escapeHtml(d.hint || d.detail || '') + '</small>', 'error');
    }
  } catch (err) {
    showResult('❌ ' + escapeHtml(err.message), 'error');
  } finally {
    setButtonLoading('btnTestTeams', false);
  }
}

async function testHealth() {
  setButtonLoading('btnTestHealth', true);
  showResult('⏳ กำลังตรวจ Backend Health...', 'info');
  try {
    const r = await safeFetchJson('/api/health');
    if (r.parseError) {
      showResult('❌ Health endpoint ตอบไม่ใช่ JSON (HTTP ' + r.status + ')', 'error');
      return;
    }
    if (r.ok && r.data && r.data.status === 'healthy') {
      showResult('✅ <strong>Backend ทำงานปกติ</strong><br/><small>Node: ' +
        escapeHtml(r.data.node_version) + ' | Uptime: ' + r.data.uptime_seconds + 's</small>', 'success');
    } else {
      showResult('⚠️ HTTP ' + r.status, 'error');
    }
  } catch (err) {
    showResult('❌ ' + escapeHtml(err.message), 'error');
  } finally {
    setButtonLoading('btnTestHealth', false);
  }
}

async function checkHealthStatus() {
  try {
    const resp = await fetch('/api/health');
    const card = document.getElementById('apiStatus');
    if (!card) return;
    if (resp.ok) {
      card.querySelector('.status-icon').textContent = '✅';
      card.querySelector('.status-desc').textContent = 'Backend ทำงานปกติ';
    } else {
      card.classList.remove('status-ok');
      card.classList.add('status-error');
      card.querySelector('.status-icon').textContent = '❌';
      card.querySelector('.status-desc').textContent = 'HTTP ' + resp.status;
    }
  } catch (e) {
    const card = document.getElementById('apiStatus');
    if (!card) return;
    card.querySelector('.status-icon').textContent = '⚠️';
    card.querySelector('.status-desc').textContent = 'เชื่อมต่อไม่ได้';
  }
}
