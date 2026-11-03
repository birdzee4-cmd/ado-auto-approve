const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-v3832-continuity-window.js <v3.8.31-directory> <output-directory>');
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
const firing = incidentBranch.Condition_Is_RESOLVED.else.actions;

// Reuse an active episode only when a matching alert was seen within the
// 30-minute continuity window. This prevents stale FIRING rows from hijacking
// a new incident while still combining NowAlert/WaitAlert deliveries.
firing.Get_items_by_IncidentId.inputs.parameters['$filter'] =
  "@concat('Title eq ''',replace(outputs('Compose_AlertName'),'''',''''''),''' and Resource eq ''',replace(outputs('Compose_Resource'),'''',''''''),''' and Environment eq ''',replace(outputs('Compose_Environment'),'''',''''''),''' and Metric eq ''',replace(outputs('Compose_Metric'),'''',''''''),''' and AlertStatus eq ''FIRING'' and ResolvedAt eq null and LastAlertAt ge ''',formatDateTime(addMinutes(utcNow(),-30),'yyyy-MM-ddTHH:mm:ssZ'),'''')";
firing.Get_items_by_IncidentId.inputs.parameters['$orderby'] = 'LastAlertAt desc';
firing.Get_items_by_IncidentId.inputs.parameters['$top'] = 1;

workflow.contentVersion = '3.8.32.0';
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = 'Operations Hub - Incident Automation v3.8.32';
manifest.details.displayName = 'OperationsHub-IncidentAutomation-v3.8.32';
manifest.details.description = 'Continuous incident deduplication with a 30-minute LastAlertAt window; combines NowAlert/WaitAlert deliveries without reusing stale FIRING incidents.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = wrapper.properties.displayName;

writeJson(definitionPath, wrapper);
writeJson(packagePath, manifest);
console.log(`Built ${wrapper.properties.displayName} at ${output}`);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
