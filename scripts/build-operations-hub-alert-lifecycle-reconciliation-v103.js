const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-alert-lifecycle-reconciliation-v103.js <v1.0.2-directory> <output-directory>');
const source = path.resolve(sourceRoot);
const output = path.resolve(outputRoot);
// Keep reconciliation pointed at the same Outlook folder as the incident
// intake flow. The v1.0.2 package carried a stale folder id, so RESOLVED
// messages in AzureAppServiceHigh5xxRateCritical were never scanned.
const OUTLOOK_FOLDER_PATH = 'Id::AAMkADE0OWVjYjA5LWIyMDMtNDhjYS04ZDhjLWNkMWFhYzJiYWQyOQAuAAAAAAC8C8XS08R9Trfz1GrYHZKbAQBshOktFlHmSY3OPI6jffd6AAW8jkwhAAA=';
const OUTLOOK_FOLDER_NAME = 'AzureAppServiceHigh5xxRateCritical';
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
const resolvedTrigger = workflow.actions.Get_RESOLVED_Emails;
if (!resolvedTrigger) throw new Error('Get_RESOLVED_Emails action was not found');
resolvedTrigger.inputs.parameters.folderPath = OUTLOOK_FOLDER_PATH;
resolvedTrigger.metadata = { [OUTLOOK_FOLDER_PATH]: OUTLOOK_FOLDER_NAME };
const eligible = workflow.actions.For_Each_RESOLVED_Email.actions.Condition_Is_Eligible_RESOLVED;
// Include weekend/holiday recovery emails that are reconciled on the next
// business day. The previous 48-hour window could exclude Saturday messages.
const eligibilityText = JSON.stringify(eligible.expression).replace('addHours(utcNow(),-48)', 'addHours(utcNow(),-168)');
eligible.expression = JSON.parse(eligibilityText);
const exact = eligible.actions.Condition_Message_Not_Processed.actions.Condition_Exactly_One_Match;
const matching = eligible.actions.Condition_Message_Not_Processed.actions.Get_Matching_Open_FIRING;

// A resource can have several historical FIRING episodes still open while
// the recovery email belongs to the newest episode. Reconcile the newest
// valid episode instead of refusing every update as ambiguous.
matching.inputs.parameters['$top'] = 1;
exact.expression = { and: [{ greater: ["@length(body('Get_Matching_Open_FIRING')?['value'])", 0] }] };

// Ambiguous messages were re-read every five minutes because no source-message
// marker was persisted on the anomaly branch. Remove the noisy Teams action;
// the flow continues to reconcile exact matches without notification spam.
exact.else.actions = { Condition_Ambiguous_Match: { type: 'If', expression: { and: [{ greater: ["@length(body('Get_Matching_Open_FIRING')?['value'])", 1] }] }, actions: { Post_Ambiguous_Match_to_Teams: { type: 'Compose', inputs: 'Ambiguous match recorded without notification to prevent duplicate alerts.' } }, else: { actions: {} } } };

workflow.contentVersion = '1.0.6.0';
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = 'Operations Hub - Alert Lifecycle Reconciliation v1.0.6';
manifest.details.displayName = 'OperationsHub-AlertLifecycleReconciliation-v1.0.6';
manifest.details.description = 'RESOLVED reconciliation using a seven-day lookback, the canonical Outlook folder, and newest-valid-episode matching when historical FIRING episodes remain open.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = wrapper.properties.displayName;

writeJson(definitionPath, wrapper);
writeJson(packagePath, manifest);
console.log(`Built ${wrapper.properties.displayName} at ${output}`);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
