const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node scripts/build-operations-hub-incident-automation-v3845-appserviceplan-skip.js <source-directory> <output-directory>');
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

const p1 = findAction(workflow.actions, 'Condition_Priority_is_P1_or_P2');
const p2 = findAction(workflow.actions, 'Condition_Priority_is_P2');
if (!p1 || !p2) throw new Error('Priority routing conditions not found');
const skip = {
  or: [
    { contains: ["@toLower(trim(outputs('Compose_AlertName')))", 'appserviceplan'] },
    { contains: ["@toLower(trim(outputs('Compose_Resource')))", 'appserviceplan'] },
    { contains: ["@toLower(triggerOutputs()?['body/subject'])", 'appserviceplan'] },
  ],
};
p1.expression.and[1] = { not: skip };
p2.expression.or[2] = skip;

const version = '3.8.45';
const displayName = `Operations Hub - Incident Automation v${version}`;
wrapper.properties.displayName = displayName;
workflow.contentVersion = `${version}.0`;
manifest.details.displayName = `OperationsHub-IncidentAutomation-v${version}`;
manifest.details.description = 'Skip AppServicePlan alerts using alert name, resource, or subject before creating a P1 incident or approval.';
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
