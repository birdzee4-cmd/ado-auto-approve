/**
 * ============================================
 * POST /api/test-notification
 * ============================================
 *
 * Endpoint สำหรับ user (ที่ login แล้วเท่านั้น) กดทดสอบ
 * ส่ง Adaptive Card ไปที่ Teams channel ที่ตั้งค่าไว้
 *
 * ใช้สำหรับ:
 *   - ตรวจว่า TEAMS_WEBHOOK_URL ใช้ได้
 *   - Smoke test หลัง deploy
 *
 * Authorization: ต้อง login ผ่าน Entra ID
 *   (Static Web Apps จะส่ง x-ms-client-principal header มาให้)
 */

const { sendTeamsCard, buildTestCard } = require('../shared/teams-notifier');

module.exports = async function (context, req) {
  // ตรวจสอบว่า user login แล้ว
  const principalHeader = req.headers['x-ms-client-principal'];
  if (!principalHeader) {
    context.res = {
      status: 401,
      body: { error: 'Authentication required' }
    };
    return;
  }

  // Decode user info
  let userName = 'Unknown User';
  try {
    const decoded = Buffer.from(principalHeader, 'base64').toString('utf-8');
    const principal = JSON.parse(decoded);
    userName = principal.userDetails || 'Unknown User';
  } catch (e) {
    context.log.warn('Failed to decode principal:', e.message);
  }

  // ส่งการ์ดทดสอบ
  try {
    const card = buildTestCard(userName);
    const result = await sendTeamsCard(card);

    if (!result.ok) {
      context.res = {
        status: 502,
        body: {
          ok: false,
          error: 'Teams returned non-2xx',
          teamsStatus: result.status,
          teamsBody: result.body
        }
      };
      return;
    }

    context.res = {
      status: 200,
      body: {
        ok: true,
        message: 'Test notification sent successfully',
        sentBy: userName,
        timestamp: new Date().toISOString()
      }
    };
  } catch (err) {
    context.log.error('Test notification failed:', err);
    context.res = {
      status: 500,
      body: {
        ok: false,
        error: err.message,
        hint: 'ตรวจสอบ TEAMS_WEBHOOK_URL ใน Configuration ของ Static Web App'
      }
    };
  }
};
