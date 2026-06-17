import {
  safeFetchJson, escapeHtml, showBox, setButtonLoading,
  bind, formatDate, initPage, checkHealthStatus,
  renderSystemHealth, renderSystemHealthError
} from './core.js';

// Helper to show test results (re-implemented local helper from monolithic showResult)
function showResult(message, type) {
  showBox('testResult', message, type || 'info');
}

// ===== Test Functions =====
async function testTeams() {
  setButtonLoading('btnTestTeams', true);
  showResult('⏳ Sending test message...', 'info');
  try {
    const r = await safeFetchJson('/api/test-notification', { method: 'POST' });
    if (r.parseError) { showResult('❌ ตอบกลับไม่ใช่ JSON (HTTP ' + r.status + ')', 'error'); return; }
    if (r.ok && r.data && r.data.ok) showResult('✅ ส่งสำเร็จ! ตรวจ Teams channel', 'success');
    else { const d = r.data || {}; showResult('❌ ' + (d.error || 'Unknown'), 'error'); }
  } catch (err) { showResult('❌ ' + err.message, 'error'); }
  finally { setButtonLoading('btnTestTeams', false); }
}

async function testLine() {
  setButtonLoading('btnTestLine', true);
  showResult('⏳ Sending LINE test message...', 'info');
  try {
    const r = await safeFetchJson('/api/test-line-notification', { method: 'POST' });
    if (r.parseError) { showResult('❌ ตอบกลับไม่ใช่ JSON (HTTP ' + r.status + ')', 'error'); return; }
    if (r.ok && r.data && r.data.ok) showResult('✅ ส่งสำเร็จ! ตรวจสอบแชท LINE', 'success');
    else { const d = r.data || {}; showResult('❌ ' + (d.error || 'Unknown'), 'error'); }
  } catch (err) { showResult('❌ ' + err.message, 'error'); }
  finally { setButtonLoading('btnTestLine', false); }
}

async function testHealth() {
  setButtonLoading('btnTestHealth', true);
  showResult('⏳ Checking...', 'info');
  try {
    const r = await safeFetchJson('/api/health');
    if (r.ok && r.data) {
      const status = r.data.status || 'unknown';
      const checks = Array.isArray(r.data.checks) ? r.data.checks : [];
      const failed = checks.filter(c => c.status === 'error').length;
      const warning = checks.filter(c => c.status === 'warning').length;
      const type = status === 'healthy' ? 'success' : (failed > 0 ? 'error' : 'info');
      showResult('✅ Health checked: ' + escapeHtml(status) +
        ' | checks ' + checks.length +
        ' | warning ' + warning +
        ' | error ' + failed, type);
      renderSystemHealth(r.data);
    } else { showResult('⚠️ HTTP ' + r.status, 'error'); }
  } catch (err) { showResult('❌ ' + err.message, 'error'); }
  finally { setButtonLoading('btnTestHealth', false); }
}

async function testDailySummary() {
  setButtonLoading('btnTestDailySummary', true);
  showResult('⏳ Generating [TEST] Daily Summary...', 'info');
  try {
    const r = await safeFetchJson('/api/test-daily-summary', { method: 'POST' });
    if (r.parseError) { showResult('❌ Response is not JSON (HTTP ' + r.status + ')', 'error'); return; }
    if (r.ok && r.data && r.data.ok) {
      const counts = r.data.summary && r.data.summary.counts || {};
      showResult('✅ [TEST] Daily Summary sent | New PR ' + (counts.createdToday || 0) +
        ' | Completed ' + (counts.completedToday || 0) +
        ' | Failed ' + (counts.failedOrPolicyFailed || 0), 'success');
    } else {
      const d = r.data || {};
      showResult('❌ ' + (d.error || 'Unknown'), 'error');
    }
  } catch (err) { showResult('❌ ' + err.message, 'error'); }
  finally { setButtonLoading('btnTestDailySummary', false); }
}

async function testExceptionScan() {
  setButtonLoading('btnTestExceptionScan', true);
  showResult('⏳ Scanning Build/Policy exceptions from approval logs...', 'info');
  try {
    const r = await safeFetchJson('/api/test-exception-scan', { method: 'POST' });
    if (r.parseError) { showResult('❌ Response is not JSON (HTTP ' + r.status + ')', 'error'); return; }
    if (r.ok && r.data) {
      const d = r.data;
      if (d.ok) {
        showResult('✅ Exception scan completed | PRs ' + (d.checkedPrs || 0) +
          ' | Alerts sent ' + (d.sent || 0) +
          ' | Skipped ' + (d.skipped || 0), 'success');
        checkHealthStatus();
      } else if (Array.isArray(d.errors) && d.errors.length > 0) {
        showResult('⚠️ Scan completed with warnings | PRs ' + (d.checkedPrs || 0) +
          ' | Alerts sent ' + (d.sent || 0) +
          ' | Skipped ' + (d.skipped || 0) +
          '<br><small style="display:block;margin-top:4px;max-height:100px;overflow-y:auto;text-align:left;">' +
          escapeHtml(d.errors.join(' | ')) + '</small>', 'warning');
        checkHealthStatus();
      } else {
        showResult('❌ ' + (d.error || d.detail || 'Unknown'), 'error');
      }
    } else {
      const d = r.data || {};
      showResult('❌ ' + (d.error || d.detail || 'Unknown'), 'error');
    }
  } catch (err) { showResult('❌ ' + err.message, 'error'); }
  finally { setButtonLoading('btnTestExceptionScan', false); }
}

// Page initialization
(async function init() {
  await initPage();
  bind('btnTestTeams', testTeams);
  bind('btnTestLine', testLine);
  bind('btnTestDailySummary', testDailySummary);
  bind('btnTestExceptionScan', testExceptionScan);
  bind('btnTestHealth', testHealth);
  bind('btnRefreshHealth', checkHealthStatus);
  await checkHealthStatus();
})();