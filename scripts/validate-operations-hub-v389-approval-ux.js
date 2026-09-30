const fs = require('fs');
const path = require('path');

const [packageRoot] = process.argv.slice(2);
if (!packageRoot) throw new Error('Usage: node validate-operations-hub-v389-approval-ux.js <v3.8.9-extracted-directory>');

const root = path.resolve(packageRoot);
const manifest = readJson(path.join(root, 'manifest.json'));
const flowRoot = path.join(root, 'Microsoft.Flow', 'flows');
const flowManifest = readJson(path.join(flowRoot, 'manifest.json'));
const assetPaths = flowManifest.flowAssets?.assetPaths;
check(Array.isArray(assetPaths) && assetPaths.length === 1, 'package contains exactly one flow');

const wrapper = readJson(path.join(flowRoot, assetPaths[0], 'definition.json'));
const workflow = wrapper.properties.definition;
check(wrapper.properties.displayName === 'Operations Hub - Incident Automation v3.8.9', 'flow display name is v3.8.9');
check(workflow.contentVersion === '3.8.9.0', 'content version is 3.8.9.0');
check(manifest.details.displayName === 'OperationsHub-IncidentAutomation-v3.8.9', 'package display name is v3.8.9');

const actions = indexActions(workflow.actions || {});
const approval = required(actions, 'Start_and_wait_for_an_approval');
const parameters = approval.inputs.parameters;
const title = parameters['WebhookApprovalCreationInput/title'];
const details = parameters['WebhookApprovalCreationInput/details'];
check(title.includes('P1 Approval | @{concat(\'INC-\''), 'approval title contains display incident number expression');
check(details.includes('padLeft(string(body(\'Create_FIRING_incident\')?[\'ID\']),6,\'0\')'), 'display incident number uses six-digit SharePoint ID');
check(details.includes('Tier 1 Work Item'), 'approval identifies the Tier 1 Work Item');
check(details.includes('assign Tier 1 Work Item'), 'Approve consequence is explicit');
check(details.includes('VSTS State remains New'), 'state behavior is explicit');
check(details.includes('No duplicate Work Item is created'), 'Reject duplicate behavior is explicit');
check(details.includes('Open Operations Hub'), 'Operations Hub deep link is present');
check(details.includes('Technical Incident ID'), 'technical correlation ID is retained');
check(details.includes("Compose_FirstSeenDisplay"), 'Bangkok display time is retained');

const assign = required(actions, 'Assign_Work_Item_to_Approver');
check(assign.inputs.parameters['workItem/dynamicFields/System.AssignedTo'] === "@outputs('Compose_Approver_Email')", 'v3.8.8 approver assignment fix is retained');
const trigger = Object.values(workflow.triggers || {}).find(item => item.inputs?.host?.operationId === 'OnNewEmailV3');
check(Boolean(trigger), 'email trigger exists');
check(!(trigger.runtimeConfiguration && trigger.runtimeConfiguration.concurrency), 'non-blocking trigger behavior is retained');
console.log('PASS: Operations Hub v3.8.9 approval UX invariants are satisfied.');

function indexActions(rootActions) {
  const result = new Map();
  visit(rootActions);
  return result;
  function visit(group) {
    for (const [name, action] of Object.entries(group || {})) {
      result.set(name, action);
      visit(action.actions);
      visit(action.else?.actions);
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
