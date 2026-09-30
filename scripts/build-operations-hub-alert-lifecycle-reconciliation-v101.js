const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-alert-lifecycle-reconciliation-v101.js <v1.0.0-directory> <output-directory>');
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

const eligible = workflow.actions.For_Each_RESOLVED_Email.actions.Condition_Is_Eligible_RESOLVED;
eligible.expression.and.push({
  or: [
    { contains: ["@toUpper(outputs('Compose_Email_Body'))", 'CRITICAL / P1'] },
    { contains: ["@toUpper(outputs('Compose_Email_Subject'))", '[CRITICAL]'] }
  ]
});

const exact = eligible.actions.Condition_Message_Not_Processed.actions.Condition_Exactly_One_Match;
const teamsAction = exact.else.actions.Post_Reconciliation_Anomaly_to_Teams;
teamsAction.inputs.parameters['body/messageBody'] = "<p><b>⚠️ ALERT LIFECYCLE RECONCILIATION</b><br><b>Result:</b> AMBIGUOUS MATCH<br><b>Alert:</b> @{outputs('Compose_Alert_Name')}<br><b>Resource:</b> @{outputs('Compose_Resource')}<br><b>Resolved at:</b> @{outputs('Compose_Resolved_At')}<br><b>Matches:</b> @{length(body('Get_Matching_Open_FIRING')?['value'])}<br>No incident was changed. Please review Operations Hub.</p>";
exact.else.actions = {
  Condition_Ambiguous_Match: {
    type: 'If',
    expression: { and: [{ greater: ["@length(body('Get_Matching_Open_FIRING')?['value'])", 1] }] },
    actions: { Post_Ambiguous_Match_to_Teams: teamsAction },
    else: { actions: {} }
  }
};

workflow.contentVersion = '1.0.1.0';
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = 'Operations Hub - Alert Lifecycle Reconciliation v1.0.1';
manifest.details.displayName = 'OperationsHub-AlertLifecycleReconciliation-v1.0.1';
manifest.details.description = 'Hotfix: reconcile only CRITICAL/P1 RESOLVED messages, suppress expected NO MATCH notifications, and notify Teams only for ambiguous multiple matches.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = wrapper.properties.displayName;

writeJson(definitionPath, wrapper);
writeJson(packagePath, manifest);
console.log(`Built ${wrapper.properties.displayName} at ${output}`);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
