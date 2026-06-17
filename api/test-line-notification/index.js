/**
 * POST /api/test-line-notification
 *
 * ทดสอบส่ง message เข้า LINE Messaging API
 * ต้อง login ผ่าน Entra ID
 */

module.exports = async function (context, req) {
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

    // ---- 3) ตรวจว่ามี LINE configuration ----
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || !process.env.LINE_TARGET_ID) {
      const missing = [];
      if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) missing.push('LINE_CHANNEL_ACCESS_TOKEN');
      if (!process.env.LINE_TARGET_ID) missing.push('LINE_TARGET_ID');
      jsonResponse(500, {
        ok: false,
        error: 'LINE Notifier is not fully configured',
        hint: `กรุณาเพิ่ม: ${missing.join(', ')} ใน environment variables`
      });
      return;
    }

    // ---- 4) Lazy require ----
    let lineNotifier;
    try {
      lineNotifier = require('../shared/line-notifier');
    } catch (e) {
      context.log.error('Failed to load line-notifier:', e);
      jsonResponse(500, {
        ok: false,
        error: 'Failed to load shared line notifier module',
        detail: e.message
      });
      return;
    }

    // ---- 5) ส่งข้อความ ----
    let result;
    try {
      const message = `🔔 [TEST] LINE Notification\nผู้ทดสอบ: ${userName}\nระบบเชื่อมต่อ LINE Messaging API สำเร็จแล้ว! 🎉\nเวลาทดสอบ: ${new Date().toLocaleString('th-TH')}`;
      result = await lineNotifier.sendLinePush(message);
    } catch (e) {
      context.log.error('sendLinePush threw:', e);
      jsonResponse(500, {
        ok: false,
        error: 'Failed to send to LINE',
        detail: e.message
      });
      return;
    }

    if (!result.ok) {
      jsonResponse(502, {
        ok: false,
        error: 'LINE API returned non-2xx',
        lineStatus: result.status,
        lineBody: (result.body || '').substring(0, 500),
        hint: 'โปรดตรวจสอบ LINE_CHANNEL_ACCESS_TOKEN และ LINE_TARGET_ID'
      });
      return;
    }

    // ---- 6) Success ----
    jsonResponse(200, {
      ok: true,
      message: 'Test LINE notification sent successfully',
      sentBy: userName,
      timestamp: new Date().toISOString(),
      lineStatus: result.status
    });

  } catch (err) {
    context.log.error('Unexpected LINE test error:', err);
    jsonResponse(500, {
      ok: false,
      error: 'Unexpected server error',
      detail: err && err.message ? err.message : String(err)
    });
  }
};
