const crypto = require('crypto');

const SYSTEM_INCIDENT_ID = '__OPERATIONS_HUB_GLOBAL__';
const AUTO_RESTART_ACTION = 'GLOBAL_AUTO_RESTART_CONFIG';

async function getAutoRestart(sharePoint) {
  if (!sharePoint || typeof sharePoint.listAudit !== 'function') return { enabled: false, configured: false, changedAt: '', changedBy: '' };
  const events = await sharePoint.listAudit(SYSTEM_INCIDENT_ID);
  const latest = events
    .filter(event => String(event.eventType || '').toUpperCase() === AUTO_RESTART_ACTION)
    .sort((a, b) => (Date.parse(b.timestamp || '') || 0) - (Date.parse(a.timestamp || '') || 0))[0];
  return { enabled: String(latest?.result || '').toUpperCase() === 'ENABLED', configured: Boolean(latest), changedAt: latest?.timestamp || '', changedBy: latest?.operationsUserEmail || latest?.operationsUserName || '' };
}

async function setAutoRestart(sharePoint, context, enabled) {
  if (!sharePoint || typeof sharePoint.appendAudit !== 'function') throw Object.assign(new Error('Operations audit list is not configured'), { status: 503, code: 'GLOBAL_SETTING_UNAVAILABLE' });
  const operations = context.operationsIdentity || {};
  const now = new Date().toISOString();
  await sharePoint.appendAudit({
    Title: AUTO_RESTART_ACTION,
    EventId: crypto.randomUUID(),
    EventKey: `${AUTO_RESTART_ACTION}:${now}`,
    CorrelationId: context.correlationId || '',
    IncidentId: SYSTEM_INCIDENT_ID,
    WorkItemId: null,
    Action: AUTO_RESTART_ACTION,
    Result: enabled ? 'ENABLED' : 'DISABLED',
    OperationsUserId: operations.id || '',
    OperationsUserName: operations.name || '',
    OperationsUserEmail: operations.email || '',
    AdoIdentityId: '', AdoIdentityName: '', AdoIdentityEmail: '',
    Detail: enabled ? 'Global automatic P1 App Service restart enabled from Operations Hub.' : 'Global automatic P1 App Service restart disabled from Operations Hub.',
    OccurredAt: now
  });
  return getAutoRestart(sharePoint);
}

module.exports = { SYSTEM_INCIDENT_ID, AUTO_RESTART_ACTION, getAutoRestart, setAutoRestart };
