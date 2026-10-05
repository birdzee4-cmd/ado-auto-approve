const assert = require('node:assert/strict');
const test = require('node:test');
const operations = require('../operations');
const alertService = require('../shared/operations-alert-service');
const sharePoint = require('../shared/operations-sharepoint-client');

function principal(roles) {
  return Buffer.from(JSON.stringify({ userId: 'operator', userDetails: 'operator@example.com', userRoles: roles })).toString('base64');
}

test('Power Automate ingestion requires the automation key and stays in shadow context', async () => {
  const previousKey = process.env.OPERATIONS_AUTOMATION_KEY;
  const originalIngest = alertService.ingest;
  process.env.OPERATIONS_AUTOMATION_KEY = 'test-alert-key';
  let receivedContext;
  alertService.ingest = async (body, context) => {
    receivedContext = context;
    return { duplicate: false, event: { eventId: 'evt-1', ...body } };
  };
  try {
    const denied = { log: { warn() {}, error() {} } };
    await operations(denied, { method: 'POST', params: { path: 'alert-events' }, headers: {}, body: {} });
    assert.equal(denied.res.status, 401);

    const accepted = { log: { warn() {}, error() {} } };
    await operations(accepted, {
      method: 'POST', params: { path: 'alert-events' },
      headers: { 'x-operations-automation-key': 'test-alert-key' },
      body: { messageId: 'msg-1', eventType: 'RESOLVED' }
    });
    assert.equal(accepted.res.status, 202);
    assert.equal(receivedContext.operationsIdentity.id, 'power-automate');
    assert.equal(receivedContext.shadow, true);
  } finally {
    alertService.ingest = originalIngest;
    if (previousKey === undefined) delete process.env.OPERATIONS_AUTOMATION_KEY;
    else process.env.OPERATIONS_AUTOMATION_KEY = previousKey;
  }
});

test('authorized operators can list alert events', async () => {
  const original = sharePoint.listAlertEvents;
  sharePoint.listAlertEvents = async () => [{ eventId: 'evt-1', processingStatus: 'UNMATCHED' }];
  try {
    const context = { log: { warn() {}, error() {} } };
    await operations(context, {
      method: 'GET', params: { path: 'alert-events' }, query: { status: 'UNMATCHED' },
      headers: { 'x-ms-client-principal': principal(['it_support_approve']) }
    });
    assert.equal(context.res.status, 200);
    assert.equal(JSON.parse(context.res.body).data.items[0].eventId, 'evt-1');
  } finally {
    sharePoint.listAlertEvents = original;
  }
});
