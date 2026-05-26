/**
 * POST /api/test-notification
 *
 * ทดสอบส่ง message เข้า Teams Webhook
 * ต้อง login ผ่าน Entra ID
 *
 * รับประกัน: ทุก response เป็น JSON เสมอ (มี Content-Type ชัดเจน)
 */

module.exports = async function (context, req) {
  // helper: ตอบกลับเป็น JSON เสมอ
  function jsonResponse(status, payload) {
    context.res = {
      status: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    };
  }

  try {
    // ---- 1) ตรวจ auth ----
    const principalHeader = req.headers && req.headers['x-ms-client-principal'];
    if (!principalHeader) {
      jsonResponse(401, {
        ok: false,
        error: 'Authentication required',
        hint: 'Session อาจหมดอายุ — refresh หน้า dashboard แล้วลองใหม่'
      });
      return;
    }

    // ---- 2) Decode user info ----
    let userName = 'Unknown User';
    try {
      const decoded = Buffer.from(principalHeader, 'base64').toString('utf-8');
      const principal = JSON.parse(decoded);
      userName = principal.userDetails || 'Unknown User';
    } catch (e) {
      context.log.warn('Failed to decode principal:', e.message);
    }

    // ---- 3) ตรวจว่ามี TEAMS_WEBHOOK_URL ----
    if (!process.env.TEAMS_WEBHOOK_URL) {
      jsonResponse(500, {
        ok: false,
        error: 'TEAMS_WEBHOOK_URL is not configured',
        hint: 'เพิ่ม environment variable "TEAMS_WEBHOOK_URL" ใน Azure Portal → Static Web App → Configuration'
      });
      return;
    }

    // ---- 4) Lazy require (กัน crash ตอนโหลด) ----
    let notifier;
    try {
      notifier = require('../shared/teams-notifier');
    } catch (e) {
      context.log.error('Failed to load teams-notifier:', e);
      jsonResponse(500, {
        ok: false,
        error: 'Failed to load shared module',
        detail: e.message,
        hint: 'ตรวจว่าโฟลเดอร์ api/shared/ ถูก deploy ขึ้น Azure'
      });
      return;
    }

    // ---- 5) ส่งข้อความ ----
    let result;
    try {
      const card = notifier.buildTestCard(userName);
      result = await notifier.sendTeamsCard(card);
    } catch (e) {
      context.log.error('sendTeamsCard threw:', e);
      jsonResponse(500, {
        ok: false,
        error: 'Failed to send to Teams',
        detail: e.message
      });
      return;
    }

    if (!result.ok) {
      jsonResponse(502, {
        ok: false,
        error: 'Teams returned non-2xx',
        teamsStatus: result.status,
        teamsBody: (result.body || '').substring(0, 500),
        hint: 'ตรวจสอบ TEAMS_WEBHOOK_URL ว่า paste มาครบและยังใช้งานได้'
      });
      return;
    }

    // ---- 6) Success ----
    jsonResponse(200, {
      ok: true,
      message: 'Test notification sent successfully',
      sentBy: userName,
      timestamp: new Date().toISOString(),
      teamsStatus: result.status
    });

  } catch (err) {
    // Final safety net — never let exception escape
    context.log.error('Unexpected error:', err);
    jsonResponse(500, {
      ok: false,
      error: 'Unexpected server error',
      detail: err && err.message ? err.message : String(err)
    });
  }
};
