const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node scripts/build-operations-hub-incident-automation-v3850-resolved-id.js <source-directory> <output-directory>');
if (!fs.existsSync(sourceRoot) || fs.existsSync(outputRoot)) throw new Error('Source must exist and output must not exist');
fs.cpSync(sourceRoot, outputRoot, { recursive: true });

const flowRoot = path.join(outputRoot, 'Microsoft.Flow', 'flows');
const manifestPath = path.join(outputRoot, 'manifest.json');
const manifest = read(manifestPath);
const assetId = read(path.join(flowRoot, 'manifest.json')).flowAssets.assetPaths[0];
const definitionPath = path.join(flowRoot, assetId, 'definition.json');
const wrapper = read(definitionPath);
const workflow = wrapper.properties.definition;
const resolved = workflow.actions.Scope_Process_Incident.actions.Condition_Message_Already_Processed.else.actions
  .Condition_Priority_is_P1_or_P2.actions.Condition_Is_RESOLVED.actions;
const lookup = resolved.Get_latest_open_FIRING;
if (!lookup || !resolved.Condition_Matching_FIRING_Found) throw new Error('Unexpected RESOLVED branch structure');
if (!lookup.inputs.parameters['$filter'].includes('FirstSeenAt ge')) throw new Error('Expected v3.8.49 FirstSeenAt filter');

// The FIRING and RESOLVED messages compute the same deterministic IncidentId.
// SharePoint interpreted the local FirstSeenAt field in a different time zone,
// so the v3.8.49 +/- one minute filter omitted an otherwise valid incident.
lookup.inputs.parameters['$filter'] =
  "@concat('IncidentId eq ''',replace(outputs('Compose_IncidentId'),'''','''''')," +
  "''' and AdoWorkItemId ne null and (AlertStatus eq ''FIRING'' or AlertStatus eq ''RESOLVED'')')";
lookup.inputs.parameters['$orderby'] = 'ID desc';

const version = '3.8.50';
const displayName = `Operations Hub - Incident Automation v${version}`;
wrapper.properties.displayName = displayName;
workflow.contentVersion = `${version}.0`;
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
manifest.details.displayName = displayName;
manifest.details.description = 'Match RESOLVED to the FIRING incident by deterministic IncidentId, avoiding SharePoint FirstSeenAt timezone mismatch; send Teams after the incident update.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = displayName;
write(definitionPath, wrapper);
write(manifestPath, manifest);

function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
