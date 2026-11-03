const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot, version = '3.8.39'] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-incident-automation-v3839-resolved-comment-reconciliation.js <source-directory> <output-directory>');
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

const resolved = workflow.actions.Scope_Process_Incident.actions
  .Condition_Message_Already_Processed.else.actions
  .Condition_Priority_is_P1_or_P2.actions
  .Condition_Is_RESOLVED.actions;
const getIncident = resolved.Get_latest_open_FIRING;
const scope = resolved.Condition_Matching_FIRING_Found.actions.Scope_Update_Tier1_after_RESOLVED;
if (!getIncident || !scope) throw new Error('RESOLVED reconciliation actions were not found');

// v1.0.3 can reconcile the SharePoint row before this flow reaches it. Find the
// same incident whether the row is still FIRING or already RESOLVED, while
// requiring an existing Tier 1 Work Item so comments never target a blank ID.
getIncident.inputs.parameters['$filter'] = "@concat('Title eq ''',replace(outputs('Compose_AlertName'),'''',''''''),''' and Resource eq ''',replace(outputs('Compose_Resource'),'''',''''''),''' and Environment eq ''',replace(outputs('Compose_Environment'),'''',''''''),''' and Metric eq ''',replace(outputs('Compose_Metric'),'''',''''''),''' and AdoWorkItemId ne null and FirstSeenAt lt ''',outputs('Compose_ResolvedAt'),''' and (AlertStatus eq ''FIRING'' or AlertStatus eq ''RESOLVED'')')";
getIncident.inputs.parameters['$orderby'] = 'FirstSeenAt asc';
getIncident.inputs.parameters['$top'] = 1;

// If the companion flow already patched the row, continue from Skipped rather
// than skipping the Tier 1 comment reconciliation scope as well.
scope.runAfter.Update_matching_incident_RESOLVED = ['Succeeded', 'Skipped'];

const comment = scope.actions.Condition_Tier1_Work_Item_Available.actions.Add_RESOLVED_comment_to_Tier1;
if (!comment) throw new Error('Add_RESOLVED_comment_to_Tier1 was not found');
const oldRef = 'shared_visualstudioteamservices';
const newRef = 'shared_visualstudioteamservices_it_support';
const newResourceId = `b8a1e8f0-9d73-4a3a-8b6a-9e8d4d9f${version.replace(/\D/g, '').slice(-4).padStart(4, '0')}`;
comment.inputs.host.connectionName = newRef;
comment.inputs.host.connectionReferenceName = newRef;
delete comment.inputs.authentication;

const oldResourceId = connectionsMap[oldRef];
const oldResource = manifest.resources[oldResourceId];
const oldConnectionReference = wrapper.properties.connectionReferences?.[oldRef];
if (!oldResource || !oldConnectionReference) throw new Error('Original Azure DevOps connection metadata was not found');
connectionsMap[newRef] = newResourceId;
apisMap[newRef] = apisMap[oldRef];
wrapper.properties.connectionReferences[newRef] = { ...oldConnectionReference, connectionName: '' };
manifest.resources[newResourceId] = { ...oldResource, details: { ...oldResource.details, displayName: 'Azure DevOps (IT Support RESOLVED Comment)' } };
const flowResource = manifest.resources[assetId];
if (flowResource?.dependsOn && !flowResource.dependsOn.includes(newResourceId)) flowResource.dependsOn.push(newResourceId);

const displayName = `Operations Hub - Incident Automation v${version}`;
wrapper.properties.displayName = displayName;
workflow.contentVersion = `${version}.0`;
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
manifest.details.displayName = `OperationsHub-IncidentAutomation-v${version}`;
manifest.details.description = 'RESOLVED reconciliation fix: continue when SharePoint is already RESOLVED, require a Tier 1 Work Item, and post the comment through the IT Support Azure DevOps connection.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = displayName;

writeJson(definitionPath, wrapper);
writeJson(connectionsMapPath, connectionsMap);
writeJson(apisMapPath, apisMap);
writeJson(packagePath, manifest);
console.log(`Built ${displayName} at ${output}`);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
