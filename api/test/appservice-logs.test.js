const assert = require('node:assert/strict');
const test = require('node:test');
const handlers = require('../shared/appservice-portal-handlers');
const audit = require('../shared/appservice-audit-client');

function principal(roles) {
  return Buffer.from(JSON.stringify({ userId: 'operator', userRoles: roles })).toString('base64');
}

test('Portal log search scans older rows and matches Incident and Work Item IDs exactly', async () => {
  const original = audit.getRecentAuditItems;
  const calls = [];
  audit.getRecentAuditItems = async (top, scanLimit) => {
    calls.push({ top, scanLimit });
    return {
      ok: true,
      body: {
        value: [
          { id: '1', fields: { Action: 'RestartAppService', Incident_ID: 'INC-10', Work_Item_ID: '42', Environment: 'PRD' } },
          { id: '2', fields: { Action: 'RestartAppService', Incident_ID: 'INC-100', Work_Item_ID: '420', Environment: 'PRD' } },
          { id: '3', fields: { Action: 'ViewSettings', Incident_ID: 'INC-10', Work_Item_ID: '42' } }
        ],
        hasMore: true
      }
    };
  };

  try {
    const context = { log: { error() {} } };
    await handlers.handleLogs(context, {
      headers: { 'x-ms-client-principal': principal(['tester_appservice_manager']) },
      query: { incident: 'inc-10', workItem: '42', top: '50' }
    });
    const body = JSON.parse(context.res.body);
    assert.equal(context.res.status, 200);
    assert.deepEqual(calls, [{ top: 50, scanLimit: 1000 }]);
    assert.equal(body.count, 1);
    assert.equal(body.items[0].incidentId, 'INC-10');
    assert.equal(body.items[0].workItemId, '42');
    assert.equal(body.hasMore, true);
  } finally {
    audit.getRecentAuditItems = original;
  }
});

test('Portal displays inferred PRD only when an older Hub row has no environment', async () => {
  const original = audit.getRecentAuditItems;
  audit.getRecentAuditItems = async () => ({ ok: true, body: { value: [
    { id: '1', fields: { Action: 'RestartAppService', Log_Source: 'Incident Command Center',
      App_Service_Name: 'prd-checkout', Environment: 'UNKNOWN' } },
    { id: '2', fields: { Action: 'RestartAppService', Log_Source: 'App Service Portal',
      App_Service_Name: 'prd-test', Environment: 'STG' } }
  ] } });
  try {
    const context = { log: { error() {} } };
    await handlers.handleLogs(context, {
      headers: { 'x-ms-client-principal': principal(['tester_appservice_manager']) }, query: {}
    });
    const items = JSON.parse(context.res.body).items;
    assert.equal(items[0].environment, 'STG');
    assert.equal(items[0].environmentInferred, false);
    assert.equal(items[1].environment, 'PRD');
    assert.equal(items[1].environmentInferred, true);
  } finally {
    audit.getRecentAuditItems = original;
  }
});
