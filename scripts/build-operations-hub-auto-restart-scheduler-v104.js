const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node scripts/build-operations-hub-auto-restart-scheduler-v104.js <source> <output>');
if (!fs.existsSync(sourceRoot) || fs.existsSync(outputRoot)) throw new Error('Source must exist and output must be new');
fs.cpSync(sourceRoot, outputRoot, { recursive: true });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const version = '1.0.4';
const flowRoot = path.join(outputRoot, 'Microsoft.Flow', 'flows');
const flowManifest = read(path.join(flowRoot, 'manifest.json'));
const flowId = flowManifest.flowAssets.assetPaths[0];
const definitionPath = path.join(flowRoot, flowId, 'definition.json');
const manifestPath = path.join(outputRoot, 'manifest.json');
const wrapper = read(definitionPath);
const manifest = read(manifestPath);
const definition = wrapper.properties.definition;
definition.triggers.Recurrence.runtimeConfiguration = { concurrency: { runs: 1 } };
definition.actions.Call_Operations_Reconciliation_API.inputs.body = {
  scope: 'ALL',
  maxItems: 20,
  skipAssigneeReconciliation: true
};
definition.actions.Call_Operations_Reconciliation_API.inputs.retryPolicy = { type: 'none' };
definition.contentVersion = version;
definition.metadata = definition.metadata || {};
definition.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = `Operations Hub - Auto-Restart Scheduler v${version}`;
manifest.details.displayName = `OperationsHub-AutoRestartScheduler-v${version}-Import`;
manifest.details.description = 'One-minute scheduler with single-run concurrency and scheduler mode to avoid duplicate SharePoint reconciliation reads.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[flowId].details.displayName = wrapper.properties.displayName;
write(definitionPath, wrapper);
write(manifestPath, manifest);
console.log(JSON.stringify({ version, outputRoot }));
