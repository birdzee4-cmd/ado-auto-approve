const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const root = process.argv[2];
if (!root) throw new Error('Usage: node scripts/validate-operations-hub-late-approval-guard.js <unpacked-package>');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const flowRoot = path.join(root, 'Microsoft.Flow/flows');
const id = read(path.join(flowRoot, 'manifest.json')).flowAssets.assetPaths[0];
const wrapper = read(path.join(flowRoot, id, 'definition.json'));
const workflow = wrapper.properties.definition;
const manifest = read(path.join(root, 'manifest.json'));
const version = workflow.contentVersion.replace(/\.0$/, '');
for (const name of [wrapper.properties.displayName, manifest.details.displayName, manifest.resources[id].details.displayName]) assert.ok(name.endsWith(`v${version}`));
const actions = workflow.actions.Scope_Process_Incident.actions.Condition_Message_Already_Processed.else.actions
  .Condition_Priority_is_P1_or_P2.actions.Condition_Is_RESOLVED.else.actions.Condition_FIRING_Incident_Exists.else.actions;
const guard = actions.Condition_Approval_Still_Current;
assert.ok(guard && !actions.Condition_Approved);
assert.deepEqual(actions.Get_Work_Item_After_Approval.runAfter, { Compose_Approver_Name: ['Succeeded'] });
assert.deepEqual(actions.Get_Incident_After_Approval.runAfter, { Get_Work_Item_After_Approval: ['Succeeded'] });
assert.deepEqual(guard.runAfter, { Get_Incident_After_Approval: ['Succeeded'] });
assert.deepEqual(workflow.actions.Terminate_After_Technical_Failure.runAfter, { Scope_Handle_Technical_Failure: ['Succeeded'] });
assert.equal(workflow.actions.Terminate_After_Technical_Failure.inputs.runStatus, 'Failed');

// Small WDL interpreter exercises the expressions actually shipped in the package.
function evaluate(source, context) {
  const text = source.slice(1);
  let offset = 0;
  const functions = {
    body: name => context.bodies[name], outputs: name => context.outputs[name],
    toUpper: value => String(value).toUpperCase(), coalesce: (...values) => values.find(value => value !== null && value !== undefined),
    empty: value => {
      if (value != null && !['string', 'object'].includes(typeof value)) throw new TypeError('WDL empty() does not accept ' + typeof value);
      return value == null || value === '' || (typeof value === 'object' && Object.keys(value).length === 0);
    },
    greater: (left, right) => left > right,
    contains: (array, value) => array.includes(value), createArray: (...values) => values,
    string: value => typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''), int: Number, ticks: value => Date.parse(value),
    setProperty: (object, key, value) => ({ ...object, [key]: value }), json: JSON.parse,
    concat: (...values) => values.join(''), utcNow: () => '2026-10-29T02:00:00Z'
  };
  function parse() {
    while (/\s/.test(text[offset] || '') && offset < text.length) offset++;
    let value;
    if (text[offset] === "'") {
      offset++; value = '';
      while (offset < text.length) {
        const char = text[offset++];
        if (char === "'") { if (text[offset] === "'") { value += "'"; offset++; } else break; }
        else value += char;
      }
    } else {
      const match = text.slice(offset).match(/^[A-Za-z_][A-Za-z_0-9]*|^\d+/);
      assert.ok(match, text.slice(offset));
      offset += match[0].length;
      if (text[offset] === '(') {
        offset++;
        const args = [];
        if (text[offset] !== ')') { do { args.push(parse()); if (text[offset] !== ',') break; offset++; } while (true); }
        assert.equal(text[offset++], ')');
        assert.ok(functions[match[0]], `Unsupported WDL: ${match[0]}`);
        value = functions[match[0]](...args);
      } else value = match[0] === 'true' ? true : match[0] === 'false' ? false : Number(match[0]);
    }
    while (text[offset] === '?' || text[offset] === '[') {
      if (text[offset] === '?') offset++;
      assert.equal(text[offset++], '[');
      const key = parse(); assert.equal(text[offset++], ']'); value = value?.[key];
    }
    return value;
  }
  const result = parse(); assert.equal(offset, text.length, text.slice(offset)); return result;
}
function condition(expression, context) {
  if (expression.and) return expression.and.every(item => condition(item, context));
  if (expression.equals) return expression.equals.map(value => typeof value === 'string' && value.startsWith('@') ? evaluate(value, context) : value).reduce((left, right) => left === right);
  throw new Error('Unsupported condition');
}
const incident = { IncidentId: 'incident-one', AdoWorkItemId: 897133, AlertStatus: 'FIRING', WorkflowStatus: 'AWAITING_APPROVAL', '@odata.etag': '"7"', ApprovalRequestedAt: '2026-10-28T22:43:00Z', ApprovalAttempt: 1 };
const workItem = { rev: 8, fields: { 'System.State': 'New' } };
const outputValues = { Compose_IncidentId: 'incident-one', Compose_Approver_Name: 'Bird "quoted"\nName', Compose_Approver_Email: 'bird@example.com', Compose_ApprovalResult: 'Approve' };
function context(item = incident, ado = workItem) {
  return { bodies: { Start_and_wait_for_an_approval: { approvalId: 'approval-one', responses: [{ responder: { displayName: outputValues.Compose_Approver_Name }, comments: 'Reviewed "overnight"\nincident' }] }, Update_incident_AWAITING_APPROVAL: incident, Get_Incident_After_Approval: item, Get_Work_Item_After_Approval: ado, Create_Azure_DevOps_work_item: { id: 897133 } },
    outputs: { ...outputValues, Get_Incident_After_Approval: { headers: { ETag: item['@odata.etag'] } } } };
}
let count = 0;
function check(name, callback) { callback(); count++; console.log(`PASS ${name}`); }
check('active approval can proceed', () => assert.equal(condition(guard.expression, context()), true));
check('WDL empty rejects integer revision (production regression)', () => assert.throws(() => evaluate("@empty(body('Get_Work_Item_After_Approval')?['rev'])", context()), /does not accept number/));
check('positive integer revision passes without empty()', () => assert.equal(condition(guard.expression, context(incident, { ...workItem, rev: 2 })), true));
check('string revision is normalized', () => assert.equal(condition(guard.expression, context(incident, { ...workItem, rev: '2' })), true));
for (const rev of [0, null, undefined, -1]) check(`invalid revision ${rev} fails closed`, () => assert.equal(condition(guard.expression, context(incident, { ...workItem, rev })), false));
check('new approval attempt supersedes old response', () => assert.equal(condition(guard.expression, context({ ...incident, ApprovalAttempt: 2 })), false));
check('new approval request supersedes old response', () => assert.equal(condition(guard.expression, context({ ...incident, ApprovalRequestedAt: '2026-10-29T01:00:00Z' })), false));
check('equivalent request timestamps match', () => assert.ok(condition(guard.expression, context({ ...incident, ApprovalRequestedAt: '2026-10-28T22:43:00.000Z' }))));
for (const [name, change] of Object.entries({ recovered: { AlertStatus: 'RESOLVED' }, cancelled: { WorkflowStatus: 'CANCELLED' }, resolvedTime: { ResolvedAt: '2026-10-28T22:48:00Z' }, differentIncident: { IncidentId: 'incident-two' }, differentWorkItem: { AdoWorkItemId: 1 }, duplicate: { ApprovalCompletedAt: '2026-10-29T01:00:00Z' }, missingStatus: { AlertStatus: null }, missingEtag: { '@odata.etag': null } })) {
  check(name + ' cannot execute any approval/rejection/error mutation', () => assert.equal(condition(guard.expression, context({ ...incident, ...change })), false));
}
for (const state of ['Closed', 'Resolved', 'Done', 'Removed', 'Reject', 'Unexpected']) check(`ADO ${state} preserved`, () => assert.equal(condition(guard.expression, context(incident, { ...workItem, fields: { 'System.State': state } })), false));
const historical = guard.else.actions.Condition_Can_Record_Historical_Response;
check('recovered response can be audited', () => assert.ok(condition(historical.expression, context({ ...incident, AlertStatus: 'RESOLVED' }))));
check('duplicate response audit is immutable', () => assert.equal(condition(historical.expression, context({ ...incident, ApprovalCompletedAt: 'done' })), false));
check('superseded response audit is preserved', () => assert.equal(condition(historical.expression, context({ ...incident, IncidentId: 'next' })), false));
check('historical response writes only audit fields and safely escapes names', () => {
  const fields = JSON.parse(evaluate(historical.actions.Record_Historical_Approval.inputs.parameters['parameters/body'], context()));
  assert.deepEqual(Object.keys(fields).sort(), ['ApprovalOutcome', 'ApprovalCompletedAt', 'ApprovalBy', 'ApprovalComment', 'ApprovalId'].sort());
  assert.equal(fields.ApprovalBy, outputValues.Compose_Approver_Name);
});
function walk(group) {
  for (const [name, action] of Object.entries(group)) {
    // runAfter targets must remain in the same scope after wrapping the old branches.
    for (const predecessor of Object.keys(action.runAfter || {})) assert.ok(group[predecessor], `${name} missing predecessor ${predecessor}`);
    if (['Assign_Work_Item_to_Approver', 'Update_Rejected_Work_Item'].includes(name)) check(`${name} rejects concurrent closure`, () => {
      assert.equal(action.inputs.host.operationId, 'HttpRequest');
      const patch = JSON.parse(evaluate(action.inputs.parameters['parameters/Body'], context()));
      assert.deepEqual(patch[0], { op: 'test', path: '/rev', value: 8 });
      const concurrent = { rev: 9, state: 'Closed' };
      assert.notEqual(patch[0].value, concurrent.rev); // server refuses the entire PATCH
      assert.equal(concurrent.state, 'Closed');
      assert.equal(action.inputs.retryPolicy.type, 'none');
      assert.ok(!patch.some(item => item.path === '/fields/System.Tags'));
    });
    if (action.inputs?.parameters?.['parameters/method'] === 'POST') check(`${name} uses conditional SharePoint write`, () => {
      const headers = action.inputs.parameters['parameters/headers'];
      assert.equal(evaluate(headers['IF-MATCH'], context()), '"7"');
      assert.equal(headers['X-HTTP-Method'], 'MERGE');
      assert.equal(action.inputs.retryPolicy.type, 'none');
      assert.ok(action.inputs.parameters['parameters/body'].startsWith('@string('));
      assert.ok(!action.inputs.parameters['parameters/body'].includes("'AdoWorkItemUrl'"), 'approval must preserve existing SharePoint hyperlink');
      assert.ok(!action.inputs.parameters['parameters/body'].includes("'AdoWorkItemId'"), 'approval must preserve ticket identity');
    });
    assert.notEqual(action.inputs?.host?.operationId, 'UpdateWorkItem', `unguarded ${name}`);
    walk(action.actions || {}); walk(action.else?.actions || {});
  }
}
walk(guard.actions); walk(guard.else.actions);
const uiSource = fs.readFileSync('operations-ui/src/modules/Incidents.tsx', 'utf8');
const uiFunction = uiSource.match(/function approvalStatus\(item: Incident\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(uiFunction);
const uiStatus = require('node:vm').runInNewContext(`(${uiFunction.replace('item: Incident', 'item')})`);
for (const [name, item, expected] of [
  ['cancelled pending request', { workflowStatus: 'CANCELLED', approvalRequestedAt: 'date' }, 'CANCELLED'],
  ['recovered pending request', { status: 'RESOLVED', approvalRequestedAt: 'date' }, 'NO_LONGER_REQUIRED'],
  ['late response', { approvalOutcome: 'Historical:Approve', approvalCompletedAt: 'date' }, 'HISTORICAL_RESPONSE'],
  ['active pending request', { status: 'FIRING', workflowStatus: 'AWAITING_APPROVAL' }, 'AWAITING_APPROVAL'],
  ['completed approval', { approvalOutcome: 'Approve', approvalCompletedAt: 'date' }, 'APPROVED']
]) check(`UI ${name}`, () => assert.equal(uiStatus(item), expected));
console.log(`Validated v${version}: ${count} checks`);
