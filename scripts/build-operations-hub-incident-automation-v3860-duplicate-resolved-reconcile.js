const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-incident-automation-v3860-duplicate-resolved-reconcile.js <source-directory> <output-directory>');
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
const duplicate = workflow.actions.Scope_Process_Incident.actions.Condition_Message_Already_Processed;
if (!duplicate || !duplicate.actions.Terminate_Duplicate_Message) throw new Error('Expected duplicate-message branch was not found');

duplicate.actions.Condition_Duplicate_RESOLVED_Reconciliation = {
  type: 'If',
  expression: {
    or: [
      { contains: ["@toUpper(triggerOutputs()?['body/subject'])", 'RESOLVED'] },
      { contains: ["@toUpper(triggerOutputs()?['body/body'])", '✅ RESOLVED'] },
      { contains: ["@toUpper(triggerOutputs()?['body/body'])", '<B>RESOLVED AT:</B>'] }
    ]
  },
  actions: {
    Call_Reconciliation_API_For_Duplicate_RESOLVED: {
      type: 'Http',
      inputs: {
        method: 'POST',
        uri: "@parameters('operationsReconcileEndpoint')",
        headers: {
          'Content-Type': 'application/json',
          'x-operations-automation-key': "@parameters('operationsAutomationKey')"
        },
        body: {
          incidentId: "@first(body('Get_items_by_SourceMessageId')?['value'])?['IncidentId']",
          maxItems: 1,
          scope: 'PRIMARY'
        }
      },
      retryPolicy: { type: 'exponential', count: 2, interval: 'PT10S', minimumInterval: 'PT5S', maximumInterval: 'PT1M' }
    }
  },
  else: { actions: {} }
};
duplicate.actions.Terminate_Duplicate_Message.runAfter = {
  Condition_Duplicate_RESOLVED_Reconciliation: ['Succeeded', 'Failed', 'TimedOut', 'Skipped']
};

const version = '3.8.61';
const displayName = `Operations Hub - Incident Automation v${version}`;
workflow.contentVersion = `${version}.0`;
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = displayName;
manifest.details.displayName = `OperationsHub-IncidentAutomationv${version}-Import`;
manifest.details.description = 'RESOLVED emails already recorded by an earlier run still trigger idempotent reconciliation instead of terminating before the API call.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].creationType = 'Existing, New, Update';
manifest.resources[assetId].details.displayName = displayName;
write(definitionPath, wrapper);
write(manifestPath, manifest);
console.log(JSON.stringify({ version, outputRoot }));
