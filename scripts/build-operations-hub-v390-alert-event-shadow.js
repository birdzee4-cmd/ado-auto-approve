const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-v390-alert-event-shadow.js <v3.8.9-extracted-directory> <output-directory>');
const source = path.resolve(sourceRoot);
const output = path.resolve(outputRoot);
if (!fs.existsSync(source)) throw new Error(`Source package directory does not exist: ${source}`);
if (fs.existsSync(output)) throw new Error(`Output directory already exists: ${output}`);
fs.cpSync(source, output, { recursive: true });

const packagePath = path.join(output, 'manifest.json');
const flowsRoot = path.join(output, 'Microsoft.Flow', 'flows');
const flowManifest = readJson(path.join(flowsRoot, 'manifest.json'));
const assetId = flowManifest.flowAssets.assetPaths[0];
const definitionPath = path.join(flowsRoot, assetId, 'definition.json');
const wrapper = readJson(definitionPath);
const manifest = readJson(packagePath);
const workflow = wrapper.properties.definition;

workflow.parameters.operationsAlertEndpoint = { type: 'String', defaultValue: 'https://mango-wave-09cff3700.7.azurestaticapps.net/api/operations/alert-events' };
workflow.parameters.operationsAutomationKey = { type: 'SecureString', defaultValue: '' };

insertShadowBefore(workflow.actions, 'Get_items_by_IncidentId', 'Submit_FIRING_Event_Shadow', {
  messageId: "@coalesce(triggerOutputs()?['body/id'],triggerOutputs()?['body/internetMessageId'],workflow()?['run']?['name'])",
  eventType: 'FIRING', incidentId: "@outputs('Compose_IncidentId')",
  alertName: "@outputs('Compose_AlertName')", resource: "@outputs('Compose_Resource')",
  firstSeenAt: "@outputs('Compose_FirstSeenAt')", resolvedAt: '',
  receivedAt: "@coalesce(triggerOutputs()?['body/receivedDateTime'],utcNow())",
  rawSubject: "@coalesce(triggerOutputs()?['body/subject'],'')"
});

insertShadowBefore(workflow.actions, 'Get_latest_open_FIRING', 'Submit_RESOLVED_Event_Shadow', {
  messageId: "@coalesce(triggerOutputs()?['body/id'],triggerOutputs()?['body/internetMessageId'],workflow()?['run']?['name'])",
  eventType: 'RESOLVED', incidentId: "@outputs('Compose_IncidentId')",
  alertName: "@outputs('Compose_AlertName')", resource: "@outputs('Compose_Resource')",
  firstSeenAt: "@outputs('Compose_FirstSeenAt')", resolvedAt: "@outputs('Compose_ResolvedAt')",
  receivedAt: "@coalesce(triggerOutputs()?['body/receivedDateTime'],utcNow())",
  rawSubject: "@coalesce(triggerOutputs()?['body/subject'],'')"
});

workflow.contentVersion = '3.9.0.0';
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = 'Operations Hub - Incident Automation v3.9.0 Shadow';
manifest.details.displayName = 'OperationsHub-IncidentAutomation-v3.9.0-Shadow';
manifest.details.description = 'Keeps v3.8.9 production behavior while submitting durable FIRING and RESOLVED events to Operations Hub in shadow mode.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = wrapper.properties.displayName;

writeJson(definitionPath, wrapper);
writeJson(packagePath, manifest);
console.log(`Built ${wrapper.properties.displayName} at ${output}`);

function insertShadowBefore(root, targetName, actionName, body) {
  const container = findContainer(root, targetName);
  if (!container) throw new Error(`Action container was not found: ${targetName}`);
  if (container[actionName]) throw new Error(`Action already exists: ${actionName}`);
  const originalRunAfter = container[targetName].runAfter || {};
  container[actionName] = {
    runAfter: originalRunAfter, type: 'Http',
    inputs: {
      method: 'POST', uri: "@parameters('operationsAlertEndpoint')",
      headers: { 'Content-Type': 'application/json', 'x-operations-automation-key': "@parameters('operationsAutomationKey')", 'x-ms-workflow-run-id': "@workflow()?['run']?['name']" },
      body, retryPolicy: { type: 'fixed', count: 3, interval: 'PT20S' }
    }, runtimeConfiguration: { secureData: { properties: ['inputs', 'outputs'] } }
  };
  container[targetName].runAfter = { [actionName]: ['Succeeded', 'Failed', 'TimedOut', 'Skipped'] };
}

function findContainer(group, target) {
  if (group && Object.prototype.hasOwnProperty.call(group, target)) return group;
  for (const action of Object.values(group || {})) {
    const nested = findContainer(action.actions, target) || findContainer(action.else && action.else.actions, target);
    if (nested) return nested;
  }
  return null;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
