const fs = require('fs');
const path = require('path');

const [packageRoot] = process.argv.slice(2);
if (!packageRoot) throw new Error('Usage: node validate-operations-hub-v388-assignee-hotfix.js <v3.8.8-extracted-directory>');

const root = path.resolve(packageRoot);
const manifest = readJson(path.join(root, 'manifest.json'));
const flowRoot = path.join(root, 'Microsoft.Flow', 'flows');
const flowManifest = readJson(path.join(flowRoot, 'manifest.json'));
const assetPaths = flowManifest.flowAssets && flowManifest.flowAssets.assetPaths;
check(Array.isArray(assetPaths) && assetPaths.length === 1, 'package contains exactly one flow');

const wrapper = readJson(path.join(flowRoot, assetPaths[0], 'definition.json'));
const workflow = wrapper.properties.definition;
check(wrapper.properties.displayName === 'Operations Hub - Incident Automation v3.8.8', 'flow display name is v3.8.8');
check(workflow.contentVersion === '3.8.8.0', 'content version is 3.8.8.0');
check(manifest.details.displayName === 'OperationsHub-IncidentAutomation-v3.8.8', 'package display name is v3.8.8');

const actions = indexActions(workflow.actions || {});
const assign = required(actions, 'Assign_Work_Item_to_Approver');
check(assign.inputs.parameters['workItem/dynamicFields/System.AssignedTo'] === "@outputs('Compose_Approver_Email')", 'VSTS Assigned To uses approval responder email');
check(assign.inputs.parameters['workItem/dynamicFields/Custom.ApprovalStatus'] === 'Approve', 'VSTS approval status remains Approve');

const incident = required(actions, 'Update_Incident_Approved');
check(incident.inputs.parameters['item/AssignedTo'] === "@outputs('Compose_Approver_Name')", 'SharePoint assignee uses approval responder name');
check(incident.inputs.parameters['item/AdoRevision'].includes("Assign_Work_Item_to_Approver"), 'SharePoint stores the post-assignment VSTS revision');

const notify = required(actions, 'Post_Approved_to_Teams');
const message = notify.inputs.parameters['body/messageBody'];
check(message.includes('is assigned to the approver'), 'Teams success message reports assignment');
check(!message.includes('Assigned To remains empty'), 'obsolete unassigned success message is absent');

const trigger = Object.values(workflow.triggers || {}).find(item => item.inputs?.host?.operationId === 'OnNewEmailV3');
check(Boolean(trigger), 'email trigger exists');
check(!(trigger.runtimeConfiguration && trigger.runtimeConfiguration.concurrency), 'v3.8.7 non-blocking trigger behavior is retained');
console.log('PASS: Operations Hub v3.8.8 assignee hotfix invariants are satisfied.');

function indexActions(rootActions) {
  const result = new Map();
  visit(rootActions);
  return result;
  function visit(group) {
    for (const [name, action] of Object.entries(group || {})) {
      result.set(name, action);
      visit(action.actions);
      visit(action.else && action.else.actions);
    }
  }
}
function required(actions, name) {
  const action = actions.get(name);
  if (!action) throw new Error(`Required action was not found: ${name}`);
  return action;
}
function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`OK: ${message}`);
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
