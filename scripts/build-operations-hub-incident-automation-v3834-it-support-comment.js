const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot, version = '3.8.34'] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-incident-automation-v3834-it-support-comment.js <source-directory> <output-directory>');
const source = path.resolve(sourceRoot);
const output = path.resolve(outputRoot);
if (!fs.existsSync(source)) throw new Error(`Source package directory does not exist: ${source}`);
if (fs.existsSync(output)) throw new Error(`Output directory already exists: ${output}`);
fs.cpSync(source, output, { recursive: true });

const flowRoot = path.join(output, 'Microsoft.Flow', 'flows');
const flowManifest = readJson(path.join(flowRoot, 'manifest.json'));
const assetId = flowManifest.flowAssets.assetPaths[0];
const definitionPath = path.join(flowRoot, assetId, 'definition.json');
const connectionsMapPath = path.join(flowRoot, assetId, 'connectionsMap.json');
const apisMapPath = path.join(flowRoot, assetId, 'apisMap.json');
const packagePath = path.join(output, 'manifest.json');
const wrapper = readJson(definitionPath);
const manifest = readJson(packagePath);
const connectionsMap = readJson(connectionsMapPath);
const apisMap = readJson(apisMapPath);

const workflow = wrapper.properties.definition;
const resolvedActions = workflow.actions.Scope_Process_Incident.actions
  .Condition_Message_Already_Processed.else.actions
  .Condition_Priority_is_P1_or_P2.actions
  .Condition_Is_RESOLVED.actions
  .Condition_Matching_FIRING_Found.actions;
const comment = resolvedActions.Scope_Update_Tier1_after_RESOLVED.actions
  .Condition_Tier1_Work_Item_Available.actions.Add_RESOLVED_comment_to_Tier1;
if (!comment) throw new Error('Add_RESOLVED_comment_to_Tier1 was not found');

const oldRef = 'shared_visualstudioteamservices';
const newRef = 'shared_visualstudioteamservices_it_support';
const newResourceId = `b8a1e8f0-9d73-4a3a-8b6a-9e8d4d9f${version.replace(/\D/g, '').slice(-4).padStart(4, '0')}`;

// Only the RESOLVED comment uses the IT Support ADO connection. All other
// ADO actions retain the original connection and behavior.
comment.inputs.host.connectionName = newRef;
comment.inputs.host.connectionReferenceName = newRef;
delete comment.inputs.authentication;

const oldResourceId = connectionsMap[oldRef];
connectionsMap[newRef] = newResourceId;
apisMap[newRef] = apisMap[oldRef];

const oldResource = manifest.resources[oldResourceId];
if (!oldResource) throw new Error(`Manifest resource for ${oldRef} was not found`);
const oldConnectionReference = wrapper.properties.connectionReferences?.[oldRef];
if (!oldConnectionReference) throw new Error(`Flow connection reference for ${oldRef} was not found`);
wrapper.properties.connectionReferences[newRef] = {
  ...oldConnectionReference,
  connectionName: ''
};
manifest.resources[newResourceId] = {
  ...oldResource,
  details: {
    ...oldResource.details,
    displayName: 'Azure DevOps (IT Support RESOLVED Comment)'
  }
};
const flowResource = manifest.resources[assetId];
if (flowResource?.dependsOn && !flowResource.dependsOn.includes(newResourceId)) flowResource.dependsOn.push(newResourceId);

wrapper.properties.displayName = `Operations Hub - Incident Automation v${version}`;
wrapper.properties.definition.contentVersion = `${version}.0`;
wrapper.properties.definition.metadata.clientLastModifiedTime = new Date().toISOString();
manifest.details.displayName = `OperationsHub-IncidentAutomation-v${version}`;
manifest.details.description = 'RESOLVED comment identity isolation: use the IT Support Azure DevOps connection only for the monitoring RESOLVED comment; retain all other v3.8.33 connections and behavior.';
manifest.resources[assetId].details.displayName = wrapper.properties.displayName;
manifest.details.createdTime = new Date().toISOString();

writeJson(definitionPath, wrapper);
writeJson(connectionsMapPath, connectionsMap);
writeJson(apisMapPath, apisMap);
writeJson(packagePath, manifest);
console.log(`Built ${wrapper.properties.displayName} at ${output}`);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
