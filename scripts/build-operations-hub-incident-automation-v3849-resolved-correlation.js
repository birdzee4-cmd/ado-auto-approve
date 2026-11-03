const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node scripts/build-operations-hub-incident-automation-v3849-resolved-correlation.js <source-directory> <output-directory>');
if (!fs.existsSync(sourceRoot) || fs.existsSync(outputRoot)) throw new Error('Source must exist and output must not exist');
fs.cpSync(sourceRoot, outputRoot, { recursive: true });

const flowRoot = path.join(outputRoot, 'Microsoft.Flow', 'flows');
const assetId = read(path.join(flowRoot, 'manifest.json')).flowAssets.assetPaths[0];
const definitionPath = path.join(flowRoot, assetId, 'definition.json');
const manifestPath = path.join(outputRoot, 'manifest.json');
const wrapper = read(definitionPath);
const manifest = read(manifestPath);
const workflow = wrapper.properties.definition;
const resolved = workflow.actions.Scope_Process_Incident.actions.Condition_Message_Already_Processed.else.actions
  .Condition_Priority_is_P1_or_P2.actions.Condition_Is_RESOLVED.actions;
const lookup = resolved.Get_latest_open_FIRING;
if (!lookup || !resolved.Condition_Matching_FIRING_Found) throw new Error('Unexpected RESOLVED branch structure');
const original = lookup.inputs.parameters['$filter'];
if (!original.includes("Metric eq ''") && !original.includes("Metric eq '''")) {
  // The expected source contains a Compose_Metric clause, not a literal empty value.
  if (!original.includes("Metric eq ''',replace(outputs('Compose_Metric')")) throw new Error('Unexpected source filter');
}
lookup.inputs.parameters['$filter'] =
  "@concat('Title eq ''',replace(outputs('Compose_AlertName'),'''','''''')," +
  "''' and Resource eq ''',replace(outputs('Compose_Resource'),'''','''''')," +
  "''' and Environment eq ''',replace(outputs('Compose_Environment'),'''','''''')," +
  "''' and AdoWorkItemId ne null and FirstSeenAt ge ''',addMinutes(outputs('Compose_FirstSeenAt'),-1)," +
  "''' and FirstSeenAt le ''',addMinutes(outputs('Compose_FirstSeenAt'),1)," +
  "''' and FirstSeenAt lt ''',outputs('Compose_ResolvedAt')," +
  "''' and (AlertStatus eq ''FIRING'' or AlertStatus eq ''RESOLVED'')')";
lookup.inputs.parameters['$orderby'] = 'FirstSeenAt desc';

const version = '3.8.49';
const displayName = `Operations Hub - Incident Automation v${version}`;
wrapper.properties.displayName = displayName;
workflow.contentVersion = `${version}.0`;
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
manifest.details.displayName = displayName;
manifest.details.description = 'Match RESOLVED by alert, resource, environment, and First Seen time when the recovery email omits Metric; send Teams after the matched incident update.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = displayName;
write(definitionPath, wrapper);
write(manifestPath, manifest);

function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
