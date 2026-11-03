const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node scripts/build-operations-hub-incident-automation-v3847-alert-firing.js <source-directory> <output-directory>');
if (!fs.existsSync(sourceRoot) || fs.existsSync(outputRoot)) throw new Error('Source must exist and output must not exist');
fs.cpSync(sourceRoot, outputRoot, { recursive: true });

const flowRoot = path.join(outputRoot, 'Microsoft.Flow', 'flows');
const assetId = read(path.join(flowRoot, 'manifest.json')).flowAssets.assetPaths[0];
const definitionPath = path.join(flowRoot, assetId, 'definition.json');
const manifestPath = path.join(outputRoot, 'manifest.json');
const wrapper = read(definitionPath);
const manifest = read(manifestPath);
const workflow = wrapper.properties.definition;
const newIncident = workflow.actions.Scope_Process_Incident.actions.Condition_Message_Already_Processed.else.actions
  .Condition_Priority_is_P1_or_P2.actions.Condition_Is_RESOLVED.else.actions
  .Condition_FIRING_Incident_Exists.else.actions;
if (!newIncident.Create_FIRING_incident || !newIncident.Post_FIRING_to_Teams || newIncident.Post_Alert_FIRING_to_Teams) {
  throw new Error('Unexpected FIRING branch structure');
}
newIncident.Post_Alert_FIRING_to_Teams = structuredClone(newIncident.Post_FIRING_to_Teams);
newIncident.Post_Alert_FIRING_to_Teams.runAfter = { Create_FIRING_incident: ['Succeeded'] };
newIncident.Post_Alert_FIRING_to_Teams.inputs.parameters['body/messageBody'] =
  "<p><b>🔥 ALERT FIRING</b><br><b>Alert:</b> @{outputs('Compose_AlertName')}<br><b>Severity / Priority:</b> @{outputs('Compose_Severity')} / @{outputs('Compose_Priority')}<br><br><b>📌 Resource</b><br>• Resource: @{outputs('Compose_Resource')}<br>• Environment: @{outputs('Compose_Environment')}<br>• Platform: @{outputs('Compose_Platform')}<br><br><b>📊 Condition</b><br>• Metric: @{outputs('Compose_Metric')}<br>• Current Value: @{outputs('Compose_CurrentValue')}<br>• Threshold: @{outputs('Compose_ThresholdDetail')}<br><br><b>Summary:</b> @{outputs('Compose_AlertSummary')}<br><br><b>First Seen:</b> @{outputs('Compose_FirstSeenDisplay')}</p>";

const version = '3.8.47';
const displayName = `Operations Hub - Incident Automation v${version}`;
wrapper.properties.displayName = displayName;
workflow.contentVersion = `${version}.0`;
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
manifest.details.displayName = displayName;
manifest.details.description = 'Restore a separate ALERT FIRING Teams message for new P1 incidents while retaining the incident-created notification.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = displayName;
write(definitionPath, wrapper);
write(manifestPath, manifest);

function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
