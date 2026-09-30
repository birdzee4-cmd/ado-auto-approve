const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-v3817-resolved-comments-api.js <v3.8.11-or-later-directory> <output-directory>');
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

const resolvedActions = workflow.actions.Scope_Process_Incident.actions
  .Condition_Message_Already_Processed.else.actions
  .Condition_Priority_is_P1_or_P2.actions
  .Condition_Is_RESOLVED.actions
  .Condition_Matching_FIRING_Found.actions;
const scope = resolvedActions.Scope_Update_Tier1_after_RESOLVED;
if (!scope) throw new Error('Scope_Update_Tier1_after_RESOLVED was not found');
const resolvedIncidentUpdate = resolvedActions.Update_matching_incident_RESOLVED;
if (!resolvedIncidentUpdate) throw new Error('Update_matching_incident_RESOLVED was not found');
const resolvedIncidentParameters = resolvedIncidentUpdate.inputs.parameters;
const tier1Actions = scope.actions.Condition_Tier1_Work_Item_Available.actions;
const oldComment = tier1Actions.Add_RESOLVED_comment_to_Tier1;
if (!oldComment) throw new Error('Add_RESOLVED_comment_to_Tier1 was not found');

const commentHtml = oldComment.inputs.parameters['workItem/dynamicFields/System.History'];
if (!commentHtml) throw new Error('The existing RESOLVED comment body was not found');
const commentMarker = "@{concat('<!-- operations-hub-resolved:',first(body('Get_latest_open_FIRING')?['value'])?['IncidentId'],' -->')}";

tier1Actions.Add_RESOLVED_comment_to_Tier1 = {
  type: 'OpenApiConnection',
  inputs: {
    parameters: {
      account: 'buzzebees',
      'parameters/Method': 'POST',
      'parameters/Uri': "@concat('Buzzebees/_apis/wit/workItems/',string(int(first(body('Get_latest_open_FIRING')?['value'])?['AdoWorkItemId'])),'/comments?format=html&api-version=7.1-preview.4')",
      'parameters/Headers': { 'Content-Type': 'application/json' },
      'parameters/Body': JSON.stringify({ text: `${commentMarker}${commentHtml}` }),
      'parameters/IsBase64': false
    },
    host: {
      apiId: '/providers/Microsoft.PowerApps/apis/shared_visualstudioteamservices',
      connectionName: 'shared_visualstudioteamservices',
      operationId: 'HttpRequest'
    },
    authentication: "@parameters('$authentication')"
  }
};

tier1Actions.Record_RESOLVED_comment_failure = {
  type: 'OpenApiConnection',
  runAfter: { Add_RESOLVED_comment_to_Tier1: ['Failed', 'TimedOut'] },
  inputs: {
    parameters: {
      ...resolvedIncidentParameters,
      'item/ErrorDetail': "@concat('RESOLVED was recorded, but the Azure DevOps Comments API failed for Work Item #',string(first(body('Get_latest_open_FIRING')?['value'])?['AdoWorkItemId']),'. Flow run: ',workflow()?['run']?['name'])",
      'item/LastSyncedAt': '@utcNow()'
    },
    host: {
      apiId: '/providers/Microsoft.PowerApps/apis/shared_sharepointonline',
      connectionName: 'shared_sharepointonline',
      operationId: 'PatchItem'
    },
    authentication: "@parameters('$authentication')"
  }
};

tier1Actions.Notify_RESOLVED_comment_failure = {
  type: 'OpenApiConnection',
  runAfter: { Record_RESOLVED_comment_failure: ['Succeeded'] },
  inputs: {
    parameters: {
      poster: 'Flow bot',
      location: 'Group chat',
      'body/recipient': '19:a0a8b701b02c469b94f493d1ed9903b9@thread.v2',
      'body/messageBody': "<p><b>⚠️ RESOLVED comment failed</b><br>Incident @{first(body('Get_latest_open_FIRING')?['value'])?['IncidentId']} was marked RESOLVED, but the Azure DevOps Comments API failed for Work Item #@{first(body('Get_latest_open_FIRING')?['value'])?['AdoWorkItemId']}.<br>Flow run: @{workflow()?['run']?['name']}</p>"
    },
    host: {
      apiId: '/providers/Microsoft.PowerApps/apis/shared_teams',
      connectionName: 'shared_teams-1',
      operationId: 'PostMessageToConversation'
    },
    authentication: "@parameters('$authentication')"
  }
};

workflow.contentVersion = '3.8.17.0';
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = 'Operations Hub - Incident Automation v3.8.17';
manifest.details.displayName = 'OperationsHub-IncidentAutomation-v3.8.17';
manifest.details.description = 'RESOLVED discussion hotfix: post Tier 1 comments through the Azure DevOps Comments API, retain independent lifecycle processing, and surface comment failures in SharePoint and Teams.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = wrapper.properties.displayName;

writeJson(definitionPath, wrapper);
writeJson(packagePath, manifest);
console.log(`Built ${wrapper.properties.displayName} at ${output}`);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
