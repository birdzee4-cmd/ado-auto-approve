const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-late-approval-ado-comment.js <source-directory> <output-directory>');
if (!fs.existsSync(sourceRoot) || fs.existsSync(outputRoot)) throw new Error('Source must exist and output must be new');
fs.cpSync(sourceRoot, outputRoot, { recursive: true });

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const flowRoot = path.join(outputRoot, 'Microsoft.Flow', 'flows');
const flowManifest = read(path.join(flowRoot, 'manifest.json'));
const assetId = flowManifest.flowAssets.assetPaths[0];
const definitionPath = path.join(flowRoot, assetId, 'definition.json');
const manifestPath = path.join(outputRoot, 'manifest.json');
const wrapper = read(definitionPath);
const manifest = read(manifestPath);
const workflow = wrapper.properties.definition;
const guard = workflow.actions.Scope_Process_Incident.actions.Condition_Message_Already_Processed.else.actions
  .Condition_Priority_is_P1_or_P2.actions.Condition_Is_RESOLVED.else.actions.Condition_FIRING_Incident_Exists.else.actions.Condition_Approval_Still_Current;
const historical = guard.else.actions.Condition_Can_Record_Historical_Response.actions;
if (!historical.Record_Historical_Approval) throw new Error('Historical approval branch not found');

function templateJson(value) {
  const literal = text => `'${String(text).replace(/'/g, "''")}'`;
  function expression(item) {
    if (typeof item === 'string') return item.startsWith('@') ? item.slice(1) : literal(item);
    if (Array.isArray(item)) return `createArray(${item.map(expression).join(',')})`;
    if (item && typeof item === 'object') return Object.entries(item).reduce((result, [key, child]) =>
      `setProperty(${result},${literal(key)},${expression(child)})`, "json('{}')");
    return `json(${literal(JSON.stringify(item))})`;
  }
  return `@string(${expression(value)})`;
}

const adoPatch = [
  { op: 'test', path: '/rev', value: "@int(body('Get_Work_Item_After_Approval')?['rev'])" },
  { op: 'add', path: '/fields/System.AssignedTo', value: "@outputs('Compose_Approver_Email')" },
  { op: 'add', path: '/fields/System.History', value: "@concat('<p><b>ย้อนหลัง: Approval หลัง Incident RESOLVED</b></p><p>ผู้อนุมัติ: ',outputs('Compose_Approver_Name'),'<br>ผลการอนุมัติ: ',outputs('Compose_ApprovalResult'),'<br>ระบบคงสถานะ VSTS เดิมและไม่เปิดงานกลับ</p>')" }
];
historical.Apply_Historical_Approval_To_Work_Item = {
  type: 'OpenApiConnection',
  runAfter: {},
  inputs: {
    parameters: {
      account: 'buzzebees',
      'parameters/Method': 'PATCH',
      'parameters/Uri': "@concat('Buzzebees/_apis/wit/workitems/',string(body('Create_Azure_DevOps_work_item')?['id']),'?api-version=7.1')",
      'parameters/Headers': { 'Content-Type': 'application/json-patch+json' },
      'parameters/Body': templateJson(adoPatch),
      'parameters/IsBase64': false
    },
    host: { apiId: '/providers/Microsoft.PowerApps/apis/shared_visualstudioteamservices', connectionName: 'shared_visualstudioteamservices', operationId: 'HttpRequest' },
    authentication: "@parameters('$authentication')",
    retryPolicy: { type: 'none' }
  }
};
historical.Condition_Historical_Approval_Is_Approved = {
  type: 'If',
  expression: { equals: ["@outputs('Compose_ApprovalResult')", 'Approve'] },
  actions: { Apply_Historical_Approval_To_Work_Item: historical.Apply_Historical_Approval_To_Work_Item },
  else: { actions: { Skip_Historical_VSTS_Update: { type: 'Compose', inputs: 'Late rejection or error recorded in SharePoint; VSTS was not changed.' } } }
};
delete historical.Apply_Historical_Approval_To_Work_Item;
historical.Record_Historical_Approval.runAfter = { Condition_Historical_Approval_Is_Approved: ['Succeeded', 'Failed', 'TimedOut'] };

const version = '3.8.58';
const displayName = `Operations Hub - Incident Automation v${version}`;
workflow.contentVersion = `${version}.0`;
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = displayName;
manifest.details.displayName = `OperationsHub-IncidentAutomationv${version}-LateApprovalAdoComment-Import`;
manifest.details.description = 'Late approval after RESOLVED assigns the approver and adds an audit comment to the existing VSTS Work Item without changing System.State.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].creationType = 'Existing, New, Update';
manifest.resources[assetId].details.displayName = displayName;
write(definitionPath, wrapper);
write(manifestPath, manifest);
console.log(JSON.stringify({ version, outputRoot }));
