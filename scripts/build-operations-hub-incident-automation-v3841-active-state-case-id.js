const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot, version = '3.8.41'] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-incident-automation-v3841-active-state-case-id.js <source-directory> <output-directory>');
const source = path.resolve(sourceRoot), output = path.resolve(outputRoot);
if (!fs.existsSync(source)) throw new Error(`Source package directory does not exist: ${source}`);
if (fs.existsSync(output)) throw new Error(`Output directory already exists: ${output}`);
fs.cpSync(source, output, { recursive: true });

const flowRoot = path.join(output, 'Microsoft.Flow', 'flows');
const flowManifest = readJson(path.join(flowRoot, 'manifest.json'));
const assetId = flowManifest.flowAssets.assetPaths[0];
const definitionPath = path.join(flowRoot, assetId, 'definition.json');
const packagePath = path.join(output, 'manifest.json');
const wrapper = readJson(definitionPath), manifest = readJson(packagePath);
const workflow = wrapper.properties.definition;

const assign = findAction(workflow.actions, 'Assign_Work_Item_to_Approver');
const approved = findAction(workflow.actions, 'Update_Incident_Approved');
const resolvedPost = findAction(workflow.actions, 'Post_RESOLVED_to_Teams');
if (!assign || !approved || !resolvedPost) throw new Error('Required approval/resolved actions were not found');

// Approval means the Tier 1 owner has accepted the work, so the VSTS item is Active.
assign.inputs.parameters['workItem/dynamicFields/System.State'] = 'Active';
approved.inputs.parameters['item/AdoState'] = 'Active';

const caseId = "INC-@{formatDateTime(first(body('Get_latest_open_FIRING')?['value'])?['FirstSeenAt'],'yyyy')}-@{formatNumber(int(first(body('Get_latest_open_FIRING')?['value'])?['ID']),'000000')}";
const body = resolvedPost.inputs.parameters['body/messageBody'];
resolvedPost.inputs.parameters['body/messageBody'] = body.replace(
  '<b>Alert:</b>',
  `<b>Case ID:</b> ${caseId}<br><b>Alert:</b>`
);

const displayName = `Operations Hub - Incident Automation v${version}`;
wrapper.properties.displayName = displayName;
workflow.contentVersion = `${version}.0`;
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
manifest.details.displayName = `OperationsHub-IncidentAutomation-v${version}`;
manifest.details.description = 'Approval lifecycle: move the Tier 1 VSTS Work Item to Active after approval and include the human-readable Case ID in RESOLVED notifications.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = displayName;

writeJson(definitionPath, wrapper); writeJson(packagePath, manifest);
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
