const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) {
  throw new Error('Usage: node build-operations-hub-v3856-timezone-package.js <source> <output>');
}
if (fs.existsSync(outputRoot)) throw new Error(`Output already exists: ${outputRoot}`);
fs.cpSync(sourceRoot, outputRoot, { recursive: true });

const flowRoot = path.join(outputRoot, 'Microsoft.Flow', 'flows');
const assetId = fs.readdirSync(flowRoot).find((name) => name !== 'manifest.json');
const definitionPath = path.join(flowRoot, assetId, 'definition.json');
const manifestPath = path.join(outputRoot, 'manifest.json');
const flowManifestPath = path.join(flowRoot, 'manifest.json');
const wrapper = readJson(definitionPath);
const manifest = readJson(manifestPath);
const flowManifest = readJson(flowManifestPath);
const version = '3.8.56';
const displayName = `Operations Hub - Incident Automation v${version}`;

const definition = wrapper.properties.definition;
definition.contentVersion = `${version}.0`;
definition.metadata = definition.metadata || {};
definition.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = displayName;
manifest.details.displayName = `OperationsHub-IncidentAutomation-v${version}-Timezone-Import`;
manifest.details.description = 'Timezone-audited revision. FirstSeenAt and ResolvedAt are persisted as explicit ISO-8601 values with +07:00 offset; display values use the source Asia/Bangkok wall-clock text; operational timestamps remain UTC.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].creationType = 'Existing, New, Update';
manifest.resources[assetId].details.displayName = displayName;

writeJson(definitionPath, wrapper);
writeJson(manifestPath, manifest);
writeJson(flowManifestPath, flowManifest);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
