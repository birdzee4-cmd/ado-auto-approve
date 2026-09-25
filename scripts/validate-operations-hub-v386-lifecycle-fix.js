const fs = require('fs');
const path = require('path');

const packageRoot = process.argv[2];
if (!packageRoot) throw new Error('Usage: node validate-operations-hub-v386-lifecycle-fix.js <extracted-package-directory>');

const root = path.resolve(packageRoot);
const packageManifest = readJson(path.join(root, 'manifest.json'));
const flowAssetsRoot = path.join(root, 'Microsoft.Flow', 'flows');
const flowManifest = readJson(path.join(flowAssetsRoot, 'manifest.json'));
const assets = flowManifest.flowAssets && flowManifest.flowAssets.assetPaths;
assert(Array.isArray(assets) && assets.length === 1, 'package contains exactly one flow asset');

const wrapper = readJson(path.join(flowAssetsRoot, assets[0], 'definition.json'));
const workflow = wrapper.properties.definition;
const actionMap = indexActions(workflow.actions || {});
const failures = [];
const warnings = [];

check(workflow.contentVersion === '3.8.6.0', 'contentVersion is 3.8.6.0');
check(wrapper.properties.displayName === 'Operations Hub - Incident Automation v3.8.6', 'flow display name is v3.8.6');
check(packageManifest.details.displayName === 'OperationsHub-IncidentAutomation-v3.8.6', 'package display name is v3.8.6');

const triggers = Object.values(workflow.triggers || {}).filter(trigger =>
  trigger.inputs && trigger.inputs.host && trigger.inputs.host.operationId === 'OnNewEmailV3'
);
check(triggers.length === 1, 'one OnNewEmailV3 trigger exists');
if (triggers.length === 1) {
  const trigger = triggers[0];
  check(!Object.prototype.hasOwnProperty.call(trigger.inputs.parameters || {}, 'subjectFilter'), 'trigger does not discard RESOLVED mail with subjectFilter');
  const runs = trigger.runtimeConfiguration && trigger.runtimeConfiguration.concurrency && trigger.runtimeConfiguration.concurrency.runs;
  check(runs === 1, 'ingestion stays serialized while dedup is non-atomic');
  warnings.push('Concurrency remains 1: split approval into a second flow before increasing it.');
}

const routeText = jsonOf('Condition_AppService_Subject_Routing');
check(routeText.includes('NOWALERT_APPSERVICE'), 'routing restricts processing to NOWALERT App Service mail');
check(routeText.includes('ALERT FIRING'), 'routing accepts FIRING mail');
check(routeText.includes('ALERT RESOLVED'), 'routing accepts RESOLVED mail');

const messageFilter = parameter('Get_items_by_SourceMessageId', '$filter');
check(messageFilter.includes('SourceMessageId eq'), 'message dedup checks SourceMessageId');
check(messageFilter.includes('LastSourceMessageId eq'), 'message dedup checks LastSourceMessageId');

const firingCondition = jsonOf('Condition_FIRING_Incident_Exists');
check(firingCondition.includes("length(body('Get_items_by_IncidentId')?['value'])"), 'FIRING dedup uses IncidentId lookup results');
check(!firingCondition.includes('CONTROLLED_TEST_DEDUP_BYPASS_DISABLED'), 'controlled-test dedup bypass is absent');

const resolvedFilter = parameter('Get_latest_open_FIRING', '$filter');
for (const invariant of ['Title eq', 'Resource eq', "AlertStatus eq ''FIRING''", 'ResolvedAt eq null', 'FirstSeenAt lt']) {
  check(resolvedFilter.includes(invariant), `RESOLVED correlation includes ${invariant}`);
}
check(parameter('Get_latest_open_FIRING', '$orderby') === 'FirstSeenAt desc', 'RESOLVED correlation selects newest matching FIRING');
check(Number(parameter('Get_latest_open_FIRING', '$top')) === 1, 'RESOLVED correlation updates only one FIRING incident');

if (failures.length) {
  console.error(`FAILED (${failures.length})`);
  failures.forEach(item => console.error(`- ${item}`));
  process.exitCode = 1;
} else {
  console.log('PASS: Operations Hub v3.8.6 lifecycle invariants are satisfied.');
}
warnings.forEach(item => console.warn(`WARNING: ${item}`));

function parameter(actionName, parameterName) {
  const action = actionMap.get(actionName);
  return String(action && action.inputs && action.inputs.parameters && action.inputs.parameters[parameterName] || '');
}

function jsonOf(actionName) {
  return JSON.stringify(actionMap.get(actionName) || {});
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function indexActions(rootActions) {
  const result = new Map();
  visit(rootActions);
  return result;

  function visit(group) {
    for (const [name, action] of Object.entries(group || {})) {
      if (result.has(name)) throw new Error(`Duplicate action name is ambiguous: ${name}`);
      result.set(name, action);
      visit(action.actions);
      visit(action.else && action.else.actions);
    }
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
