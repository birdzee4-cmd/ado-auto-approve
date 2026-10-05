const crypto = require('crypto');
const auth = require('../shared/auth');
const sharePoint = require('../shared/operations-sharepoint-client');

// Controlled repair for RESOLVED messages that were missed by Power Automate.
// Default is a read-only dry run. This endpoint does not read or resend mail.
module.exports = async function (context, req) {
  const role = auth.requireAnyRole(context, req, ['admin', 'it_support_approve']);
  if (!role.ok) return respond(context, role.status, role.body);

  const body = parseBody(req && req.body);
  const incidentKey = String(body.incidentId || body.displayId || '').trim();
  const resolvedAt = normalizeIso(body.resolvedAt);
  const sourceMessageId = String(body.sourceMessageId || '').trim();
  const expectedAlert = String(body.alertName || '').trim();
  const expectedResource = String(body.resource || '').trim();
  const dryRun = body.dryRun !== false;
  const confirmWrite = body.confirmWrite === true;

  if (!incidentKey) return respond(context, 422, { ok: false, error: 'INCIDENT_ID_REQUIRED' });
  if (!resolvedAt) return respond(context, 422, { ok: false, error: 'RESOLVED_AT_REQUIRED', detail: 'Use an ISO-8601 timestamp.' });
  if (!dryRun && !confirmWrite) return respond(context, 400, { ok: false, error: 'CONFIRM_WRITE_REQUIRED', detail: 'Set confirmWrite=true for the write operation.' });
  if (!dryRun && String(process.env.OPERATIONS_RESOLVED_BACKFILL_ENABLED).toLowerCase() !== 'true') {
    return respond(context, 503, { ok: false, error: 'FEATURE_DISABLED' });
  }

  try {
    const incidents = await sharePoint.listIncidents(1000);
    const incident = incidents.find(item => String(item.incidentId || '').toLowerCase() === incidentKey.toLowerCase() || String(item.displayId || '').toLowerCase() === incidentKey.toLowerCase());
    if (!incident) return respond(context, 404, { ok: false, error: 'INCIDENT_NOT_FOUND', incidentId: incidentKey });

    const checks = {
      statusIsFiring: String(incident.status || '').toUpperCase() === 'FIRING',
      alertMatches: !expectedAlert || normalize(incident.alertName) === normalize(expectedAlert),
      resourceMatches: !expectedResource || normalize(incident.resource) === normalize(expectedResource),
      resolvedAfterFirstSeen: !incident.firstSeenAt || Date.parse(resolvedAt) > Date.parse(incident.firstSeenAt)
    };
    const safe = Object.values(checks).every(Boolean);
    const preview = { incidentId: incident.incidentId, displayId: incident.displayId, currentStatus: incident.status, currentResolvedAt: incident.resolvedAt || '', alertName: incident.alertName, resource: incident.resource, resolvedAt, sourceMessageId, checks, willWrite: safe && !dryRun };
    if (!safe) return respond(context, 409, { ok: false, dryRun: true, error: 'BACKFILL_GUARD_FAILED', ...preview });
    if (dryRun) return respond(context, 200, { ok: true, dryRun: true, ...preview });

    const workflowStatus = ['RECEIVED', 'AWAITING_APPROVAL'].includes(String(incident.workflowStatus || '').toUpperCase()) ? 'CANCELLED' : (incident.workflowStatus || 'CREATED');
    await sharePoint.updateIncidentRecord(incident.sharePointId, {
      AlertStatus: 'RESOLVED',
      WorkflowStatus: workflowStatus,
      ResolvedAt: resolvedAt,
      LastSyncedAt: new Date().toISOString(),
      ...(sourceMessageId ? { LastSourceMessageId: sourceMessageId } : {})
    });
    await sharePoint.appendAudit({
      EventId: crypto.randomUUID(), EventKey: `RESOLVED_BACKFILL:${incident.incidentId}:${resolvedAt}`,
      CorrelationId: String(req.headers && (req.headers['x-correlation-id'] || req.headers['x-ms-request-id']) || crypto.randomUUID()),
      IncidentId: incident.incidentId, Action: 'RESOLVED_BACKFILL', Result: 'SUCCEEDED',
      OperationsUserId: role.principal.userId || '', OperationsUserName: role.principal.userDetails || '',
      OperationsUserEmail: auth.getUserEmail(role.principal) || '', Detail: JSON.stringify({ resolvedAt, sourceMessageId, checks }), OccurredAt: new Date().toISOString()
    });
    return respond(context, 200, { ok: true, dryRun: false, ...preview, updated: true });
  } catch (err) {
    context.log.error('Operations RESOLVED backfill failed:', err);
    return respond(context, Number(err.status) || 503, { ok: false, error: 'RESOLVED_BACKFILL_FAILED', detail: err.message });
  }
};

function normalize(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function normalizeIso(value) { const date = new Date(String(value || '')); return Number.isNaN(date.getTime()) ? '' : date.toISOString(); }
function parseBody(value) { if (value && typeof value === 'object') return value; try { return value ? JSON.parse(value) : {}; } catch (_) { return {}; } }
function respond(context, status, body) { context.res = { status, headers: { 'Content-Type': 'application/json' }, body }; return context.res; }
