const crypto = require('crypto');
const defaultSharePoint = require('./operations-sharepoint-client');

const RETRYABLE = new Set(['RECEIVED', 'FAILED', 'UNMATCHED']);

async function ingest(input, context = {}, dependencies = {}) {
  const sp = dependencies.sharePoint || defaultSharePoint;
  const event = normalizeEvent(input);
  validateEvent(event);
  const duplicate = await sp.findAlertEventByMessageId(event.messageId);
  if (duplicate) {
    await writeAudit(sp, context, duplicate, 'ALERT_EVENT_DUPLICATE', 'DUPLICATE');
    return { duplicate: true, event: duplicate };
  }
  const now = new Date().toISOString();
  const eventId = event.eventId || crypto.randomUUID();
  const created = await sp.createAlertEvent({
    Title: `${event.eventType} ${event.alertName}`.slice(0, 255), EventId: eventId, MessageId: event.messageId, EventType: event.eventType,
    IncidentId: event.incidentId, AlertName: event.alertName, Resource: event.resource,
    FirstSeenAt: event.firstSeenAt, ResolvedAt: event.resolvedAt || null,
    ReceivedAt: event.receivedAt, RawSubject: event.rawSubject,
    ProcessingStatus: 'RECEIVED', AttemptCount: 0
  });
  const stored = { ...event, eventId, sharePointId: Number(created && created.id), processingStatus: 'RECEIVED', attemptCount: 0, createdAt: now };
  await writeAudit(sp, context, stored, 'ALERT_EVENT_RECEIVED', 'SUCCEEDED');
  return { duplicate: false, event: await processEvent(stored, context, dependencies) };
}

async function processEvent(input, context = {}, dependencies = {}) {
  const sp = dependencies.sharePoint || defaultSharePoint;
  const event = typeof input === 'string' ? await sp.getAlertEvent(input) : input;
  if (!event) throw operationalError(404, 'ALERT_EVENT_NOT_FOUND', 'Alert event was not found');
  if (event.processingStatus === 'PROCESSED') return { ...event, idempotent: true };
  const attemptCount = Number(event.attemptCount || 0) + 1;
  if (attemptCount > 5) return updateEvent(sp, event, { ProcessingStatus: 'FAILED', AttemptCount: attemptCount, ErrorCode: 'RETRY_LIMIT', ErrorDetail: 'Retry limit exceeded' });

  if (event.eventType === 'FIRING') {
    return updateEvent(sp, event, { ProcessingStatus: 'PROCESSED', AttemptCount: attemptCount, ProcessedAt: new Date().toISOString(), MatchMethod: 'INGESTED' });
  }

  try {
    const incidents = await sp.listIncidents(1000);
    const result = correlate(event, incidents);
    if (result.status !== 'MATCHED') {
      const updated = await updateEvent(sp, event, {
        ProcessingStatus: result.status, AttemptCount: attemptCount,
        ErrorCode: result.errorCode, ErrorDetail: result.detail,
        MatchedIncidentId: '', MatchMethod: result.matchMethod || ''
      });
      await writeAudit(sp, context, updated, `ALERT_EVENT_${result.status}`, result.status, result.detail);
      return { ...updated, candidates: result.candidates || [] };
    }

    const incident = result.incident;
    const shadow = context.shadow !== false || !featureEnabled('OPERATIONS_ALERT_EVENT_WRITE_ENABLED');
    if (shadow) {
      const updated = await updateEvent(sp, event, {
        ProcessingStatus: 'MATCHED', AttemptCount: attemptCount,
        MatchedIncidentId: incident.incidentId, MatchMethod: result.matchMethod,
        ErrorCode: '', ErrorDetail: '', ProcessedAt: new Date().toISOString()
      });
      await writeAudit(sp, context, updated, 'ALERT_EVENT_MATCHED', 'SHADOW', result.matchMethod);
      return { ...updated, shadow: true, candidate: incidentSummary(incident) };
    }
    return applyResolved(sp, event, incident, result.matchMethod, context, attemptCount);
  } catch (err) {
    const failed = await updateEvent(sp, event, { ProcessingStatus: 'FAILED', AttemptCount: attemptCount, ErrorCode: err.code || 'PROCESSING_FAILED', ErrorDetail: String(err.message || err).slice(0, 500) });
    await writeAudit(sp, context, failed, 'ALERT_EVENT_FAILED', 'FAILED', failed.errorDetail).catch(() => {});
    throw err;
  }
}

async function previewEvent(input, dependencies = {}) {
  const sp = dependencies.sharePoint || defaultSharePoint;
  const event = typeof input === 'string' ? await sp.getAlertEvent(input) : input;
  if (!event) throw operationalError(404, 'ALERT_EVENT_NOT_FOUND', 'Alert event was not found');
  if (event.eventType === 'FIRING') return { event, status: 'PROCESSED', matchMethod: 'INGESTED', dryRun: true };
  const result = correlate(event, await sp.listIncidents(1000));
  return { event, ...result, incident: result.incident ? incidentSummary(result.incident) : undefined, dryRun: true };
}

async function confirmMatch(eventId, incidentId, context = {}, dependencies = {}) {
  const sp = dependencies.sharePoint || defaultSharePoint;
  const event = await sp.getAlertEvent(eventId);
  if (!event) throw operationalError(404, 'ALERT_EVENT_NOT_FOUND', 'Alert event was not found');
  const incident = await sp.getIncident(incidentId);
  if (!incident) throw operationalError(404, 'INCIDENT_NOT_FOUND', 'Incident was not found');
  const guard = validateCandidate(event, incident, false);
  if (!guard.ok) throw operationalError(409, guard.errorCode, guard.detail);
  if (!featureEnabled('OPERATIONS_ALERT_EVENT_WRITE_ENABLED')) throw operationalError(503, 'FEATURE_DISABLED', 'Alert event writes are disabled');
  return applyResolved(sp, event, incident, 'MANUAL_CONFIRM', { ...context, shadow: false }, Number(event.attemptCount || 0) + 1);
}

async function rejectEvent(eventId, context = {}, dependencies = {}) {
  const sp = dependencies.sharePoint || defaultSharePoint;
  const event = await sp.getAlertEvent(eventId);
  if (!event) throw operationalError(404, 'ALERT_EVENT_NOT_FOUND', 'Alert event was not found');
  const updated = await updateEvent(sp, event, { ProcessingStatus: 'FAILED', ErrorCode: 'REJECTED_BY_OPERATOR', ErrorDetail: 'Rejected by operator', ProcessedAt: new Date().toISOString() });
  await writeAudit(sp, context, updated, 'ALERT_EVENT_REJECTED', 'SUCCEEDED');
  return updated;
}

function correlate(event, incidents) {
  const open = (incidents || []).filter(incident => validateCandidate(event, incident, true).ok);
  if (event.incidentId) {
    const direct = open.filter(item => normalize(item.incidentId) === normalize(event.incidentId) || normalize(item.displayId) === normalize(event.incidentId));
    if (direct.length === 1) return { status: 'MATCHED', incident: direct[0], matchMethod: 'INCIDENT_ID' };
    if (direct.length > 1) return ambiguous(direct, 'Multiple incidents matched the supplied Incident ID');
    return unmatched('No open FIRING incident matched the supplied Incident ID');
  }
  const exact = open.filter(item => sameInstant(item.firstSeen, event.firstSeenAt));
  if (exact.length === 1) return { status: 'MATCHED', incident: exact[0], matchMethod: 'ALERT_RESOURCE_FIRST_SEEN' };
  if (exact.length > 1) return ambiguous(exact, 'Multiple incidents matched Alert, Resource and First Seen');
  return unmatched('No exact Alert, Resource and First Seen match was found');
}

function validateCandidate(event, incident, requireFirstSeen) {
  if (String(incident.status || '').toUpperCase() !== 'FIRING' || incident.resolvedAt) return invalid('INCIDENT_NOT_OPEN', 'Incident must be FIRING with no ResolvedAt');
  if (normalize(incident.alertName) !== normalize(event.alertName)) return invalid('ALERT_MISMATCH', 'Alert name does not match');
  if (normalize(incident.resource) !== normalize(event.resource)) return invalid('RESOURCE_MISMATCH', 'Resource does not match');
  if (requireFirstSeen && event.incidentId === '' && !sameInstant(incident.firstSeen, event.firstSeenAt)) return invalid('FIRST_SEEN_MISMATCH', 'First Seen does not match');
  if (!event.resolvedAt || Date.parse(event.resolvedAt) <= Date.parse(incident.firstSeen || '')) return invalid('INVALID_TIME_SEQUENCE', 'ResolvedAt must be after Incident FirstSeenAt');
  return { ok: true };
}

async function applyResolved(sp, event, incident, matchMethod, context, attemptCount) {
  const workflowStatus = ['RECEIVED', 'AWAITING_APPROVAL'].includes(String(incident.workflowStatus || '').toUpperCase()) ? 'CANCELLED' : (incident.workflowStatus || 'CREATED');
  await sp.updateIncidentRecord(incident.sharePointId, {
    AlertStatus: 'RESOLVED', WorkflowStatus: workflowStatus, ResolvedAt: event.resolvedAt,
    LastAlertAt: event.receivedAt, LastSyncedAt: new Date().toISOString(), LastSourceMessageId: event.messageId
  });
  const updated = await updateEvent(sp, event, {
    ProcessingStatus: 'PROCESSED', AttemptCount: attemptCount,
    MatchedIncidentId: incident.incidentId, MatchMethod: matchMethod,
    ErrorCode: '', ErrorDetail: '', ProcessedAt: new Date().toISOString()
  });
  await writeAudit(sp, context, updated, 'ALERT_EVENT_RESOLVED_APPLIED', 'SUCCEEDED', matchMethod, incident.incidentId);
  return { ...updated, updated: true, candidate: incidentSummary(incident) };
}

async function updateEvent(sp, event, fields) {
  await sp.updateAlertEvent(event.sharePointId, fields);
  return { ...event, processingStatus: fields.ProcessingStatus || event.processingStatus, attemptCount: fields.AttemptCount ?? event.attemptCount, matchedIncidentId: fields.MatchedIncidentId ?? event.matchedIncidentId, matchMethod: fields.MatchMethod ?? event.matchMethod, errorCode: fields.ErrorCode ?? event.errorCode, errorDetail: fields.ErrorDetail ?? event.errorDetail, processedAt: fields.ProcessedAt ?? event.processedAt };
}

async function writeAudit(sp, context, event, action, result, detail = '', incidentId = '') {
  if (typeof sp.appendAudit !== 'function') return;
  const actor = context.operationsIdentity || {};
  await sp.appendAudit({
    EventId: crypto.randomUUID(), EventKey: `${action}:${event.eventId}`,
    CorrelationId: context.correlationId || crypto.randomUUID(), IncidentId: incidentId || event.matchedIncidentId || event.incidentId || '',
    Action: action, Result: result, OperationsUserId: actor.id || '', OperationsUserName: actor.name || '', OperationsUserEmail: actor.email || '',
    Detail: JSON.stringify({ alertEventId: event.eventId, messageId: event.messageId, detail }), OccurredAt: new Date().toISOString()
  });
}

function normalizeEvent(input = {}) {
  return {
    eventId: String(input.eventId || '').trim(), messageId: String(input.messageId || '').trim(),
    eventType: String(input.eventType || '').trim().toUpperCase(), incidentId: String(input.incidentId || '').trim(),
    alertName: String(input.alertName || '').trim(), resource: String(input.resource || '').trim(),
    firstSeenAt: iso(input.firstSeenAt), resolvedAt: iso(input.resolvedAt),
    receivedAt: iso(input.receivedAt) || new Date().toISOString(), rawSubject: String(input.rawSubject || '').trim().slice(0, 500)
  };
}

function validateEvent(event) {
  const missing = ['messageId', 'eventType', 'alertName', 'resource', 'firstSeenAt'].filter(key => !event[key]);
  if (missing.length) throw operationalError(422, 'INVALID_ALERT_EVENT', `Missing or invalid fields: ${missing.join(', ')}`);
  if (!['FIRING', 'RESOLVED'].includes(event.eventType)) throw operationalError(422, 'INVALID_EVENT_TYPE', 'EventType must be FIRING or RESOLVED');
  if (event.eventType === 'RESOLVED' && !event.resolvedAt) throw operationalError(422, 'RESOLVED_AT_REQUIRED', 'ResolvedAt is required for RESOLVED events');
}

function featureEnabled(name) { return String(process.env[name] || '').trim().toLowerCase() === 'true'; }
function normalize(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function iso(value) { if (!value) return ''; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString(); }
function sameInstant(left, right) { return Boolean(left && right) && Date.parse(left) === Date.parse(right); }
function invalid(errorCode, detail) { return { ok: false, errorCode, detail }; }
function unmatched(detail) { return { status: 'UNMATCHED', errorCode: 'NO_EXACT_MATCH', detail, candidates: [] }; }
function ambiguous(items, detail) { return { status: 'AMBIGUOUS', errorCode: 'MULTIPLE_EXACT_MATCHES', detail, candidates: items.map(incidentSummary) }; }
function incidentSummary(item) { return { incidentId: item.incidentId, displayId: item.displayId, alertName: item.alertName, resource: item.resource, firstSeenAt: item.firstSeen, status: item.status }; }
function operationalError(status, code, message) { const error = new Error(message); error.status = status; error.code = code; return error; }

module.exports = { RETRYABLE, ingest, processEvent, previewEvent, confirmMatch, rejectEvent, correlate, validateCandidate, normalizeEvent, validateEvent, featureEnabled };
