const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || 'tmp-v3817-build');
const flowManifest = readJson(path.join(root, 'Microsoft.Flow', 'flows', 'manifest.json'));
const assetId = flowManifest.flowAssets.assetPaths[0];
const wrapper = readJson(path.join(root, 'Microsoft.Flow', 'flows', assetId, 'definition.json'));
const workflow = wrapper.properties.definition;
const text = JSON.stringify(workflow);

const resolvedActions = workflow.actions.Scope_Process_Incident.actions
  .Condition_Message_Already_Processed.else.actions
  .Condition_Priority_is_P1_or_P2.actions
  .Condition_Is_RESOLVED.actions
  .Condition_Matching_FIRING_Found.actions;
const tier1Actions = resolvedActions.Scope_Update_Tier1_after_RESOLVED.actions
  .Condition_Tier1_Work_Item_Available.actions;
const comment = tier1Actions.Add_RESOLVED_comment_to_Tier1;
const parameters = comment && comment.inputs && comment.inputs.parameters || {};

const checks = [
  ['v3.8.17 display name', wrapper.properties.displayName.endsWith('v3.8.17')],
  ['v3.8.17 content version', workflow.contentVersion === '3.8.17.0'],
  ['comment uses Azure DevOps HttpRequest', comment && comment.inputs.host.operationId === 'HttpRequest'],
  ['comment uses connector parameter namespace', !Object.hasOwn(parameters, 'Method') && Object.hasOwn(parameters, 'parameters/Method')],
  ['comment uses POST', parameters['parameters/Method'] === 'POST'],
  ['comment targets Comments API', String(parameters['parameters/Uri']).includes('/comments?format=html&api-version=7.1-preview.4')],
  ['comment request is JSON', parameters['parameters/Headers'] && parameters['parameters/Headers']['Content-Type'] === 'application/json'],
  ['comment body is serialized JSON', typeof parameters['parameters/Body'] === 'string' && JSON.parse(parameters['parameters/Body']).text],
  ['comment marker is retained', String(parameters['parameters/Body']).includes('operations-hub-resolved:')],
  ['legacy System.History update removed', !text.includes('workItem/dynamicFields/System.History')],
  ['comment failure recorded', Boolean(tier1Actions.Record_RESOLVED_comment_failure)],
  ['comment failure record includes required IncidentId', Boolean(tier1Actions.Record_RESOLVED_comment_failure && tier1Actions.Record_RESOLVED_comment_failure.inputs.parameters['item/IncidentId'])],
  ['comment failure record includes required SourceMessageId', Boolean(tier1Actions.Record_RESOLVED_comment_failure && tier1Actions.Record_RESOLVED_comment_failure.inputs.parameters['item/SourceMessageId'])],
  ['comment failure uses complete RESOLVED update schema', Object.keys(resolvedActions.Update_matching_incident_RESOLVED.inputs.parameters).every(key => Object.hasOwn(tier1Actions.Record_RESOLVED_comment_failure.inputs.parameters, key))],
  ['comment failure notified', Boolean(tier1Actions.Notify_RESOLVED_comment_failure)],
  ['related-item processing survives comment failure', ['Succeeded','Failed','TimedOut'].every(s => tier1Actions.Get_related_work_items_for_RESOLVED.runAfter.Add_RESOLVED_comment_to_Tier1.includes(s))],
  ['Tier 1 close retained', text.includes('Close_Tier1_after_RESOLVED') && text.includes('Record_Tier1_Closed_after_RESOLVED')]
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  failed ||= !ok;
}
if (failed) process.exit(1);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
