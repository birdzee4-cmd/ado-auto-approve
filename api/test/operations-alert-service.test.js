const assert = require('node:assert/strict');
const test = require('node:test');
const service = require('../shared/operations-alert-service');

const event = {
  sharePointId: 10, eventId: 'evt-1', messageId: 'msg-1', eventType: 'RESOLVED',
  alertName: 'AzureAppServiceHigh5xxRateCritical', resource: 'prd-api',
  firstSeenAt: '2026-10-02T17:16:00.000Z', resolvedAt: '2026-10-02T17:31:00.000Z',
  receivedAt: '2026-10-02T17:32:00.000Z', processingStatus: 'RECEIVED', attemptCount: 0
};

const incident = {
  sharePointId: 22, incidentId: 'inc-1', displayId: 'INC-2026-000022',
  alertName: event.alertName, resource: event.resource, firstSeen: event.firstSeenAt,
  status: 'FIRING', workflowStatus: 'CREATED', resolvedAt: ''
};

test('exact Alert, Resource and First Seen produces one match', () => {
  const result = service.correlate(event, [incident]);
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.matchMethod, 'ALERT_RESOURCE_FIRST_SEEN');
  assert.equal(result.incident.incidentId, 'inc-1');
});

test('different First Seen remains unmatched without fuzzy matching', () => {
  const result = service.correlate({ ...event, firstSeenAt: '2026-10-02T17:15:00.000Z' }, [incident]);
  assert.equal(result.status, 'UNMATCHED');
  assert.equal(result.errorCode, 'NO_EXACT_MATCH');
});

test('multiple exact incidents are ambiguous', () => {
  const result = service.correlate(event, [incident, { ...incident, sharePointId: 23, incidentId: 'inc-2' }]);
  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.candidates.length, 2);
});

test('duplicate Message ID is idempotent and does not create or update an incident', async () => {
  let creates = 0;
  let incidentWrites = 0;
  const duplicate = { ...event, processingStatus: 'PROCESSED' };
  const sharePoint = {
    findAlertEventByMessageId: async () => duplicate,
    createAlertEvent: async () => { creates += 1; },
    updateIncidentRecord: async () => { incidentWrites += 1; },
    appendAudit: async () => {}
  };
  const result = await service.ingest(event, {}, { sharePoint });
  assert.equal(result.duplicate, true);
  assert.equal(creates, 0);
  assert.equal(incidentWrites, 0);
});

test('shadow processing records the candidate without updating the incident', async () => {
  const eventWrites = [];
  let incidentWrites = 0;
  const sharePoint = {
    listIncidents: async () => [incident],
    updateAlertEvent: async (id, fields) => eventWrites.push({ id, fields }),
    updateIncidentRecord: async () => { incidentWrites += 1; },
    appendAudit: async () => {}
  };
  const result = await service.processEvent(event, { shadow: true }, { sharePoint });
  assert.equal(result.processingStatus, 'MATCHED');
  assert.equal(result.matchedIncidentId, 'inc-1');
  assert.equal(incidentWrites, 0);
  assert.equal(eventWrites[0].fields.ProcessingStatus, 'MATCHED');
});

test('RESOLVED must be later than Incident First Seen', () => {
  const result = service.correlate({ ...event, resolvedAt: '2026-10-02T17:00:00.000Z' }, [incident]);
  assert.equal(result.status, 'UNMATCHED');
});

test('live exact match resolves an awaiting-approval incident without touching ADO', async () => {
  const previous = process.env.OPERATIONS_ALERT_EVENT_WRITE_ENABLED;
  process.env.OPERATIONS_ALERT_EVENT_WRITE_ENABLED = 'true';
  const incidentWrites = [];
  const eventWrites = [];
  const awaiting = { ...incident, workflowStatus: 'AWAITING_APPROVAL' };
  const sharePoint = {
    listIncidents: async () => [awaiting],
    updateIncidentRecord: async (id, fields) => incidentWrites.push({ id, fields }),
    updateAlertEvent: async (id, fields) => eventWrites.push({ id, fields }),
    appendAudit: async () => {}
  };
  try {
    const result = await service.processEvent(event, { shadow: false }, { sharePoint });
    assert.equal(result.updated, true);
    assert.equal(incidentWrites[0].fields.AlertStatus, 'RESOLVED');
    assert.equal(incidentWrites[0].fields.WorkflowStatus, 'CANCELLED');
    assert.equal(eventWrites[0].fields.ProcessingStatus, 'PROCESSED');
  } finally {
    if (previous === undefined) delete process.env.OPERATIONS_ALERT_EVENT_WRITE_ENABLED;
    else process.env.OPERATIONS_ALERT_EVENT_WRITE_ENABLED = previous;
  }
});
