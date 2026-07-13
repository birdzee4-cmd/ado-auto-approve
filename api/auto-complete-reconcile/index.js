/**
 * POST /api/auto-complete-reconcile
 *
 * Background reconciler for Azure Logic Apps Consumption.
 * Restores Azure DevOps auto-complete for active PRs that were previously
 * Auto Approved but lost autoCompleteSetBy after abandon/reactivate.
 */

const reconciler = require('../shared/auto-complete-reconciler');

module.exports = async function (context, req) {
  function jsonResponse(status, payload) {
    context.res = {
      status: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    };
  }

  try {
    const expectedToken = process.env.AUTO_COMPLETE_RECONCILE_TOKEN || process.env.DAILY_SUMMARY_TOKEN || '';
    if (!expectedToken) {
      jsonResponse(500, { ok: false, error: 'AUTO_COMPLETE_RECONCILE_TOKEN or DAILY_SUMMARY_TOKEN is not configured' });
      return;
    }

    const suppliedToken = getHeader(req, 'x-auto-complete-reconcile-token') ||
      getHeader(req, 'x-daily-summary-token') ||
      (req.query && req.query.token);
    if (suppliedToken !== expectedToken) {
      jsonResponse(401, { ok: false, error: 'Unauthorized' });
      return;
    }

    const body = parseBody(req.body);
    const result = await reconciler.runAutoCompleteReconcile(context, {
      dryRun: body.dryRun
    });
    jsonResponse(result.ok ? 200 : 502, result);
  } catch (err) {
    context.log.error('Auto-complete reconcile failed:', err);
    jsonResponse(500, { ok: false, error: 'Unexpected server error', detail: err.message });
  }
};

function parseBody(body) {
  if (body && typeof body === 'object') return body;
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch (e) {}
  }
  return {};
}

function getHeader(req, name) {
  const headers = req && req.headers || {};
  const lower = String(name || '').toLowerCase();
  return headers[lower] || headers[name] || headers[Object.keys(headers).find(key => String(key).toLowerCase() === lower)] || '';
}
