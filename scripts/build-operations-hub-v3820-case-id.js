const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-v3820-case-id.js <v3.8.19-directory> <output-directory>');
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
const actions = wrapper.properties.definition.actions;
const createWorkItem = findAction(actions, 'Create_Azure_DevOps_work_item');
if (!createWorkItem) throw new Error('Create_Azure_DevOps_work_item action was not found');

const caseId = "INC-@{formatDateTime(outputs('Compose_FirstSeenAt'),'yyyy')}-@{formatNumber(int(body('Create_FIRING_incident')?['ID']),'000000')}";
createWorkItem.inputs.parameters['workItem/title'] = `[${caseId}] @{outputs('Compose_AlertName')} | @{outputs('Compose_Resource')}`;
createWorkItem.inputs.parameters['workItem/description'] = `<p><b>Case ID:</b> ${caseId}</p><p><b>Alert:</b> @{outputs('Compose_AlertName')}</p><p><b>Resource:</b> @{outputs('Compose_Resource')}<br><b>Environment:</b> @{outputs('Compose_Environment')}<br><b>Severity / Priority:</b> @{outputs('Compose_Severity')} / @{outputs('Compose_Priority')}<br><b>Metric:</b> @{outputs('Compose_Metric')}<br><b>Current value:</b> @{outputs('Compose_CurrentValue')}<br><b>Threshold:</b> @{outputs('Compose_ThresholdDetail')}<br><b>First seen (Asia/Bangkok):</b> @{outputs('Compose_FirstSeenDisplay')}<br><b>Incident ID:</b> @{outputs('Compose_IncidentId')}</p>`;

wrapper.properties.definition.contentVersion = '3.8.20.0';
wrapper.properties.definition.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = 'Operations Hub - Incident Automation v3.8.20';
manifest.details.displayName = 'OperationsHub-IncidentAutomation-v3.8.20';
manifest.details.description = 'Case ID display title: use INC-YYYY-NNNNNN in new VSTS Work Item titles while retaining Technical Incident ID correlation and v3.8.19 lifecycle behavior.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = wrapper.properties.displayName;

writeJson(definitionPath, wrapper);
writeJson(packagePath, manifest);
console.log(`Built ${wrapper.properties.displayName} at ${output}`);

function findAction(current, name) {
  for (const [key, action] of Object.entries(current || {})) {
    if (key === name) return action;
    const nested = findAction(action.actions, name) || findAction(action.else && action.else.actions, name);
    if (nested) return nested;
  }
  return null;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
