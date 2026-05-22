// ============================================
// ADO Auto-Approve - Dashboard Script (Phase 2)
// ============================================

(async function init() {
  // 1. ตรวจสอบว่า login แล้วหรือยัง
  try {
    const authResp = await fetch('/.auth/me');
    const authData = await authResp.json();

    if (!authData.clientPrincipal) {
      window.location.href = '/';
      return;
    }

    // 2. แสดงข้อมูล user ที่ login
    const principal = authData.clientPrincipal;
    setText('userName', principal.userDetails || 'Unknown');
    setText('displayName', principal.userDetails || '-');
    setText('userEmail', principal.userDetails || '-');
    setText('userId', principal.userId || '-');
    setText('loginTime', new Date().toLocaleString('th-TH', {
      dateStyle: 'medium', timeStyle: 'short'
    }));

    // 3. แสดง webhook URL
    const webhookUrl = window.location.origin + '/api/webhook';
    const wUrl = document.getElementById('webhookUrl');
    if (wUrl) wUrl.value = webhookUrl;

    // 4. ดึงข้อมูล user เพิ่มเติมจาก API
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

    // 5. ตรวจ Backend Health
    await checkHealthStatus();

    // 6. ผูก event handlers
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

// ===== Test Functions =====
async function testTeams() {
  setButtonLoading('btnTestTeams', true);
  showResult('⏳ กำลังส่งข้อความทดสอบเข้า Teams...', 'info');

  try {
    const resp = await fetch('/api/test-notification', { method: 'POST' });
    const data = await resp.json();

    if (resp.ok && data.ok) {
      showResult(
        '✅ <strong>ส่งสำเร็จ!</strong> ตรวจดู Teams channel ที่ตั้งค่าไว้<br/>' +
        '<small>โดย: ' + escapeHtml(data.sentBy) + ' | เวลา: ' + new Date(data.timestamp).toLocaleString('th-TH') + '</small>',
        'success'
      );
    } else {
      showResult(
        '❌ <strong>ส่งไม่สำเร็จ:</strong> ' + escapeHtml(data.error || 'Unknown error') + '<br/>' +
        '<small>' + escapeHtml(data.hint || data.teamsBody || '') + '</small>',
        'error'
      );
    }
  } catch (err) {
    showResult('❌ <strong>เกิดข้อผิดพลาด:</strong> ' + escapeHtml(err.message), 'error');
  } finally {
    setButtonLoading('btnTestTeams', false);
  }
}

async function testHealth() {
  setButtonLoading('btnTestHealth', true);
  showResult('⏳ กำลังตรวจ Backend Health...', 'info');

  try {
    const resp = await fetch('/api/health');
    const data = await resp.json();

    if (resp.ok && data.status === 'healthy') {
      showResult(
        '✅ <strong>Backend ทำงานปกติ</strong><br/>' +
        '<small>Phase: ' + escapeHtml(data.phase) + ' | Node: ' + escapeHtml(data.node_version) + ' | Uptime: ' + data.uptime_seconds + 's</small>',
        'success'
      );
    } else {
      showResult('⚠️ <strong>Backend ตอบกลับผิดปกติ:</strong> HTTP ' + resp.status, 'error');
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
      card.querySelector('.status-desc').textContent = 'Backend ตอบไม่ปกติ';
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
