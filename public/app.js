// ============================================
// ADO Auto-Approve - Dashboard Script (Phase 2)
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

    const webhookUrl = window.location.origin + '/api/webhook';
    const wUrl = document.getElementById('webhookUrl');
    if (wUrl) wUrl.value = webhookUrl;

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

    document.getElementById('btnTestTeams') && document.getElementById('btnTestTeams').addEventListener('click', testTeams);
    document.getElementById('btnTestHealth') && document.getElementById('btnTestHealth').addEventListener('click', testHealth);
    document.getElementById('btnCopyUrl') && document.getElementById('btnCopyUrl').addEventListener('click', copyWebhookUrl);

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

function showResult(message, type) {
  type = type || 'info';
  const box = document.getElementById('testResult');
  if (!box) return;
  box.hidden = false;
  box.className = 'test-result result-' + type;
  box.innerHTML = message;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function setButtonLoading(buttonId, loading) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  btn.disabled = loading;
  btn.style.opacity = loading ? '0.6' : '1';
  btn.style.cursor = loading ? 'wait' : 'pointer';
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Fetch JSON อย่างปลอดภัย — ถ้า server ตอบ non-JSON จะคืน {parseError, rawBody, status}
 */
async function safeFetchJson(url, options) {
  const resp = await fetch(url, options || {});
  const text = await resp.text();
  const contentType = resp.headers.get('Content-Type') || '';

  let data = null;
  let parseError = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      parseError = e.message;
    }
  } else {
    parseError = 'Empty response body';
  }

  return {
    ok: resp.ok,
    status: resp.status,
    contentType: contentType,
    data: data,
    rawBody: text,
    parseError: parseError
  };
}

// ===== Test Functions =====
async function testTeams() {
  setButtonLoading('btnTestTeams', true);
  showResult('⏳ กำลังส่งข้อความทดสอบเข้า Teams...', 'info');

  try {
    const r = await safeFetchJson('/api/test-notification', { method: 'POST' });

    // กรณี backend ตอบ non-JSON (เช่น HTML page ของ login, error page)
    if (r.parseError) {
      const isHtml = r.contentType.indexOf('text/html') >= 0 || r.rawBody.indexOf('<') === 0;
      const preview = (r.rawBody || '(empty)').substring(0, 300);
      showResult(
        '❌ <strong>Backend ตอบกลับไม่ใช่ JSON</strong><br/>' +
        '<small>HTTP ' + r.status + ' | Content-Type: ' + escapeHtml(r.contentType || '(none)') + '</small><br/>' +
        '<small><strong>สาเหตุที่เป็นไปได้:</strong></small><br/>' +
        '<small>' + (isHtml
          ? '• Session login หมดอายุ — refresh หน้านี้แล้วลองใหม่<br/>• Deploy ยังไม่เสร็จ — ตรวจ GitHub Actions tab'
          : '• Function ยัง deploy ไม่เสร็จ<br/>• Function crash ตอน startup') +
        '</small><br/>' +
        '<small><strong>Response preview:</strong></small><br/>' +
        '<code style="display:block;padding:8px;background:#fff;border-radius:4px;font-size:11px;margin-top:6px;white-space:pre-wrap;word-break:break-all">' + escapeHtml(preview) + '</code>',
        'error'
      );
      return;
    }

    if (r.ok && r.data && r.data.ok) {
      showResult(
        '✅ <strong>ส่งสำเร็จ!</strong> ตรวจดู Teams channel ที่ตั้งค่าไว้<br/>' +
        '<small>โดย: ' + escapeHtml(r.data.sentBy) + ' | เวลา: ' + new Date(r.data.timestamp).toLocaleString('th-TH') + ' | Teams HTTP ' + (r.data.teamsStatus || '-') + '</small>',
        'success'
      );
    } else {
      const d = r.data || {};
      showResult(
        '❌ <strong>ส่งไม่สำเร็จ:</strong> ' + escapeHtml(d.error || 'Unknown error') + ' (HTTP ' + r.status + ')<br/>' +
        '<small>' + escapeHtml(d.hint || d.detail || d.teamsBody || '') + '</small>' +
        (d.teamsStatus ? '<br/><small>Teams returned HTTP ' + d.teamsStatus + '</small>' : ''),
        'error'
      );
    }
  } catch (err) {
    showResult('❌ <strong>เกิดข้อผิดพลาด (network):</strong> ' + escapeHtml(err.message), 'error');
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
      showResult(
        '❌ <strong>Health endpoint ตอบกลับไม่ใช่ JSON</strong> (HTTP ' + r.status + ')<br/>' +
        '<small>Content-Type: ' + escapeHtml(r.contentType) + '</small><br/>' +
        '<code style="display:block;padding:8px;background:#fff;border-radius:4px;font-size:11px;margin-top:6px;white-space:pre-wrap;word-break:break-all">' + escapeHtml((r.rawBody || '(empty)').substring(0, 300)) + '</code>',
        'error'
      );
      return;
    }

    if (r.ok && r.data && r.data.status === 'healthy') {
      showResult(
        '✅ <strong>Backend ทำงานปกติ</strong><br/>' +
        '<small>Phase: ' + escapeHtml(r.data.phase) + ' | Node: ' + escapeHtml(r.data.node_version) + ' | Uptime: ' + r.data.uptime_seconds + 's</small>',
        'success'
      );
    } else {
      showResult('⚠️ <strong>Backend ตอบกลับผิดปกติ:</strong> HTTP ' + r.status, 'error');
    }
  } catch (err) {
    showResult('❌ <strong>เชื่อมต่อ Backend ไม่ได้:</strong> ' + escapeHtml(err.message), 'error');
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
      card.querySelector('.status-desc').textContent = 'Backend ตอบไม่ปกติ (HTTP ' + resp.status + ')';
    }
  } catch (e) {
    const card = document.getElementById('apiStatus');
    if (!card) return;
    card.classList.remove('status-ok');
    card.classList.add('status-pending');
    card.querySelector('.status-icon').textContent = '⚠️';
    card.querySelector('.status-desc').textContent = 'เชื่อมต่อ Backend ไม่ได้';
  }
}

async function copyWebhookUrl() {
  const input = document.getElementById('webhookUrl');
  if (!input) return;
  try {
    await navigator.clipboard.writeText(input.value);
    const btn = document.getElementById('btnCopyUrl');
    const original = btn.textContent;
    btn.textContent = '✅ Copied!';
    setTimeout(function () { btn.textContent = original; }, 1500);
  } catch (e) {
    input.select();
    document.execCommand('copy');
  }
}
