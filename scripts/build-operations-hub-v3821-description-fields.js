const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-v3821-description-fields.js <v3.8.20-directory> <output-directory>');
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
const createWorkItem = findAction(wrapper.properties.definition.actions, 'Create_Azure_DevOps_work_item');
if (!createWorkItem) throw new Error('Create_Azure_DevOps_work_item action was not found');

const description = createWorkItem.inputs.parameters['workItem/description'];
if (!description.includes("outputs('Compose_AppServicePlan')") || !description.includes("outputs('Compose_DefaultHost')")) {
  throw new Error('v3.8.20 description template does not contain the expected insertion point');
}

wrapper.properties.definition.contentVersion = '3.8.21.0';
wrapper.properties.definition.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = 'Operations Hub - Incident Automation v3.8.21';
manifest.details.displayName = 'OperationsHub-IncidentAutomation-v3.8.21';
manifest.details.description = 'Restore Azure App Service platform details in new VSTS Work Item descriptions while retaining Case ID titles and Technical Incident ID correlation.';
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
