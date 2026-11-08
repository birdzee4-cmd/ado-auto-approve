const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-incident-automation-v3859-resolved-reconcile-api.js <source-directory> <output-directory>');
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
const resolved = workflow.actions.Scope_Process_Incident.actions.Condition_Message_Already_Processed.else.actions
  .Condition_Priority_is_P1_or_P2.actions.Condition_Is_RESOLVED.actions;
const matched = resolved.Condition_Matching_FIRING_Found.actions;
if (!matched.Update_matching_incident_RESOLVED || !matched.Post_RESOLVED_to_Teams) throw new Error('Expected RESOLVED matching branch was not found');

workflow.parameters.operationsReconcileEndpoint = {
  type: 'String',
  defaultValue: 'https://mango-wave-09cff3700.7.azurestaticapps.net/api/operations-reconcile'
};
workflow.parameters.operationsAutomationKey = { type: 'SecureString', defaultValue: '' };

matched.Call_Reconciliation_API = {
  runAfter: { Update_matching_incident_RESOLVED: ['Succeeded'] },
  type: 'Http',
  inputs: {
    method: 'POST',
    uri: "@parameters('operationsReconcileEndpoint')",
    headers: {
      'Content-Type': 'application/json',
      'x-operations-automation-key': "@parameters('operationsAutomationKey')"
    },
    body: {
      incidentId: "@first(body('Get_latest_open_FIRING')?['value'])?['IncidentId']",
      maxItems: 1,
      scope: 'PRIMARY'
    }
  },
  retryPolicy: { type: 'exponential', count: 2, interval: 'PT10S', minimumInterval: 'PT5S', maximumInterval: 'PT1M' }
};
matched.Post_RESOLVED_to_Teams.runAfter = { Call_Reconciliation_API: ['Succeeded', 'Failed', 'TimedOut'] };

const version = '3.8.59';
const displayName = `Operations Hub - Incident Automation v${version}`;
workflow.contentVersion = `${version}.0`;
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = displayName;
manifest.details.displayName = `OperationsHub-IncidentAutomationv${version}-ResolvedReconcileAPI-Import`;
manifest.details.description = 'RESOLVED email branch updates SharePoint, then calls the idempotent operations-reconcile API to verify and close the primary VSTS Work Item and add the resolved comment.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].creationType = 'Existing, New, Update';
manifest.resources[assetId].details.displayName = displayName;
write(definitionPath, wrapper);
write(manifestPath, manifest);
console.log(JSON.stringify({ version, outputRoot }));
