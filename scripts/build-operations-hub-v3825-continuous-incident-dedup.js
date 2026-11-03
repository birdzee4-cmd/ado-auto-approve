const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-v3825-continuous-incident-dedup.js <current-flow-directory> <output-directory>');
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
const incidentBranch = workflow.actions.Scope_Process_Incident.actions
  .Condition_Message_Already_Processed.else.actions
  .Condition_Priority_is_P1_or_P2.actions;
const resolved = incidentBranch.Condition_Is_RESOLVED.actions;
const firing = incidentBranch.Condition_Is_RESOLVED.else.actions;

// A delivery prefix (NowAlert/WaitAlert) and a changing First Seen value are
// notification details, not episode identity. Reuse the active episode by
// alert/resource/environment/metric while it is still unresolved.
firing.Get_items_by_IncidentId.inputs.parameters['$filter'] =
  "@concat('Title eq ''',replace(outputs('Compose_AlertName'),'''',''''''),''' and Resource eq ''',replace(outputs('Compose_Resource'),'''',''''''),''' and Environment eq ''',replace(outputs('Compose_Environment'),'''',''''''),''' and Metric eq ''',replace(outputs('Compose_Metric'),'''',''''''),''' and AlertStatus eq ''FIRING'' and ResolvedAt eq null')";
firing.Get_items_by_IncidentId.inputs.parameters['$orderby'] = 'FirstSeenAt asc';
firing.Get_items_by_IncidentId.inputs.parameters['$top'] = 1;

const resolvedLookup = resolved.Get_latest_open_FIRING;
resolvedLookup.inputs.parameters['$filter'] =
  "@concat('Title eq ''',replace(outputs('Compose_AlertName'),'''',''''''),''' and Resource eq ''',replace(outputs('Compose_Resource'),'''',''''''),''' and Environment eq ''',replace(outputs('Compose_Environment'),'''',''''''),''' and Metric eq ''',replace(outputs('Compose_Metric'),'''',''''''),''' and AlertStatus eq ''FIRING'' and ResolvedAt eq null and FirstSeenAt lt ''',outputs('Compose_ResolvedAt'),'''')";
resolvedLookup.inputs.parameters['$orderby'] = 'FirstSeenAt asc';
resolvedLookup.inputs.parameters['$top'] = 1;

// A second RESOLVED notification must be idempotent: once the active episode
// is resolved, it must not create a new cancelled incident.
const resolvedCondition = resolved.Condition_Matching_FIRING_Found;
resolvedCondition.else.actions = {
  Terminate_Duplicate_RESOLVED: {
    type: 'Terminate',
    inputs: { runStatus: 'Succeeded' }
  }
};

workflow.contentVersion = '3.8.31.0';
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = 'Operations Hub - Incident Automation v3.8.31';
manifest.details.displayName = 'OperationsHub-IncidentAutomation-v3.8.31';
manifest.details.description = 'Reuse one active incident across NowAlert and WaitAlert deliveries; correlate RESOLVED by alert/resource/environment/metric and make duplicate RESOLVED notifications idempotent.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = wrapper.properties.displayName;

writeJson(definitionPath, wrapper);
writeJson(packagePath, manifest);
console.log(`Built ${wrapper.properties.displayName} at ${output}`);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
