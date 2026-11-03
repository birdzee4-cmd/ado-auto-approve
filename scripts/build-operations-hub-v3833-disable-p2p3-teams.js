const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-v3833-disable-p2p3-teams.js <v3.8.32-directory> <output-directory>');
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
const incidentActions = workflow.actions.Scope_Process_Incident.actions
  .Condition_Message_Already_Processed.else.actions;
const p2Branch = incidentActions.Condition_Priority_is_P1_or_P2.else.actions.Condition_Priority_is_P2;

// P2/P3 remain accepted for routing, but are silent: no Teams message,
// incident, approval, or Azure DevOps work item is created.
delete p2Branch.actions.Post_P2_notification_to_Teams;
p2Branch.actions.Terminate_P2_notification_only = {
  type: 'Terminate',
  inputs: { runStatus: 'Succeeded' }
};
delete p2Branch.actions.Terminate_P2_notification_only.runAfter;

workflow.contentVersion = '3.8.33.0';
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = 'Operations Hub - Incident Automation v3.8.33';
manifest.details.displayName = 'OperationsHub-IncidentAutomation-v3.8.33';
manifest.details.description = 'P2/P3 remain notification-only but no longer post messages to Microsoft Teams.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = wrapper.properties.displayName;

writeJson(definitionPath, wrapper);
writeJson(packagePath, manifest);
console.log(`Built ${wrapper.properties.displayName} at ${output}`);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
