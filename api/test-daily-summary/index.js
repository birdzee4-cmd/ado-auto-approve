/**
 * POST /api/test-daily-summary
 *
 * ส่ง Daily Summary จริงในโหมดทดสอบจากหน้า System Health
 * แยก event key และ SharePoint log จากรอบ schedule เวลา 18:00
 */

module.exports = async function (context, req) {
  const principalHeader = req.headers && req.headers['x-ms-client-principal'];
  if (!principalHeader) {
    context.res = {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: false, error: 'Authentication required' })
    };
    return;
  }

  let requestedBy = 'Unknown User';
  try {
    const principal = JSON.parse(Buffer.from(principalHeader, 'base64').toString('utf-8'));
    requestedBy = principal.userDetails || requestedBy;
  } catch (e) {
    context.log.warn('Failed to decode principal:', e.message);
  }

  const dailySummary = require('../daily-summary');
  await dailySummary(context, {
    headers: {
      'x-daily-summary-token': process.env.DAILY_SUMMARY_TOKEN
    },
    body: {
      testMode: true,
      requestedBy: requestedBy,
      source: 'Dashboard Test'
    }
  });
};
