const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || '');
if (!root || !fs.existsSync(root)) throw new Error('Usage: node validate-operations-hub-v3813-resolved-vsts.js <package-directory>');
const flowRoot = path.join(root, 'Microsoft.Flow', 'flows');
const flowManifest = JSON.parse(fs.readFileSync(path.join(flowRoot, 'manifest.json'), 'utf8'));
const assetId = flowManifest.flowAssets.assetPaths[0];
const wrapper = JSON.parse(fs.readFileSync(path.join(flowRoot, assetId, 'definition.json'), 'utf8'));
const workflow = wrapper.properties.definition;
const resolved = workflow.actions.Scope_Process_Incident.actions.Condition_Message_Already_Processed.else.actions
  .Condition_Priority_is_P1_or_P2.actions.Condition_Is_RESOLVED.actions
  .Condition_Matching_FIRING_Found.actions;
const scope = resolved.Scope_Update_Tier1_after_RESOLVED;
assert(wrapper.properties.displayName.endsWith('v3.8.13'), 'display name');
assert(workflow.contentVersion === '3.8.13.0', 'content version');
assert(scope && scope.type === 'Scope', 'RESOLVED Tier 1 scope');
const actions = scope.actions.Condition_Tier1_Work_Item_Available.actions;
assert(actions.Add_RESOLVED_comment_to_Tier1.inputs.host.operationId === 'CreateWorkItemCommentAsync', 'native Create work item comment operation');
assert(actions.Add_RESOLVED_comment_to_Tier1.inputs.parameters.text.includes('MONITORING ALERT RESOLVED'), 'Tier 1 comment text');
assert(actions.Add_RESOLVED_comment_to_Tier1.inputs.parameters.format === 'Html', 'Tier 1 comment format');
assert(actions.Add_RESOLVED_comment_to_Tier1.inputs.parameters.workItemId, 'Tier 1 Work Item ID');
assert(actions.Get_related_work_items_for_RESOLVED.inputs.parameters.table === 'OperationsHubWorkItems', 'related list lookup');
assert(actions.Filter_open_related_work_items.type === 'Query', 'open related filter');
assert(actions.Condition_All_Related_Work_Items_Closed.actions.Close_Tier1_after_RESOLVED.inputs.parameters['workItem/dynamicFields/System.State'] === 'Closed', 'conditional Tier 1 close');
assert(resolved.Post_RESOLVED_to_Teams.runAfter.Scope_Update_Tier1_after_RESOLVED.includes('Failed'), 'Teams failure isolation');
assert(!JSON.stringify(workflow).includes('workItem/dynamicFields/System.History'), 'unsupported History parameter removed');
assert(!JSON.stringify(workflow).includes('workItem/otherFields'), 'unsupported Other Fields parameter removed');
console.log('Validated Operations Hub Incident Automation v3.8.13');

function assert(value, label) { if (!value) throw new Error(`Validation failed: ${label}`); }
