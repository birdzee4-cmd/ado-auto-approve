const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) {
  throw new Error('Usage: node build-operations-hub-v388-assignee-hotfix.js <v3.8.7-extracted-directory> <output-directory>');
}

const source = path.resolve(sourceRoot);
const output = path.resolve(outputRoot);
if (!fs.existsSync(source)) throw new Error(`Source package directory does not exist: ${source}`);
if (fs.existsSync(output)) throw new Error(`Output directory already exists: ${output}`);
fs.cpSync(source, output, { recursive: true });

const packageManifestPath = path.join(output, 'manifest.json');
const flowAssetsRoot = path.join(output, 'Microsoft.Flow', 'flows');
const flowManifest = readJson(path.join(flowAssetsRoot, 'manifest.json'));
const assetPaths = flowManifest.flowAssets && flowManifest.flowAssets.assetPaths;
if (!Array.isArray(assetPaths) || assetPaths.length !== 1) throw new Error('Expected exactly one flow asset');

const flowResourceId = assetPaths[0];
const definitionPath = path.join(flowAssetsRoot, flowResourceId, 'definition.json');
const wrapper = readJson(definitionPath);
const packageManifest = readJson(packageManifestPath);
const workflow = wrapper.properties && wrapper.properties.definition;
if (!workflow) throw new Error('Flow definition was not found');

const actions = indexActions(workflow.actions || {});
const assign = required(actions, 'Assign_Work_Item_to_Approver');
const updateIncident = required(actions, 'Update_Incident_Approved');
const notify = required(actions, 'Post_Approved_to_Teams');

assign.inputs.parameters['workItem/dynamicFields/System.AssignedTo'] = "@outputs('Compose_Approver_Email')";
updateIncident.inputs.parameters['item/AssignedTo'] = "@outputs('Compose_Approver_Name')";
updateIncident.inputs.parameters['item/AdoRevision'] = "@int(coalesce(body('Assign_Work_Item_to_Approver')?['rev'],body('Create_Azure_DevOps_work_item')?['rev'],0))";
notify.inputs.parameters['body/messageBody'] =
  '<p>✅ P1 acknowledged by @{outputs(\'Compose_Approver_Name\')} (@{outputs(\'Compose_Approver_Email\')}). Work Item <a href="@{outputs(\'Compose_Work_Item_URL\')}">#@{body(\'Create_Azure_DevOps_work_item\')?[\'id\']}</a> remains New and is assigned to the approver.</p>';

const displayName = 'Operations Hub - Incident Automation v3.8.8';
workflow.contentVersion = '3.8.8.0';
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = displayName;
packageManifest.details.displayName = 'OperationsHub-IncidentAutomation-v3.8.8';
packageManifest.details.description =
  'Production approval-assignee hotfix: assign the Tier 1 Azure DevOps Work Item to the approval responder, persist the assignee in SharePoint, and report the assignment accurately in Teams.';
packageManifest.details.createdTime = new Date().toISOString();
const flowResource = packageManifest.resources && packageManifest.resources[flowResourceId];
if (!flowResource) throw new Error(`Flow resource ${flowResourceId} was not found in package manifest`);
flowResource.details.displayName = displayName;

writeJson(definitionPath, wrapper);
writeJson(packageManifestPath, packageManifest);
console.log(`Built ${displayName} at ${output}`);

function indexActions(rootActions) {
  const result = new Map();
  visit(rootActions);
  return result;
  function visit(group) {
    for (const [name, action] of Object.entries(group || {})) {
      result.set(name, action);
      visit(action.actions);
      visit(action.else && action.else.actions);
    }
  }
}

function required(actions, name) {
  const action = actions.get(name);
  if (!action) throw new Error(`Required action was not found: ${name}`);
  return action;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
