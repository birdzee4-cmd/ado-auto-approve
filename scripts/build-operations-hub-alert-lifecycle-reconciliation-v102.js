const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-alert-lifecycle-reconciliation-v102.js <v1.0.1-directory> <output-directory>');
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
const eligible = workflow.actions.For_Each_RESOLVED_Email.actions.Condition_Is_Eligible_RESOLVED;

const actions = eligible.actions;
const match = actions.Condition_Message_Not_Processed.actions.Get_Matching_Open_FIRING.inputs.parameters;
// Do not require an exact FirstSeenAt match. The incident flow and the
// monitoring email can serialize the same Bangkok wall-clock time with
// different UTC offsets (and older incidents were stored with a connector
// timezone conversion). Correlate the open episode by identity and ordering.
match['$filter'] = "@concat('Title eq ''',replace(outputs('Compose_Alert_Name'),'''',''''''),''' and Resource eq ''',replace(outputs('Compose_Resource'),'''',''''''),''' and AlertStatus eq ''FIRING'' and ResolvedAt eq null and FirstSeenAt lt ''',outputs('Compose_Resolved_At'),'''')";
match['$orderby'] = 'FirstSeenAt desc';
match['$top'] = 2;

workflow.contentVersion = '1.0.2.0';
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = 'Operations Hub - Alert Lifecycle Reconciliation v1.0.2';
manifest.details.displayName = 'OperationsHub-AlertLifecycleReconciliation-v1.0.2';
manifest.details.description = 'Episode-aware RESOLVED reconciliation: correlate CRITICAL/P1 mail by Alert, Resource, and FirstSeenAt before ResolvedAt; tolerate serialization/timezone differences, suppress NO MATCH, and warn only for ambiguous matches.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = wrapper.properties.displayName;

writeJson(definitionPath, wrapper);
writeJson(packagePath, manifest);
console.log(`Built ${wrapper.properties.displayName} at ${output}`);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
