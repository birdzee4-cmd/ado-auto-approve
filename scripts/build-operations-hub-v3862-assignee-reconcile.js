const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-v3862-assignee-reconcile.js <source-directory> <output-directory>');
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
const historical = workflow.actions.Scope_Process_Incident.actions.Condition_Message_Already_Processed.else.actions
  .Condition_Priority_is_P1_or_P2.actions.Condition_Is_RESOLVED.else.actions.Condition_FIRING_Incident_Exists.else.actions.Condition_Approval_Still_Current
  .else.actions.Condition_Can_Record_Historical_Response;
const approved = historical.actions.Condition_Historical_Approval_Is_Approved;
if (!approved || !approved.actions.Apply_Historical_Approval_To_Work_Item) throw new Error('Historical approval action not found');

const base = approved.actions.Apply_Historical_Approval_To_Work_Item;
const getLatest = {
  type: 'OpenApiConnection',
  runAfter: {},
  inputs: {
    parameters: {
      account: 'buzzebees',
      'parameters/Method': 'GET',
      'parameters/Uri': "@concat('Buzzebees/_apis/wit/workitems/',string(body('Create_Azure_DevOps_work_item')?['id']),'?api-version=7.1')",
      'parameters/Headers': { 'Content-Type': 'application/json-patch+json' },
      'parameters/IsBase64': false
    },
    host: { apiId: '/providers/Microsoft.PowerApps/apis/shared_visualstudioteamservices', connectionName: 'shared_visualstudioteamservices', operationId: 'HttpRequest' },
    authentication: "@parameters('$authentication')"
  }
};
approved.actions.Get_Latest_Work_Item_For_Historical_Assignment = getLatest;
base.runAfter = { Get_Latest_Work_Item_For_Historical_Assignment: ['Succeeded'] };
const body = base.inputs.parameters['parameters/Body'];
base.inputs.parameters['parameters/Body'] = body.replace("body('Get_Work_Item_After_Approval')?['rev']", "body('Get_Latest_Work_Item_For_Historical_Assignment')?['rev']");

const verify = {
  type: 'OpenApiConnection',
  runAfter: { Apply_Historical_Approval_To_Work_Item: ['Succeeded'] },
  inputs: {
    parameters: {
      account: 'buzzebees',
      'parameters/Method': 'GET',
      'parameters/Uri': "@concat('Buzzebees/_apis/wit/workitems/',string(body('Create_Azure_DevOps_work_item')?['id']),'?api-version=7.1')",
      'parameters/Headers': { 'Content-Type': 'application/json-patch+json' },
      'parameters/IsBase64': false
    },
    host: { apiId: '/providers/Microsoft.PowerApps/apis/shared_visualstudioteamservices', connectionName: 'shared_visualstudioteamservices', operationId: 'HttpRequest' },
    authentication: "@parameters('$authentication')"
  }
};
approved.actions.Verify_Historical_Assignee = verify;

const version = '3.8.62';
const displayName = `Operations Hub - Incident Automation v${version}`;
workflow.contentVersion = `${version}.0`;
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = displayName;
manifest.details.displayName = `OperationsHub-IncidentAutomationv${version}-AssigneeReconcile-Import`;
manifest.details.description = 'Prevents historical approvals from losing the VSTS assignee by refreshing the work item revision immediately before PATCH and reading it back after assignment.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].creationType = 'Existing, New, Update';
manifest.resources[assetId].details.displayName = displayName;
write(definitionPath, wrapper);
write(manifestPath, manifest);
console.log(JSON.stringify({ version, outputRoot }));
