const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node scripts/build-operations-hub-incident-automation-v3846-it-support-identity.js <source-directory> <output-directory>');
const source = path.resolve(sourceRoot);
const output = path.resolve(outputRoot);
if (!fs.existsSync(source) || fs.existsSync(output)) throw new Error('Source must exist and output must not exist');
fs.cpSync(source, output, { recursive: true });

const flowRoot = path.join(output, 'Microsoft.Flow', 'flows');
const assetId = readJson(path.join(flowRoot, 'manifest.json')).flowAssets.assetPaths[0];
const assetRoot = path.join(flowRoot, assetId);
const definitionPath = path.join(assetRoot, 'definition.json');
const connectionsMapPath = path.join(assetRoot, 'connectionsMap.json');
const apisMapPath = path.join(assetRoot, 'apisMap.json');
const packagePath = path.join(output, 'manifest.json');
const wrapper = readJson(definitionPath);
const connectionsMap = readJson(connectionsMapPath);
const apisMap = readJson(apisMapPath);
const manifest = readJson(packagePath);
const workflow = wrapper.properties.definition;
const comment = findAction(workflow.actions, 'Add_RESOLVED_comment_to_Tier1');
const oldRef = 'shared_visualstudioteamservices';
const supportRef = 'shared_visualstudioteamservices_it_support';
if (!comment || comment.inputs.host.connectionName !== supportRef) throw new Error('RESOLVED comment action is not using the IT Support reference');
if (connectionsMap[oldRef] !== connectionsMap[supportRef]) throw new Error('Source connections are not the expected shared connection');

// The old package gave both references the same resource and embedded connection.
// A separate resource with an empty embedded connection requires an explicit
// selection of the authenticated IT Support connection during import.
const newResourceId = 'f2bce09a-7cd4-44c8-a742-94655a3b3846';
if (manifest.resources[newResourceId]) throw new Error('Connection resource ID already exists');
const oldResource = manifest.resources[connectionsMap[oldRef]];
manifest.resources[newResourceId] = {
  ...oldResource,
  details: { ...oldResource.details, displayName: 'Azure DevOps - it-support@buzzebees.com (RESOLVED Discussion)' },
};
connectionsMap[supportRef] = newResourceId;
apisMap[supportRef] = apisMap[oldRef];
wrapper.properties.connectionReferences[supportRef] = {
  ...wrapper.properties.connectionReferences[oldRef],
  connectionName: '',
};
comment.inputs.host.connectionReferenceName = supportRef;
delete comment.inputs.authentication;
const dependencies = manifest.resources[assetId].dependsOn;
if (!dependencies.includes(newResourceId)) dependencies.push(newResourceId);

const version = '3.8.46';
const displayName = `Operations Hub - Incident Automation v${version}`;
wrapper.properties.displayName = displayName;
workflow.contentVersion = `${version}.0`;
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
manifest.details.displayName = displayName;
manifest.details.description = 'Use a separately mapped IT Support Azure DevOps connection for the MONITORING ALERT RESOLVED Discussion comment.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = displayName;
writeJson(definitionPath, wrapper);
writeJson(connectionsMapPath, connectionsMap);
writeJson(apisMapPath, apisMap);
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
