const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) {
  throw new Error('Usage: node build-operations-hub-v387-hotfix.js <v3.8.6-extracted-directory> <output-directory>');
}

const source = path.resolve(sourceRoot);
const output = path.resolve(outputRoot);
if (!fs.existsSync(source)) throw new Error(`Source package directory does not exist: ${source}`);
if (fs.existsSync(output)) throw new Error(`Output directory already exists: ${output}`);

fs.cpSync(source, output, { recursive: true });

const packageManifestPath = path.join(output, 'manifest.json');
const flowAssetsRoot = path.join(output, 'Microsoft.Flow', 'flows');
const flowManifest = readJson(path.join(flowAssetsRoot, 'manifest.json'));
const assetPaths = flowManifest.flowAssets && flowManifest.flowAssets.assetPaths;
if (!Array.isArray(assetPaths) || assetPaths.length !== 1) {
  throw new Error('Expected exactly one flow asset');
}

const flowResourceId = assetPaths[0];
const definitionPath = path.join(flowAssetsRoot, flowResourceId, 'definition.json');
const wrapper = readJson(definitionPath);
const packageManifest = readJson(packageManifestPath);
const workflow = wrapper.properties && wrapper.properties.definition;
if (!workflow) throw new Error('Flow definition was not found');

const triggerEntries = Object.entries(workflow.triggers || {}).filter(([, trigger]) =>
  trigger.inputs && trigger.inputs.host && trigger.inputs.host.operationId === 'OnNewEmailV3'
);
if (triggerEntries.length !== 1) throw new Error(`Expected one OnNewEmailV3 trigger, found ${triggerEntries.length}`);

const [, emailTrigger] = triggerEntries[0];
delete emailTrigger.inputs.parameters.subjectFilter;
if (emailTrigger.runtimeConfiguration) {
  delete emailTrigger.runtimeConfiguration.concurrency;
  if (Object.keys(emailTrigger.runtimeConfiguration).length === 0) delete emailTrigger.runtimeConfiguration;
}

const displayName = 'Operations Hub - Incident Automation v3.8.7';
workflow.contentVersion = '3.8.7.0';
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = displayName;

packageManifest.details.displayName = 'OperationsHub-IncidentAutomation-v3.8.7';
packageManifest.details.description =
  'Production intake hotfix: remove trigger serialization so pending approvals do not block later alerts, accept both FIRING and RESOLVED mail, and retain SourceMessageId/IncidentId deduplication.';
packageManifest.details.createdTime = new Date().toISOString();
const flowResource = packageManifest.resources && packageManifest.resources[flowResourceId];
if (!flowResource) throw new Error(`Flow resource ${flowResourceId} was not found in package manifest`);
flowResource.details.displayName = displayName;

writeJson(definitionPath, wrapper);
writeJson(packageManifestPath, packageManifest);
console.log(`Built ${displayName} at ${output}`);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value));
}
