const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node scripts/build-operations-hub-late-approval-guard.js <source> <output>');
const artifacts = path.resolve('artifacts/power-automate');
const versions = [];
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (/\.zip$/i.test(entry.name)) {
      const match = entry.name.match(/OperationsHub-IncidentAutomation-?v(\d+)\.(\d+)\.(\d+)/i);
      if (match) versions.push(match.slice(1).map(Number));
    }
  }
}
scan(artifacts);
versions.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
if (!versions.length) throw new Error('No numbered baseline archive');
const [major, minor, patch] = versions[0];
const version = `${major}.${minor}.${patch + 1}`;
for (const dir of [sourceRoot, outputRoot]) {
  const relative = path.relative(path.join(artifacts, '_work'), path.resolve(dir));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Use dedicated folders under artifacts/power-automate/_work');
}
if (!fs.existsSync(sourceRoot) || fs.existsSync(outputRoot)) throw new Error('Source must exist; output must be new');
fs.cpSync(sourceRoot, outputRoot, { recursive: true });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const flowRoot = path.join(outputRoot, 'Microsoft.Flow/flows');
const assetId = read(path.join(flowRoot, 'manifest.json')).flowAssets.assetPaths[0];
const definitionPath = path.join(flowRoot, assetId, 'definition.json');
const wrapper = read(definitionPath);
const workflow = wrapper.properties.definition;
const actions = workflow.actions.Scope_Process_Incident.actions.Condition_Message_Already_Processed.else.actions
  .Condition_Priority_is_P1_or_P2.actions.Condition_Is_RESOLVED.else.actions.Condition_FIRING_Incident_Exists.else.actions;
const original = actions.Condition_Approved;
if (!original || actions.Condition_Approval_Still_Current) throw new Error('Unexpected source approval structure');
// The notification handler succeeding must not hide a failed incident scope.
workflow.actions.Terminate_After_Technical_Failure = {
  type: 'Terminate', runAfter: { Scope_Handle_Technical_Failure: ['Succeeded'] },
  inputs: { runStatus: 'Failed', runError: { code: 'IncidentProcessingFailed', message: 'Incident processing failed. Review the original failed action and reconcile the existing Incident and Work Item before retrying.' } }
};
const after = name => ({ [name]: ['Succeeded'] });
function templateJson(value) {
  // Build typed objects before serializing; responder quotes/newlines stay valid JSON.
  const literal = text => `'${String(text).replace(/'/g, "''")}'`;
  function expression(item) {
    if (typeof item === 'string') return item.startsWith('@') ? item.slice(1) : literal(item);
    if (Array.isArray(item)) return `createArray(${item.map(expression).join(',')})`;
    if (item && typeof item === 'object') return Object.entries(item).reduce((result, [key, child]) => `setProperty(${result},${literal(key)},${expression(child)})`, "json('{}')");
    return `json(${literal(JSON.stringify(item))})`;
  }
  return `@string(${expression(value)})`;
}
const site = actions.Update_incident_AWAITING_APPROVAL.inputs.parameters.dataset;
const list = actions.Update_incident_AWAITING_APPROVAL.inputs.parameters.table;
const itemUri = `@concat('_api/web/lists(guid''${list}'')/items(',string(body('Create_FIRING_incident')?['ID']),')')`;
function spHttp(method, extra, runAfter = {}) {
  return { type: 'OpenApiConnection', runAfter, inputs: { parameters: { dataset: site,
    'parameters/method': method, 'parameters/uri': itemUri, ...extra },
  host: { apiId: '/providers/Microsoft.PowerApps/apis/shared_sharepointonline', connectionName: 'shared_sharepointonline', operationId: 'HttpRequest' }, authentication: "@parameters('$authentication')", retryPolicy: { type: 'none' } } };
}
function adoHttp(method, body, runAfter = {}) {
  return { type: 'OpenApiConnection', runAfter, inputs: { parameters: { account: 'buzzebees',
    'parameters/Method': method,
    'parameters/Uri': "@concat('Buzzebees/_apis/wit/workitems/',string(body('Create_Azure_DevOps_work_item')?['id']),'?api-version=7.1')",
    'parameters/Headers': { 'Content-Type': 'application/json-patch+json' },
    ...(body ? { 'parameters/Body': templateJson(body) } : {}), 'parameters/IsBase64': false },
  host: { apiId: '/providers/Microsoft.PowerApps/apis/shared_visualstudioteamservices', connectionName: 'shared_visualstudioteamservices', operationId: 'HttpRequest' }, authentication: "@parameters('$authentication')", retryPolicy: { type: 'none' } } };
}
// Read ADO first: a close after this read invalidates the revision used by PATCH.
actions.Get_Work_Item_After_Approval = adoHttp('GET', null, original.runAfter);
actions.Get_Incident_After_Approval = spHttp('GET', { 'parameters/headers': { Accept: 'application/json;odata=nometadata' } }, after('Get_Work_Item_After_Approval'));
const incident = "body('Get_Incident_After_Approval')";
const ado = "body('Get_Work_Item_After_Approval')";
const eq = (left, right) => ({ equals: [left, right] });
const expression = { and: [
  eq(`@toUpper(coalesce(${incident}?['AlertStatus'],''))`, 'FIRING'),
  eq(`@toUpper(coalesce(${incident}?['WorkflowStatus'],''))`, 'AWAITING_APPROVAL'),
  eq(`@${incident}?['IncidentId']`, '@outputs(\'Compose_IncidentId\')'),
  eq(`@string(${incident}?['AdoWorkItemId'])`, "@string(body('Create_Azure_DevOps_work_item')?['id'])"),
  eq(`@empty(${incident}?['ResolvedAt'])`, true),
  eq(`@empty(${incident}?['ApprovalCompletedAt'])`, true),
  eq(`@contains(createArray('NEW','ACTIVE','PROCESSING'),toUpper(coalesce(${ado}?['fields']?['System.State'],'')))`, true),
  eq(`@greater(int(coalesce(${ado}?['rev'],0)),0)`, true),
  eq(`@empty(coalesce(${incident}?['@odata.etag'],${incident}?['odata.etag'],outputs('Get_Incident_After_Approval')?['headers']?['ETag']))`, false),
  eq(`@ticks(coalesce(${incident}?['ApprovalRequestedAt'],'1900-01-01T00:00:00Z'))`, "@ticks(coalesce(body('Update_incident_AWAITING_APPROVAL')?['ApprovalRequestedAt'],'1900-01-02T00:00:00Z'))"),
  eq(`@string(${incident}?['ApprovalAttempt'])`, "@string(body('Update_incident_AWAITING_APPROVAL')?['ApprovalAttempt'])")
] };
const etag = `@coalesce(${incident}?['@odata.etag'],${incident}?['odata.etag'],outputs('Get_Incident_After_Approval')?['headers']?['ETag'])`;
function merge(fields, runAfter = {}) {
  return spHttp('POST', { 'parameters/headers': { Accept: 'application/json;odata=nometadata', 'Content-Type': 'application/json;odata=nometadata', 'IF-MATCH': etag, 'X-HTTP-Method': 'MERGE' }, 'parameters/body': templateJson(fields) }, runAfter);
}
// Replace unconditional connector writes with revision / ETag guarded writes.
function protect(group) {
  for (const [name, action] of Object.entries(group)) {
    if (['Assign_Work_Item_to_Approver', 'Update_Rejected_Work_Item'].includes(name)) {
      const parameters = action.inputs.parameters;
      const patch = [{ op: 'test', path: '/rev', value: `@int(${ado}?['rev'])` }];
      for (const [key, value] of Object.entries(parameters)) {
        if (key.startsWith('workItem/dynamicFields/') && !key.endsWith('System.Tags')) patch.push({ op: 'add', path: '/fields/' + key.slice('workItem/dynamicFields/'.length), value });
      }
      // Preserve existing tags and environment; approval changes only its own fields.
      group[name] = adoHttp('PATCH', patch, action.runAfter);
    } else if (action.inputs?.host?.operationId === 'PatchItem') {
      const fields = {};
      for (const [key, value] of Object.entries(action.inputs.parameters)) {
        if (key.startsWith('item/')) fields[key.slice(5).replace(/\/Value$/, '')] = value;
      }
      // Never replay the original alert/message timestamps while recording a response.
      // The existing URL is a SharePoint Hyperlink value, not a REST string.
      // Approval does not change ticket identity or its URL; preserve both.
      for (const key of ['IncidentId', 'SourceMessageId', 'ReceivedAt', 'AlertStatus', 'Priority', 'AdoWorkItemId', 'AdoWorkItemUrl']) delete fields[key];
      if (/Failed|Fails|Missing_Approver/.test(name)) {
        for (const key of Object.keys(fields)) if (key.startsWith('Ado') || ['WorkflowStatus', 'AssignedTo', 'Impact'].includes(key)) delete fields[key];
        fields.ApprovalStatus = 'AssignmentFailed';
        fields.ErrorDetail = 'Approval work item update was not applied. The work item may have changed concurrently; review the current state and flow run. No automatic retry or reopen was attempted.';
      }
      group[name] = merge(fields, action.runAfter);
    }
    protect(action.actions || {}); protect(action.else?.actions || {});
  }
}
protect(original.actions); protect(original.else.actions);
original.runAfter = {};
const lateFields = {
  ApprovalOutcome: "@concat('Historical:',outputs('Compose_ApprovalResult'))",
  ApprovalCompletedAt: '@utcNow()',
  ApprovalBy: "@coalesce(body('Start_and_wait_for_an_approval')?['responses']?[0]?['responder']?['displayName'],'')",
  ApprovalComment: "@coalesce(body('Start_and_wait_for_an_approval')?['responses']?[0]?['comments'],'')",
  ApprovalId: "@coalesce(body('Start_and_wait_for_an_approval')?['approvalId'],body('Start_and_wait_for_an_approval')?['id'],'')"
};
actions.Condition_Approval_Still_Current = { type: 'If', expression, runAfter: after('Get_Incident_After_Approval'),
  actions: { Condition_Approved: original }, else: { actions: {
    Condition_Can_Record_Historical_Response: { type: 'If', expression: { and: [expression.and[2], expression.and[3], expression.and[5], expression.and[8], expression.and[9], expression.and[10]] },
      actions: { Record_Historical_Approval: merge(lateFields) },
      else: { actions: { Preserve_Existing_Response: { type: 'Compose', inputs: 'Duplicate or superseded approval response ignored; existing incident and response preserved.' } } } }
  } } };
delete actions.Condition_Approved;
const approval = actions.Start_and_wait_for_an_approval.inputs.parameters;
approval['WebhookApprovalCreationInput/details'] = approval['WebhookApprovalCreationInput/details']
  .replace('The VSTS State remains New.', 'If this incident is still active, VSTS moves to Processing. If recovered, closed, cancelled or superseded, your response is recorded for audit only; it does not reopen or reassign the work item.')
  .replace('move the existing Tier 1 Work Item to Reject.', 'move the existing Tier 1 Work Item to Reject only while this approval is still current.');
original.actions.Condition_Approver_Has_Email.actions.Post_Approved_to_Teams.inputs.parameters['body/messageBody'] =
  original.actions.Condition_Approver_Has_Email.actions.Post_Approved_to_Teams.inputs.parameters['body/messageBody'].replace('remains New', 'is Processing');
const displayName = `Operations Hub - Incident Automation v${version}`;
wrapper.properties.displayName = displayName;
workflow.contentVersion = `${version}.0`;
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
const manifestPath = path.join(outputRoot, 'manifest.json');
const manifest = read(manifestPath);
manifest.details.displayName = displayName;
manifest.details.description = 'Guard late approval/rejection/error outcomes with fresh incident and work item reads, ADO revision tests and SharePoint ETags. Historical responses never reopen or reassign closed incidents.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = displayName;
write(definitionPath, wrapper); write(manifestPath, manifest);
console.log(JSON.stringify({ version, outputRoot, archive: `OperationsHub-IncidentAutomationv${version}-LateApprovalGuard-Import.zip` }));
