const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-vsts-reconciliation-v131-assignee.js <source-directory> <output-directory>');
if (!fs.existsSync(sourceRoot) || fs.existsSync(outputRoot)) throw new Error('Source must exist and output must be new');
fs.cpSync(sourceRoot, outputRoot, { recursive: true });
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const write = (f, v) => fs.writeFileSync(f, JSON.stringify(v));
const flowRoot = path.join(outputRoot, 'Microsoft.Flow', 'flows');
const fm = read(path.join(flowRoot, 'manifest.json'));
const assetId = fm.flowAssets.assetPaths[0];
const defPath = path.join(flowRoot, assetId, 'definition.json');
const manifestPath = path.join(outputRoot, 'manifest.json');
const wrapper = read(defPath), manifest = read(manifestPath), workflow = wrapper.properties.definition;
const scope = workflow.actions.For_each_Incident.actions.Condition_Valid_VSTS_Work_Item_ID.actions.Scope_Sync_Current_Incident;
const actions = scope.actions;
workflow.actions.Get_Reconcilable_P1_Incidents.inputs.parameters['$filter'] = "Priority eq 'P1' and AdoWorkItemId ne null";
const update = {
  runAfter: { Get_VSTS_Work_Item: ['Succeeded'] },
  type: 'OpenApiConnection',
  inputs: {
    parameters: {
      account: 'buzzebees', project: 'Buzzebees', typeName: 'IT Support Case',
      id: "@string(items('For_each_Incident')?['AdoWorkItemId'])",
      'workItem/dynamicFields/System.AssignedTo': "@items('For_each_Incident')?['ApprovedByEmail']",
      'workItem/dynamicFields/System.History': "@concat('<p><b>Reconciliation: restored assignee</b></p><p>Approval responder: ',items('For_each_Incident')?['ApprovedByEmail'],'</p>')"
    },
    host: { apiId: '/providers/Microsoft.PowerApps/apis/shared_visualstudioteamservices', connectionName: 'shared_visualstudioteamservices', operationId: 'UpdateWorkItem' },
    authentication: "@parameters('$authentication')"
  }
};
actions.Condition_Reconcile_Missing_Assignee = {
  runAfter: { Get_VSTS_Work_Item: ['Succeeded'] },
  type: 'If',
  expression: "@and(or(equals(toLower(string(items('For_each_Incident')?['ApprovalStatus']?['Value'])),'approved'),equals(toLower(string(items('For_each_Incident')?['ApprovalStatus'])),'approved'),contains(toLower(string(items('For_each_Incident')?['ApprovalOutcome'])),'approve')),empty(body('Get_VSTS_Work_Item')?['fields']?['System_AssignedTo']),not(empty(items('For_each_Incident')?['ApprovedByEmail'])))",
  actions: { Reconcile_Missing_Assignee: update },
  else: { actions: {} }
};
const old = actions.Compose_VSTS_State;
old.runAfter = { Condition_Reconcile_Missing_Assignee: ['Succeeded'] };
const sharePointUpdate = actions.Update_Incident_From_VSTS;
sharePointUpdate.inputs.parameters['item/AssignedTo'] = "@string(coalesce(items('For_each_Incident')?['ApprovedBy'],body('Get_VSTS_Work_Item')?['fields']?['System_AssignedTo'],items('For_each_Incident')?['AssignedTo'],''))";
workflow.contentVersion = '1.3.2.0';
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = 'Operations Hub - VSTS Reconciliation v1.3.2';
manifest.details.displayName = 'OperationsHub-VSTS-Reconciliationv1.3.2-Assignee-Import';
manifest.details.description = 'Scheduled reconciliation restores missing VSTS System.AssignedTo values for approved P1 incidents using the persisted approval responder email.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].creationType = 'Existing, New, Update';
manifest.resources[assetId].details.displayName = wrapper.properties.displayName;
write(defPath, wrapper); write(manifestPath, manifest);
console.log(JSON.stringify({ version: '1.3.2', outputRoot }));
