const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-v3811-episode-dedup.js <v3.8.10-directory> <output-directory>');
const source = path.resolve(sourceRoot);
const output = path.resolve(outputRoot);
if (!fs.existsSync(source)) throw new Error(`Source package directory does not exist: ${source}`);
if (fs.existsSync(output)) throw new Error(`Output directory already exists: ${output}`);
fs.cpSync(source, output, { recursive: true });

const flowRoot = path.join(output, 'Microsoft.Flow', 'flows');
const fm = readJson(path.join(flowRoot, 'manifest.json'));
const assetId = fm.flowAssets.assetPaths[0];
const definitionPath = path.join(flowRoot, assetId, 'definition.json');
const packagePath = path.join(output, 'manifest.json');
const wrapper = readJson(definitionPath);
const manifest = readJson(packagePath);
const workflow = wrapper.properties.definition;

const branch = workflow.actions.Scope_Process_Incident.actions.Condition_Message_Already_Processed.else.actions
  .Condition_Priority_is_P1_or_P2.actions.Condition_Is_RESOLVED.else.actions;
const query = branch.Get_items_by_IncidentId.inputs.parameters;
query['$filter'] = "@concat('Title eq ''',replace(outputs('Compose_AlertName'),'''',''''''),''' and Resource eq ''',replace(outputs('Compose_Resource'),'''',''''''),''' and Environment eq ''',replace(outputs('Compose_Environment'),'''',''''''),''' and FirstSeenAt eq ''',outputs('Compose_FirstSeenAt'),''' and AlertStatus eq ''FIRING'' and ResolvedAt eq null')";
query['$orderby'] = 'LastAlertAt desc';
query['$top'] = 1;

workflow.contentVersion = '3.8.11.0';
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = 'Operations Hub - Incident Automation v3.8.11';
manifest.details.displayName = 'OperationsHub-IncidentAutomation-v3.8.11';
manifest.details.description = 'Episode-aware FIRING deduplication: reuse an incident only when Alert, Resource, Environment, and First Seen are identical; a new First Seen creates a new incident and Work Item.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = wrapper.properties.displayName;

writeJson(definitionPath, wrapper);
writeJson(packagePath, manifest);
console.log(`Built ${wrapper.properties.displayName} at ${output}`);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
