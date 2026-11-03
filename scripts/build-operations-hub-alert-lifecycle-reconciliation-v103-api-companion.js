const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node scripts/build-operations-hub-alert-lifecycle-reconciliation-v103-api-companion.js <v1.0.3-directory> <output-directory>');
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
const eligible = workflow.actions.For_Each_RESOLVED_Email.actions.Condition_Is_Eligible_RESOLVED;
const exact = eligible.actions.Condition_Message_Not_Processed.actions.Condition_Exactly_One_Match;
const update = exact.actions.Update_Matching_Incident_RESOLVED;

workflow.parameters.operationsAlertEndpoint = { type: 'String', defaultValue: 'https://mango-wave-09cff3700.7.azurestaticapps.net/api/operations/alert-events' };
workflow.parameters.operationsAutomationKey = { type: 'SecureString', defaultValue: '' };

// Companion event delivery. It never blocks or replaces the proven v1.0.3
// SharePoint/ADO reconciliation path.
exact.actions.Submit_RESOLVED_Event_API = {
  runAfter: { Update_Matching_Incident_RESOLVED: ['Succeeded'] },
  type: 'Http',
  inputs: {
    method: 'POST',
    uri: "@parameters('operationsAlertEndpoint')",
    headers: {
      'Content-Type': 'application/json',
      'x-operations-automation-key': "@parameters('operationsAutomationKey')",
      'x-ms-workflow-run-id': "@workflow()?['run']?['name']"
    },
    body: {
      messageId: "@outputs('Compose_Message_Id')",
      eventType: 'RESOLVED',
      alertName: "@outputs('Compose_Alert_Name')",
      resource: "@outputs('Compose_Resource')",
      firstSeenAt: "@first(body('Get_Matching_Open_FIRING')?['value'])?['FirstSeenAt']",
      resolvedAt: "@outputs('Compose_Resolved_At')",
      receivedAt: "@coalesce(items('For_Each_RESOLVED_Email')?['receivedDateTime'],utcNow())",
      rawSubject: "@outputs('Compose_Email_Subject')"
    },
    retryPolicy: { type: 'fixed', count: 3, interval: 'PT20S' }
  },
  runtimeConfiguration: { secureData: { properties: ['inputs', 'outputs'] } }
};

workflow.contentVersion = '1.0.3.1';
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = 'Operations Hub - Alert Lifecycle Reconciliation v1.0.3 API Companion';
manifest.details.displayName = 'OperationsHub-AlertLifecycleReconciliation-v1.0.3-APICompanion';
manifest.details.description = 'Keeps the proven v1.0.3 SharePoint/ADO reconciliation path and adds non-blocking Operations API event logging after reconciliation.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = wrapper.properties.displayName;

writeJson(definitionPath, wrapper);
writeJson(packagePath, manifest);
console.log(`Built ${wrapper.properties.displayName} at ${output}`);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
