const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node scripts/build-operations-hub-alert-lifecycle-reconciliation-resolved-teams.js <source-directory> <output-directory>');
const source = path.resolve(sourceRoot);
const output = path.resolve(outputRoot);
if (!fs.existsSync(source) || fs.existsSync(output)) throw new Error('Source must exist and output must not exist');
fs.cpSync(source, output, { recursive: true });

const flowRoot = path.join(output, 'Microsoft.Flow', 'flows');
const flowManifest = readJson(path.join(flowRoot, 'manifest.json'));
const assetId = flowManifest.flowAssets.assetPaths[0];
const definitionPath = path.join(flowRoot, assetId, 'definition.json');
const packagePath = path.join(output, 'manifest.json');
const wrapper = readJson(definitionPath);
const manifest = readJson(packagePath);
const workflow = wrapper.properties.definition;
const matched = workflow.actions.For_Each_RESOLVED_Email.actions.Condition_Is_Eligible_RESOLVED.actions
  .Condition_Message_Not_Processed.actions.Condition_Exactly_One_Match.actions;
if (!matched.Update_Matching_Incident_RESOLVED || matched.Post_RESOLVED_to_Teams) throw new Error('Unexpected source flow shape');

const incident = "first(body('Get_Matching_Open_FIRING')?['value'])";
const value = field => `@{coalesce(${incident}?['${field}'],'-')}`;
const priority = `@{coalesce(${incident}?['Priority']?['Value'],${incident}?['Priority'],'P1')}`;
const firstSeen = `@{formatDateTime(convertTimeZone(${incident}?['FirstSeenAt'],'UTC','SE Asia Standard Time'),'dd/MM/yyyy HH:mm')}`;
const resolvedAt = "@{formatDateTime(convertTimeZone(outputs('Compose_Resolved_At'),'UTC','SE Asia Standard Time'),'dd/MM/yyyy HH:mm')}";
const body = `<p>✅ <b>RESOLVED</b><br>` +
  `<b>Alert:</b> @{outputs('Compose_Alert_Name')}<br>` +
  `<b>Severity:</b> ${value('Severity')} / ${priority}<br><br>` +
  `<b>📌 Resource</b><br>` +
  `• Resource: @{outputs('Compose_Resource')}<br>` +
  `• Subscription: ${value('Subscription')}<br>` +
  `• Resource Group: ${value('ResourceGroup')}<br>` +
  `• Plan: ${value('AppServicePlan')}<br>` +
  `• Default Host: ${value('DefaultHost')}<br><br>` +
  `<b>First Seen:</b> ${firstSeen} น.<br>` +
  `<b>Resolved At:</b> ${resolvedAt} น.</p>`;

matched.Post_RESOLVED_to_Teams = {
  type: 'OpenApiConnection',
  runAfter: { Update_Matching_Incident_RESOLVED: ['Succeeded'] },
  inputs: {
    parameters: {
      poster: 'Flow bot',
      location: 'Group chat',
      'body/recipient': '19:a0a8b701b02c469b94f493d1ed9903b9@thread.v2',
      'body/messageBody': body,
    },
    host: { apiId: '/providers/Microsoft.PowerApps/apis/shared_teams', connectionName: 'shared_teams-1', operationId: 'PostMessageToConversation' },
    authentication: "@parameters('$authentication')",
  },
};

const version = '1.0.10';
const displayName = `Operations Hub - Alert Lifecycle Reconciliation v${version} Resolved Teams`;
workflow.contentVersion = `${version}.0`;
wrapper.properties.displayName = displayName;
manifest.details.displayName = displayName;
manifest.details.description = 'Reconcile RESOLVED incidents and post the detailed RESOLVED notification to the Operations Hub Teams chat after a successful update.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = displayName;
writeJson(definitionPath, wrapper);
writeJson(packagePath, manifest);
console.log(`Built ${displayName} at ${output}`);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
