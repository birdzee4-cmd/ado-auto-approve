const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node scripts/build-operations-hub-incident-automation-v3843-it-support-resolved-comment.js <source-directory> <output-directory>');
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
const action = findAction(workflow.actions, 'Add_RESOLVED_comment_to_Tier1');
if (!action) throw new Error('Add_RESOLVED_comment_to_Tier1 was not found');

const expectedConnection = 'shared_visualstudioteamservices_it_support';
if (!action.inputs?.host || action.inputs.host.connectionName !== expectedConnection) {
  throw new Error(`RESOLVED comment action is not bound to ${expectedConnection}`);
}

const version = '3.8.43';
const displayName = `Operations Hub - Incident Automation v${version}`;
wrapper.properties.displayName = displayName;
workflow.contentVersion = `${version}.0`;
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
manifest.details.displayName = `OperationsHub-IncidentAutomation-v${version}`;
manifest.details.description = 'RESOLVED Azure DevOps comment uses the dedicated IT Support connection; preserves Processing state and Case ID behavior.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = displayName;

writeJson(definitionPath, wrapper);
writeJson(packagePath, manifest);
console.log(`Built ${displayName} at ${output}`);

function findAction(group, name) {
  for (const [key, action] of Object.entries(group || {})) {
    if (key === name) return action;
    const nested = findAction(action.actions, name) || findAction(action.else?.actions, name);
    if (nested) return nested;
  }
  return null;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
