const fs = require('fs');
const path = require('path');

const [packageRoot] = process.argv.slice(2);
if (!packageRoot) throw new Error('Usage: node validate-operations-hub-v387-hotfix.js <v3.8.7-extracted-directory>');

const root = path.resolve(packageRoot);
const manifest = readJson(path.join(root, 'manifest.json'));
const flowRoot = path.join(root, 'Microsoft.Flow', 'flows');
const flowManifest = readJson(path.join(flowRoot, 'manifest.json'));
const assetPaths = flowManifest.flowAssets && flowManifest.flowAssets.assetPaths;
check(Array.isArray(assetPaths) && assetPaths.length === 1, 'package contains exactly one flow');

const wrapper = readJson(path.join(flowRoot, assetPaths[0], 'definition.json'));
const workflow = wrapper.properties.definition;
check(wrapper.properties.displayName === 'Operations Hub - Incident Automation v3.8.7', 'flow display name is v3.8.7');
check(workflow.contentVersion === '3.8.7.0', 'content version is 3.8.7.0');
check(manifest.details.displayName === 'OperationsHub-IncidentAutomation-v3.8.7', 'package display name is v3.8.7');

const trigger = Object.values(workflow.triggers || {}).find(item =>
  item.inputs && item.inputs.host && item.inputs.host.operationId === 'OnNewEmailV3'
);
check(Boolean(trigger), 'OnNewEmailV3 trigger exists');
check(!Object.prototype.hasOwnProperty.call(trigger.inputs.parameters, 'subjectFilter'), 'trigger subject filter is removed');
check(!(trigger.runtimeConfiguration && trigger.runtimeConfiguration.concurrency), 'trigger concurrency control is disabled');

const actions = indexActions(workflow.actions || {});
check(actions.has('Start_and_wait_for_an_approval'), 'existing approval behavior remains available');
check(!actions.get('Start_and_wait_for_an_approval').limit, 'approval has no artificial timeout');
check(actions.has('Get_items_by_SourceMessageId'), 'message-id deduplication exists');
check(actions.has('Condition_FIRING_Incident_Exists'), 'incident-id deduplication exists');
check(actions.has('Condition_AppService_Subject_Routing'), 'subject routing exists');

const route = JSON.stringify(actions.get('Condition_AppService_Subject_Routing').expression || {});
check(route.includes('ALERT FIRING'), 'routing accepts FIRING');
check(route.includes('ALERT RESOLVED'), 'routing accepts RESOLVED');

const definitionText = JSON.stringify(workflow);
check(definitionText.includes('Compose_FirstSeenDisplay'), 'Bangkok display time is retained');
check(definitionText.includes('System.Tags\":\"ITSupport_Pool'), 'Tier 1 tag standard is retained');
check(!definitionText.includes('ITSupport-AutoCreateIncidentCase'), 'legacy extra Tier 1 tag is absent');

console.log('PASS: Operations Hub v3.8.7 hotfix invariants are satisfied.');

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

function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`OK: ${message}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
