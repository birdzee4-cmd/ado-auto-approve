const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node scripts/build-operations-hub-vsts-reconciliation-v134-one-minute.js <source-directory> <output-directory>');
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

workflow.triggers.Recurrence.recurrence = { frequency: 'Minute', interval: 1, timeZone: 'SE Asia Standard Time' };
workflow.triggers.Recurrence.evaluatedRecurrence = { frequency: 'Minute', interval: 1, timeZone: 'SE Asia Standard Time' };
const foreach = workflow.actions.For_each_Incident;
foreach.runtimeConfiguration = { concurrency: { repetitions: 1 } };
const assigneeCondition = foreach.actions.Condition_Valid_VSTS_Work_Item_ID.actions.Scope_Sync_Current_Incident.actions.Condition_Reconcile_Missing_Assignee;
if (assigneeCondition?.actions?.Reconcile_Missing_Assignee) {
  assigneeCondition.actions.Reconcile_Missing_Assignee.runAfter = {};
}
workflow.contentVersion = '1.3.4.0';
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = 'Operations Hub - VSTS Reconciliation v1.3.4';
manifest.details.displayName = 'OperationsHub-VSTS-Reconciliationv1.3.4-AutoRestart-1Min-Import';
manifest.details.description = 'Runs every minute with concurrency one and calls Operations Hub reconciliation before VSTS sync so eligible P1 App Service incidents are checked promptly after five minutes.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].creationType = 'Existing, New, Update';
manifest.resources[assetId].details.displayName = wrapper.properties.displayName;
write(definitionPath, wrapper);
write(manifestPath, manifest);
console.log(JSON.stringify({ version: '1.3.4', outputRoot }));
