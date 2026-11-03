const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot, version = '3.8.40'] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-incident-automation-v3840-firing-message.js <source-directory> <output-directory>');
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

const postFiring = findAction(workflow.actions, 'Post_FIRING_to_Teams');
if (!postFiring) throw new Error('Post_FIRING_to_Teams was not found');
postFiring.inputs.parameters['body/messageBody'] =
  "<p><b>🚨 P1 INCIDENT CREATED — FIRING</b><br><b>Alert:</b> @{outputs('Compose_AlertName')}<br><b>Resource:</b> @{outputs('Compose_Resource')}<br><b>Environment:</b> @{outputs('Compose_Environment')}<br><b>Platform:</b> @{outputs('Compose_Platform')}@{if(equals(outputs('Compose_Platform'),'BytePlus Kubernetes'),concat('<br><b>Project:</b> ',outputs('Compose_Project'),'<br><b>Workspace:</b> ',outputs('Compose_Workspace'),'<br><b>Cluster:</b> ',outputs('Compose_Cluster'),'<br><b>Namespace:</b> ',outputs('Compose_Namespace'),'<br><b>Deployment:</b> ',outputs('Compose_Deployment'),'<br><b>Pod:</b> ',outputs('Compose_Pod'),'<br><b>Container:</b> ',outputs('Compose_Container')),'')}<br><b>Severity / Priority:</b> @{outputs('Compose_Severity')} / @{outputs('Compose_Priority')}<br><b>Metric:</b> @{outputs('Compose_Metric')}<br><b>Current value:</b> @{outputs('Compose_CurrentValue')}<br><b>First seen (Asia/Bangkok):</b> @{outputs('Compose_FirstSeenDisplay')}<br><b>Case ID:</b> INC-@{formatDateTime(outputs('Compose_FirstSeenAt'),'yyyy')}-@{formatNumber(int(body('Create_FIRING_incident')?['ID']),'000000')}<br><b>Technical Incident ID:</b> @{outputs('Compose_IncidentId')}<br><b>VSTS Work Item:</b> <a href=\"@{outputs('Compose_Work_Item_URL')}\">#@{body('Create_Azure_DevOps_work_item')?['id']}</a><br><b>VSTS State:</b> New<br><b>Assigned To:</b> Waiting for acknowledgement<br><b>Approval Status:</b> Pending</p>";

const displayName = `Operations Hub - Incident Automation v${version}`;
wrapper.properties.displayName = displayName;
workflow.contentVersion = `${version}.0`;
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
manifest.details.displayName = `OperationsHub-IncidentAutomation-v${version}`;
manifest.details.description = 'FIRING notification clarity: show human-readable Case ID, retain Technical Incident ID, and display VSTS state and acknowledgement ownership.';
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
