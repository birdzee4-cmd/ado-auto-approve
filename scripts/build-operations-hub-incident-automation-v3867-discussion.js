const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-incident-automation-v3867-discussion.js <source-directory> <output-directory>');
if (!fs.existsSync(sourceRoot) || fs.existsSync(outputRoot)) throw new Error('Source must exist and output must be new');
fs.cpSync(sourceRoot, outputRoot, { recursive: true });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const clone = value => JSON.parse(JSON.stringify(value));
const flowRoot = path.join(outputRoot, 'Microsoft.Flow', 'flows');
const fm = read(path.join(flowRoot, 'manifest.json'));
const assetId = fm.flowAssets.assetPaths[0];
const definitionPath = path.join(flowRoot, assetId, 'definition.json');
const manifestPath = path.join(outputRoot, 'manifest.json');
const wrapper = read(definitionPath);
const manifest = read(manifestPath);
const workflow = wrapper.properties.definition;

function findAction(actions, name) {
  if (!actions || typeof actions !== 'object') return null;
  if (actions[name]) return actions[name];
  for (const action of Object.values(actions)) {
    if (!action || typeof action !== 'object') continue;
    const found = findAction(action.actions, name) || findAction(action.else && action.else.actions, name);
    if (found) return found;
  }
  return null;
}

const newP1 = findAction(workflow.actions, 'Post_New_P1_Alert_to_Test_Monitor');
const repeatAction = findAction(workflow.actions, 'Post_repeated_FIRING_to_Teams');
const repeatBranch = findAction(workflow.actions, 'Condition_FIRING_Incident_Exists');
if (!newP1 || !repeatAction || !repeatBranch?.actions || !repeatBranch.else?.actions) throw new Error('Expected v3.8.64/v3.8.66 actions were not found');

const discussionBody = "@string(createArray(setProperty(setProperty(setProperty(json('{}'),'op','test'),'path','/rev'),'value',int(body('Create_Azure_DevOps_work_item')?['rev'])),setProperty(setProperty(setProperty(json('{}'),'op','add'),'path','/fields/System.History'),'value','<p>P1 alert notification was successfully posted to the Microsoft Teams group chat “Support X PMOs”.</p>')))";
const discussion = {
  type: 'OpenApiConnection',
  runAfter: { Post_New_P1_Alert_to_Test_Monitor: ['Succeeded'] },
  inputs: {
    parameters: {
      account: 'buzzebees',
      'parameters/Method': 'PATCH',
      'parameters/Uri': "@concat('Buzzebees/_apis/wit/workitems/',string(body('Create_Azure_DevOps_work_item')?['id']),'?api-version=7.1')",
      'parameters/Headers': { 'Content-Type': 'application/json-patch+json' },
      'parameters/Body': discussionBody,
      'parameters/IsBase64': false
    },
    host: {
      apiId: '/providers/Microsoft.PowerApps/apis/shared_visualstudioteamservices',
      connectionName: 'shared_visualstudioteamservices',
      operationId: 'HttpRequest'
    },
    retryPolicy: { type: 'exponential', count: 3, interval: 'PT10S', minimumInterval: 'PT5S', maximumInterval: 'PT1M' },
    authentication: "@parameters('$authentication')"
  }
};

newP1.inputs.parameters.poster = 'User';
repeatAction.inputs.parameters.poster = 'User';
repeatBranch.else.actions.Post_P1_Alert_Discussion_to_VSTS = discussion;

const version = '3.8.68';
const displayName = `Operations Hub - Incident Automation v${version}`;
workflow.contentVersion = `${version}.0`;
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = displayName;
manifest.details.displayName = `OperationsHub-IncidentAutomationv${version}-Discussion-Import`;
manifest.details.description = 'Adds a VSTS Discussion entry after the New P1 Teams notification succeeds.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].creationType = 'Existing, New, Update';
manifest.resources[assetId].details.displayName = displayName;
write(definitionPath, wrapper);
write(manifestPath, manifest);
console.log(JSON.stringify({ version, outputRoot, action: 'Post_P1_Alert_Discussion_to_VSTS' }));
