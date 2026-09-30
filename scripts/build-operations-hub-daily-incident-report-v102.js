const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-daily-incident-report-v102.js <v1.0.1-directory> <output-directory>');
const source = path.resolve(sourceRoot);
const output = path.resolve(outputRoot);
if (!fs.existsSync(source)) throw new Error(`Source package directory does not exist: ${source}`);
if (fs.existsSync(output)) throw new Error(`Output directory already exists: ${output}`);
fs.cpSync(source, output, { recursive: true });

const packagePath = path.join(output, 'manifest.json');
const flowRoot = path.join(output, 'Microsoft.Flow', 'flows');
const flowManifest = readJson(path.join(flowRoot, 'manifest.json'));
const assetId = flowManifest.flowAssets.assetPaths[0];
const definitionPath = path.join(flowRoot, assetId, 'definition.json');
const wrapper = readJson(definitionPath);
const manifest = readJson(packagePath);
const workflow = wrapper.properties.definition;

const before = JSON.stringify(workflow.actions);
const after = before
  .replaceAll("padLeft(string(items('For_each_Today_Incident')?['ID']),6,'0')", "formatNumber(int(items('For_each_Today_Incident')?['ID']),'000000')")
  .replaceAll("padLeft(string(items('For_each_Open_Incident')?['ID']),6,'0')", "formatNumber(int(items('For_each_Open_Incident')?['ID']),'000000')");
if (before === after || after.includes('padLeft(')) throw new Error('Expected unsupported padLeft expressions were not fully replaced');
workflow.actions = JSON.parse(after);

const displayName = 'Operations Hub - Daily Incident Report v1.0.2';
wrapper.properties.displayName = displayName;
workflow.contentVersion = '1.0.2.0';
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
manifest.details.displayName = 'OperationsHub-DailyIncidentReport-v1.0.2';
manifest.details.description = 'Runtime compatibility hotfix: replace unsupported padLeft expressions with Power Automate formatNumber while retaining the two report windows and two Teams destinations.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = displayName;
writeJson(definitionPath, wrapper);
writeJson(packagePath, manifest);
console.log(`Built ${displayName} at ${output}`);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
