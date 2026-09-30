const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'artifacts', 'power-automate');
const incident = loadDefinition(path.join(root, 'v3.7.8-staging'));
const reconciliation = loadDefinition(path.join(root, 'vsts-reconciliation-v1.3.0-staging'));
const incidentBaseline = loadDefinition(path.join(root, 'v3.7.7-source'));
const errors = [];

const incidentActions = walk(incident.definition.actions);
const reconciliationActions = walk(reconciliation.definition.actions);

expect(incident.wrapper.properties.displayName === 'Operations Hub - Incident Automation v3.7.8', 'Incident display name');
expect(incident.definition.contentVersion === '3.7.8.0', 'Incident content version');
expect(reconciliation.wrapper.properties.displayName === 'Operations Hub - VSTS Reconciliation v1.3.0', 'Reconciliation display name');
expect(reconciliation.definition.contentVersion === '1.3.0.0', 'Reconciliation content version');

expect(countOperation(incidentActions, 'CreateWorkItem') === 1, 'Incident must retain exactly one CreateWorkItem action');
expect(countOperation(reconciliationActions, 'CreateWorkItem') === 0, 'Reconciliation must never create a Work Item');
expect(countOperation(incidentActions, 'UpdateWorkItem') === 2, 'Incident must have Approved and Rejected Work Item updates');
expect(countOperation(reconciliationActions, 'UpdateWorkItem') === 1, 'Reconciliation must have one guarded repair update');

const rejectUpdate = get(incidentActions, 'Update_Rejected_Work_Item');
expect(rejectUpdate.inputs.parameters['workItem/dynamicFields/System.State'] === 'Reject', 'Rejected branch must set VSTS Reject');
expect(get(incidentActions, 'Update_Incident_Rejected').inputs.parameters['item/WorkflowStatus/Value'] === 'REJECTED', 'Rejected branch must set SharePoint REJECTED');
expect(get(incidentActions, 'Update_Incident_Approval_Error').inputs.parameters['item/WorkflowStatus/Value'] === 'FAILED', 'Approval error must be FAILED, not rejected');

const repair = get(reconciliationActions, 'Condition_Repair_VSTS_State_From_Approval');
const repairJson = JSON.stringify(repair);
expect(repairJson.includes('Compose_Approval_Is_Explicitly_Rejected'), 'Reconciliation reject repair must require explicit approval evidence');
expect(!repair.expression.includes('Compose_Current_Workflow_Status'), 'SharePoint WorkflowStatus alone must not trigger a VSTS write');
expect(repairJson.includes("'closed'") && repairJson.includes("'done'"), 'Closed/Done must block VSTS repair');

const desired = get(reconciliationActions, 'Compose_Desired_Workflow_Status').inputs;
expect(desired.indexOf("'CLOSED'") < desired.indexOf("'REJECTED'"), 'Closed must have precedence over Rejected');
expect(desired.includes('Compose_Approval_Is_Error'), 'Approval error must remain FAILED during reconciliation');
expect(desired.includes("toUpper(outputs('Compose_Current_Workflow_Status')),'REJECTED'"), 'Existing SharePoint REJECTED must be preserved');
expect(!repairJson.includes('Compose_Current_Workflow_Status'), 'Preserved SharePoint REJECTED must not trigger a VSTS write');

const p2 = get(incidentActions, 'Condition_Priority_is_P2');
expect(JSON.stringify(p2.expression).includes('P2') && JSON.stringify(p2.expression).includes('P3'), 'P2/P3 notification branch must remain');
expect(get(incidentActions, 'Post_P2_notification_to_Teams') !== null, 'P2/P3 Teams notification must remain');
expect(get(incidentActions, 'Get_items_by_SourceMessageId') !== null, 'Message dedup must remain');
expect(get(incidentActions, 'Get_items_by_IncidentId') !== null, 'Incident dedup must remain');
expect(get(incidentActions, 'Update_Incident_Assignment_Failed') !== null, 'Assignment failure handling must remain');
expect(get(incidentActions, 'Compose_Environment') !== null, 'Environment validation must remain');
expect(get(incidentActions, 'Scope_Handle_Technical_Failure') !== null, 'Technical failure scope must remain');
expect(!get(incidentActions, 'Start_and_wait_for_an_approval').limit, '15-minute approval timeout must remain disabled');
validateDependencies(incident.definition.actions, 'incident.actions');
validateDependencies(reconciliation.definition.actions, 'reconciliation.actions');

const baselineActions = walk(incidentBaseline.definition.actions);
for (const name of [
  'Get_items_by_SourceMessageId',
  'Get_items_by_IncidentId',
  'Condition_Priority_is_P2',
  'Post_P2_notification_to_Teams',
  'Terminate_P2_notification_only',
  'Update_Incident_Assignment_Failed',
  'Update_Incident_Missing_Approver_Email',
  'Compose_Environment',
  'Scope_Handle_Technical_Failure'
]) {
  expect(JSON.stringify(get(incidentActions, name)) === JSON.stringify(get(baselineActions, name)), `${name} must remain byte-equivalent to v3.7.7`);
}
for (const name of ['Condition_Message_Already_Processed', 'Condition_FIRING_Incident_Exists']) {
  expect(JSON.stringify(get(incidentActions, name).expression) === JSON.stringify(get(baselineActions, name).expression), `${name} expression must remain equivalent to v3.7.7`);
}

const lifecycleCases = [
  ['approved-new', lifecycle('New', 'Approved', 'Approve', 'CREATED'), { write: 'Processing', workflow: 'PROCESSING' }],
  ['rejected-new', lifecycle('New', 'Rejected', 'Reject', 'REJECTED'), { write: 'Reject', workflow: 'REJECTED' }],
  ['closed-approved', lifecycle('Closed', 'Approved', 'Approve', 'PROCESSING'), { write: null, workflow: 'CLOSED' }],
  ['legacy-rejected-new', lifecycle('New', '', '', 'REJECTED'), { write: null, workflow: 'REJECTED' }],
  ['connector-error', lifecycle('New', 'Error', 'Error', 'FAILED'), { write: null, workflow: 'FAILED' }],
  ['processing', lifecycle('Processing', '', '', 'CREATED'), { write: null, workflow: 'PROCESSING' }],
  ['vsts-reject', lifecycle('Reject', '', '', 'CREATED'), { write: null, workflow: 'REJECTED' }]
];
for (const [name, actual, expected] of lifecycleCases) {
  expect(JSON.stringify(actual) === JSON.stringify(expected), `Lifecycle case ${name}: ${JSON.stringify(actual)}`);
}

const summary = {
  ok: errors.length === 0,
  incident: {
    displayName: incident.wrapper.properties.displayName,
    contentVersion: incident.definition.contentVersion,
    createWorkItemActions: countOperation(incidentActions, 'CreateWorkItem'),
    updateWorkItemActions: namesForOperation(incidentActions, 'UpdateWorkItem')
  },
  reconciliation: {
    displayName: reconciliation.wrapper.properties.displayName,
    contentVersion: reconciliation.definition.contentVersion,
    createWorkItemActions: countOperation(reconciliationActions, 'CreateWorkItem'),
    updateWorkItemActions: namesForOperation(reconciliationActions, 'UpdateWorkItem')
  },
  errors
};

console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exitCode = 1;

function loadDefinition(folder) {
  const flows = path.join(folder, 'Microsoft.Flow', 'flows');
  const asset = fs.readdirSync(flows).find(name => name !== 'manifest.json');
  const wrapper = JSON.parse(fs.readFileSync(path.join(flows, asset, 'definition.json'), 'utf8'));
  return { wrapper, definition: wrapper.properties.definition };
}

function walk(actions, out = new Map()) {
  if (!actions) return out;
  for (const [name, action] of Object.entries(actions)) {
    out.set(name, action);
    walk(action.actions, out);
    walk(action.else && action.else.actions, out);
  }
  return out;
}

function get(actions, name) {
  const action = actions.get(name) || null;
  expect(Boolean(action), `Required action ${name}`);
  return action;
}

function operation(action) {
  return action && action.inputs && action.inputs.host && action.inputs.host.operationId;
}

function countOperation(actions, operationId) {
  return Array.from(actions.values()).filter(action => operation(action) === operationId).length;
}

function namesForOperation(actions, operationId) {
  return Array.from(actions.entries()).filter(([, action]) => operation(action) === operationId).map(([name]) => name);
}

function expect(condition, label) {
  if (!condition) errors.push(label);
}

function validateDependencies(actions, location) {
  if (!actions) return;
  const siblings = new Set(Object.keys(actions));
  for (const [name, action] of Object.entries(actions)) {
    for (const dependency of Object.keys(action.runAfter || {})) {
      expect(siblings.has(dependency), `${location}.${name} has missing runAfter sibling ${dependency}`);
    }
    validateDependencies(action.actions, `${location}.${name}.actions`);
    validateDependencies(action.else && action.else.actions, `${location}.${name}.else.actions`);
  }
}

function lifecycle(vstsState, approvalStatus, approvalOutcome, currentWorkflow) {
  const state = String(vstsState).toLowerCase();
  const status = String(approvalStatus).toLowerCase();
  const outcome = String(approvalOutcome).toLowerCase();
  const approved = status === 'approved' || outcome === 'approve' || outcome === 'approved';
  const rejected = status === 'rejected' || outcome === 'reject' || outcome === 'rejected';
  const approvalError = status === 'error' || outcome === 'error';
  const terminal = state === 'closed' || state === 'done';
  let write = null;
  if (!terminal && rejected && !['reject', 'rejected'].includes(state)) write = 'Reject';
  if (!terminal && approved && ['new', 'open', 'awaiting approval'].includes(state)) write = 'Processing';
  const effective = terminal ? state : rejected ? 'reject' : approved && ['new', 'open', 'awaiting approval'].includes(state) ? 'processing' : state;
  let workflow = currentWorkflow;
  if (['closed', 'done'].includes(effective)) workflow = 'CLOSED';
  else if (rejected || ['reject', 'rejected'].includes(effective)) workflow = 'REJECTED';
  else if (approvalError) workflow = 'FAILED';
  else if (String(currentWorkflow).toUpperCase() === 'REJECTED' && !approved) workflow = 'REJECTED';
  else if (['processing', 'active'].includes(effective)) workflow = 'PROCESSING';
  else if (['new', 'open', 'awaiting approval'].includes(effective)) workflow = 'AWAITING_APPROVAL';
  return { write, workflow };
}
