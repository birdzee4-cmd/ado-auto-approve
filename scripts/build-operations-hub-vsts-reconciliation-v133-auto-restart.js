const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node scripts/build-operations-hub-vsts-reconciliation-v133-auto-restart.js <source-directory> <output-directory>');
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

workflow.parameters.operationsReconcileEndpoint = {
  defaultValue: 'https://mango-wave-09cff3700.7.azurestaticapps.net/api/operations-reconcile',
  type: 'String'
};
workflow.parameters.operationsAutomationKey = { defaultValue: '', type: 'SecureString' };

const callApi = {
  runAfter: { Get_Reconcilable_P1_Incidents: ['Succeeded'] },
  type: 'Http',
  inputs: {
    uri: "@parameters('operationsReconcileEndpoint')",
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-operations-automation-key': "@parameters('operationsAutomationKey')"
    },
    body: { scope: 'ALL', maxItems: 100 }
  }
};
workflow.actions.Call_Operations_Reconciliation_API = callApi;
workflow.actions.For_each_Incident.runAfter = {
  Call_Operations_Reconciliation_API: ['Succeeded', 'Failed', 'TimedOut']
};

workflow.contentVersion = '1.3.3.0';
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = 'Operations Hub - VSTS Reconciliation v1.3.3';
manifest.details.displayName = 'OperationsHub-VSTS-Reconciliationv1.3.3-AutoRestart-Import';
manifest.details.description = 'Calls Operations Hub reconciliation before the existing VSTS sync so the optional five-minute P1 App Service auto-restart path is evaluated; VSTS sync continues if the API call fails.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].creationType = 'Existing, New, Update';
manifest.resources[assetId].details.displayName = wrapper.properties.displayName;
write(definitionPath, wrapper);
write(manifestPath, manifest);
console.log(JSON.stringify({ version: '1.3.3', outputRoot }));
