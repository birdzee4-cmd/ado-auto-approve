/**
 * POST /api/test-exception-scan
 *
 * Runs the Build/Policy exception scan from System Health.
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

  try {
    const scanner = require('../exception-scan');
    await scanner(context, {
      headers: {
        'x-exception-scan-token': process.env.EXCEPTION_SCAN_TOKEN || process.env.DAILY_SUMMARY_TOKEN
      },
      body: {
        lookbackHours: 24,
        maxLogs: Number(process.env.EXCEPTION_SCAN_LOG_LIMIT || 500),
        maxPrs: Number(process.env.EXCEPTION_SCAN_PR_LIMIT || 80)
      }
    });
  } catch (err) {
    context.log.error('Test exception scan failed:', err);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: false, error: 'Unexpected server error', detail: err.message })
    };
  }
};
