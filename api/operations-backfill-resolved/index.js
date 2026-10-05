const crypto = require('crypto');
const auth = require('../shared/auth');
const sharePoint = require('../shared/operations-sharepoint-client');
const alertService = require('../shared/operations-alert-service');

// Backward-compatible wrapper. New clients should use
// POST /api/operations/incidents/{incidentId}/resolved-backfill.
module.exports = async function (context, req) {
  const role = auth.requireAnyRole(context, req, ['admin', 'it_support_approve']);
  if (!role.ok) return respond(context, role.status, role.body);
  try {
    const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');
    const incident = await sharePoint.getIncident(body.incidentId || body.displayId);
    if (!incident) return respond(context, 404, { ok: false, error: 'INCIDENT_NOT_FOUND' });
    const resolvedAt = normalizeIso(body.resolvedAt);
    if (!resolvedAt) return respond(context, 422, { ok: false, error: 'RESOLVED_AT_REQUIRED' });
    const dryRun = body.dryRun !== false;
    if (!dryRun && body.confirmWrite !== true) return respond(context, 400, { ok: false, error: 'CONFIRM_WRITE_REQUIRED' });
    const actionContext = {
      correlationId: String(req.headers && (req.headers['x-correlation-id'] || req.headers['x-ms-request-id']) || crypto.randomUUID()),
      operationsIdentity: { id: role.principal.userId || '', name: role.principal.userDetails || '', email: auth.getUserEmail(role.principal) || '' },
      shadow: dryRun
    };
    const result = await alertService.ingest({
      messageId: String(body.sourceMessageId || `legacy-backfill:${incident.incidentId}:${resolvedAt}`),
      eventType: 'RESOLVED', incidentId: incident.incidentId,
      alertName: body.alertName || incident.alertName, resource: body.resource || incident.resource,
      firstSeenAt: incident.firstSeen, resolvedAt, receivedAt: body.receivedAt || resolvedAt,
      rawSubject: body.rawSubject || 'Legacy RESOLVED backfill'
    }, actionContext);
    return respond(context, result.duplicate ? 200 : 202, { ok: true, dryRun, data: result });
  } catch (err) {
    context.log.error('Operations RESOLVED backfill failed:', err);
    return respond(context, Number(err.status) || 503, { ok: false, error: err.code || 'RESOLVED_BACKFILL_FAILED', detail: err.message });
  }
};

function normalizeIso(value) { const date = new Date(String(value || '')); return Number.isNaN(date.getTime()) ? '' : date.toISOString(); }
function respond(context, status, body) { context.res = { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body }; return context.res; }
