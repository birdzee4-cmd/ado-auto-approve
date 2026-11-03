const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-alert-lifecycle-reconciliation-v107-event-shadow.js <v1.0.6-directory> <output-directory>');
const source = path.resolve(sourceRoot);
const output = path.resolve(outputRoot);
if (!fs.existsSync(source)) throw new Error(`Source package directory does not exist: ${source}`);
if (fs.existsSync(output)) throw new Error(`Output directory already exists: ${output}`);
fs.cpSync(source, output, { recursive: true });

const flowRoot = path.join(output, 'Microsoft.Flow', 'flows');
const flowManifest = readJson(path.join(flowRoot, 'manifest.json'));
const assetId = flowManifest.flowAssets.assetPaths[0];
const definitionPath = path.join(flowRoot, assetId, 'definition.json');
const packagePath = path.join(output, 'manifest.json');
const wrapper = readJson(definitionPath);
const manifest = readJson(packagePath);
const workflow = wrapper.properties.definition;
const actions = workflow.actions.For_Each_RESOLVED_Email.actions.Condition_Is_Eligible_RESOLVED.actions;

workflow.parameters.operationsAlertEndpoint = { type: 'String', defaultValue: 'https://mango-wave-09cff3700.7.azurestaticapps.net/api/operations/alert-events' };
workflow.parameters.operationsAutomationKey = { type: 'SecureString', defaultValue: '' };

actions.Compose_First_Seen_Raw = {
  runAfter: { Compose_Resource: ['Succeeded'] }, type: 'Compose',
  inputs: "@if(contains(outputs('Compose_Email_Body'),'First Seen:</b>'),trim(first(split(last(split(outputs('Compose_Email_Body'),'First Seen:</b>')),'<br>'))),'')"
};
actions.Compose_First_Seen = {
  runAfter: { Compose_First_Seen_Raw: ['Succeeded'] }, type: 'Compose',
  inputs: "@if(greaterOrEquals(length(outputs('Compose_First_Seen_Raw')),16),concat(substring(outputs('Compose_First_Seen_Raw'),6,4),'-',substring(outputs('Compose_First_Seen_Raw'),3,2),'-',substring(outputs('Compose_First_Seen_Raw'),0,2),'T',substring(outputs('Compose_First_Seen_Raw'),11,5),':00+07:00'),coalesce(items('For_Each_RESOLVED_Email')?['receivedDateTime'],utcNow()))"
};
actions.Compose_Resolved_At_Raw.runAfter = { Compose_First_Seen: ['Succeeded'] };
actions.Submit_RESOLVED_Event_Shadow = {
  runAfter: { Compose_Resolved_At: ['Succeeded'] }, type: 'Http',
  inputs: {
    method: 'POST', uri: "@parameters('operationsAlertEndpoint')",
    headers: { 'Content-Type': 'application/json', 'x-operations-automation-key': "@parameters('operationsAutomationKey')", 'x-ms-workflow-run-id': "@workflow()?['run']?['name']" },
    body: {
      messageId: "@outputs('Compose_Message_Id')", eventType: 'RESOLVED',
      alertName: "@outputs('Compose_Alert_Name')", resource: "@outputs('Compose_Resource')",
      firstSeenAt: "@outputs('Compose_First_Seen')", resolvedAt: "@outputs('Compose_Resolved_At')",
      receivedAt: "@coalesce(items('For_Each_RESOLVED_Email')?['receivedDateTime'],utcNow())",
      rawSubject: "@outputs('Compose_Email_Subject')"
    }, retryPolicy: { type: 'fixed', count: 3, interval: 'PT20S' }
  }, runtimeConfiguration: { secureData: { properties: ['inputs', 'outputs'] } }
};
// Shadow delivery must never block the v1.0.6 production reconciliation path.
actions.Get_Already_Processed_Message.runAfter = { Submit_RESOLVED_Event_Shadow: ['Succeeded', 'Failed', 'TimedOut', 'Skipped'] };

workflow.contentVersion = '1.0.7.0';
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = 'Operations Hub - Alert Lifecycle Reconciliation v1.0.7 Shadow';
manifest.details.displayName = 'OperationsHub-AlertLifecycleReconciliation-v1.0.7-Shadow';
manifest.details.description = 'Keeps the v1.0.6 RESOLVED path active while submitting durable structured alert events to Operations Hub in shadow mode.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = wrapper.properties.displayName;

writeJson(definitionPath, wrapper);
writeJson(packagePath, manifest);
console.log(`Built ${wrapper.properties.displayName} at ${output}`);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
