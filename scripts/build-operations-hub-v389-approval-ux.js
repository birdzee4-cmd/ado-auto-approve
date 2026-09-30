const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) {
  throw new Error('Usage: node build-operations-hub-v389-approval-ux.js <v3.8.8-extracted-directory> <output-directory>');
}

const source = path.resolve(sourceRoot);
const output = path.resolve(outputRoot);
if (!fs.existsSync(source)) throw new Error(`Source package directory does not exist: ${source}`);
if (fs.existsSync(output)) throw new Error(`Output directory already exists: ${output}`);
fs.cpSync(source, output, { recursive: true });

const packageManifestPath = path.join(output, 'manifest.json');
const flowAssetsRoot = path.join(output, 'Microsoft.Flow', 'flows');
const flowManifest = readJson(path.join(flowAssetsRoot, 'manifest.json'));
const assetPaths = flowManifest.flowAssets?.assetPaths;
if (!Array.isArray(assetPaths) || assetPaths.length !== 1) throw new Error('Expected exactly one flow asset');

const flowResourceId = assetPaths[0];
const definitionPath = path.join(flowAssetsRoot, flowResourceId, 'definition.json');
const wrapper = readJson(definitionPath);
const packageManifest = readJson(packageManifestPath);
const workflow = wrapper.properties?.definition;
if (!workflow) throw new Error('Flow definition was not found');

const actions = indexActions(workflow.actions || {});
const approval = required(actions, 'Start_and_wait_for_an_approval');
const parameters = approval.inputs.parameters;
const displayId = "@{concat('INC-',formatDateTime(convertTimeZone(utcNow(),'UTC','SE Asia Standard Time'),'yyyy'),'-',padLeft(string(body('Create_FIRING_incident')?['ID']),6,'0'))}";
const workItemId = "@{body('Create_Azure_DevOps_work_item')?['id']}";

parameters['WebhookApprovalCreationInput/title'] =
  `P1 Approval | ${displayId} | @{outputs('Compose_Resource')}`;
parameters['WebhookApprovalCreationInput/details'] = [
  '**P1 INCIDENT — ACKNOWLEDGEMENT REQUIRED**',
  '',
  `**Incident Case:** ${displayId}`,
  `**Tier 1 Work Item:** #${workItemId}`,
  '**Status:** Awaiting approval',
  '',
  '**ALERT**',
  '',
  "- **Alert:** @{outputs('Compose_AlertName')}",
  "- **Resource:** @{outputs('Compose_Resource')}",
  "- **Environment:** @{outputs('Compose_Environment')}",
  "- **Severity / Priority:** @{outputs('Compose_Severity')} / @{outputs('Compose_Priority')}",
  "- **Metric:** @{outputs('Compose_Metric')}",
  "- **Current value:** @{outputs('Compose_CurrentValue')}",
  "- **Threshold:** @{outputs('Compose_ThresholdDetail')}",
  "- **First seen:** @{outputs('Compose_FirstSeenDisplay')}",
  '',
  '**WHAT HAPPENS NEXT**',
  '',
  `- **Approve:** acknowledge this incident and assign Tier 1 Work Item #${workItemId} to you. The VSTS State remains New.`,
  '- **Reject:** move the existing Tier 1 Work Item to Reject. No duplicate Work Item is created.',
  '- App Support and IT Tier 2 Work Items are not created by this approval. They can be created later from Operations Hub.',
  '',
  `**Links:** [Open Azure DevOps #${workItemId}](@{outputs('Compose_Work_Item_URL')}) | [Open Operations Hub](https://mango-wave-09cff3700.7.azurestaticapps.net/operations.html#/incidents?id=@{uriComponent(outputs('Compose_IncidentId'))})`,
  '',
  "**Technical Incident ID:** @{outputs('Compose_IncidentId')}"
].join('\n');
parameters['WebhookApprovalCreationInput/itemLinkDescription'] =
  `Azure DevOps Tier 1 Work Item #${workItemId}`;

const displayName = 'Operations Hub - Incident Automation v3.8.9';
workflow.contentVersion = '3.8.9.0';
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = displayName;
packageManifest.details.displayName = 'OperationsHub-IncidentAutomation-v3.8.9';
packageManifest.details.description =
  'Approval UX refresh: show the human-readable INC-YYYY-###### case number, Tier 1 Work Item, Bangkok time, approval consequences, system links, and retain the technical incident ID for correlation.';
packageManifest.details.createdTime = new Date().toISOString();
const flowResource = packageManifest.resources?.[flowResourceId];
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
      visit(action.else?.actions);
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
