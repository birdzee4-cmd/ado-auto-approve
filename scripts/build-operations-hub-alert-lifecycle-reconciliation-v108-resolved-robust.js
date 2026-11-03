const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-alert-lifecycle-reconciliation-v108-resolved-robust.js <source-directory> <output-directory>');
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
const loopActions = workflow.actions.For_Each_RESOLVED_Email.actions;
const actions = loopActions.Condition_Is_Eligible_RESOLVED;

workflow.parameters.operationsAlertEndpoint = { type: 'String', defaultValue: 'https://mango-wave-09cff3700.7.azurestaticapps.net/api/operations/alert-events' };
workflow.parameters.operationsAutomationKey = { type: 'SecureString', defaultValue: '' };

// Accept real Outlook plain-text/HTML variants. The API performs the authoritative match.
actions.expression = { and: [
  { greaterOrEquals: ["@ticks(coalesce(items('For_Each_RESOLVED_Email')?['receivedDateTime'],utcNow()))", "@ticks(addHours(utcNow(),-168))"] },
  { contains: ["@toUpper(coalesce(items('For_Each_RESOLVED_Email')?['subject'],''))", 'RESOLVED'] },
  { or: [
    { contains: ["@toUpper(coalesce(items('For_Each_RESOLVED_Email')?['bodyPreview'],''))", 'ALERT'] },
    { contains: ["@toUpper(coalesce(items('For_Each_RESOLVED_Email')?['body'],''))", 'ALERT'] }
  ] },
  { or: [
    { contains: ["@toUpper(coalesce(items('For_Each_RESOLVED_Email')?['bodyPreview'],''))", 'RESOLVED AT'] },
    { contains: ["@toUpper(coalesce(items('For_Each_RESOLVED_Email')?['body'],''))", 'RESOLVED AT'] }
  ] }
] };

const body = "@coalesce(items('For_Each_RESOLVED_Email')?['bodyPreview'],items('For_Each_RESOLVED_Email')?['body'],'')";
loopActions.Compose_Email_Body.inputs = body;
actions.actions.Compose_Alert_Name.inputs = "@trim(first(split(last(split(outputs('Compose_Email_Body'),'Alert:')),'\n')))";
actions.actions.Compose_Resource.inputs = "@trim(first(split(last(split(outputs('Compose_Email_Body'),'Resource:')),'\n')))";

workflow.contentVersion = '1.0.9.0';
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = 'Operations Hub - Alert Lifecycle Reconciliation v1.0.9 Case-Preserving RESOLVED';
manifest.details.displayName = 'OperationsHub-AlertLifecycleReconciliation-v1.0.9-CasePreservingResolved';
manifest.details.description = 'Seven-day RESOLVED reconciliation with robust detection and case-preserving Alert/Resource extraction for SharePoint matching.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = wrapper.properties.displayName;

writeJson(definitionPath, wrapper);
writeJson(packagePath, manifest);
console.log(`Built ${wrapper.properties.displayName} at ${output}`);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
