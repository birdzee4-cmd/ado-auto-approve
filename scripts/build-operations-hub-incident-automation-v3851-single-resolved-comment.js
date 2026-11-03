const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node scripts/build-operations-hub-incident-automation-v3851-single-resolved-comment.js <source-directory> <output-directory>');
if (!fs.existsSync(sourceRoot) || fs.existsSync(outputRoot)) throw new Error('Source must exist and output must not exist');
fs.cpSync(sourceRoot, outputRoot, { recursive: true });

const flowRoot = path.join(outputRoot, 'Microsoft.Flow', 'flows');
const assetId = read(path.join(flowRoot, 'manifest.json')).flowAssets.assetPaths[0];
const definitionPath = path.join(flowRoot, assetId, 'definition.json');
const manifestPath = path.join(outputRoot, 'manifest.json');
const wrapper = read(definitionPath);
const manifest = read(manifestPath);
const workflow = wrapper.properties.definition;
const resolved = workflow.actions.Scope_Process_Incident.actions.Condition_Message_Already_Processed.else.actions
  .Condition_Priority_is_P1_or_P2.actions.Condition_Is_RESOLVED.actions;
const matched = resolved.Condition_Matching_FIRING_Found.actions;
const tier1 = matched.Scope_Update_Tier1_after_RESOLVED.actions.Condition_Tier1_Work_Item_Available.actions;
const comment = tier1.Add_RESOLVED_comment_to_Tier1;
const related = tier1.Get_related_work_items_for_RESOLVED;
if (!comment || !related || !tier1.Record_RESOLVED_comment_failure || !tier1.Notify_RESOLVED_comment_failure) {
  throw new Error('Unexpected v3.8.50 RESOLVED comment structure');
}
if (!related.runAfter || !related.runAfter.Add_RESOLVED_comment_to_Tier1) {
  throw new Error('Related work item lookup does not depend on comment action');
}

// The Operations Hub reconciliation API is the sole writer of the RESOLVED
// Discussion comment. Keep the related work item check and auto-close path.
delete tier1.Add_RESOLVED_comment_to_Tier1;
delete tier1.Record_RESOLVED_comment_failure;
delete tier1.Notify_RESOLVED_comment_failure;
delete related.runAfter;

const version = '3.8.51';
const displayName = `Operations Hub - Incident Automation v${version}`;
wrapper.properties.displayName = displayName;
workflow.contentVersion = `${version}.0`;
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
manifest.details.displayName = displayName;
manifest.details.description = 'Send RESOLVED to Teams and update the matched incident; leave the one IT Support Discussion comment to the Operations Hub API while preserving related work item handling.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = displayName;
write(definitionPath, wrapper);
write(manifestPath, manifest);

function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
