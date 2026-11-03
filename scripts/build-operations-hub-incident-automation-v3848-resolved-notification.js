const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node scripts/build-operations-hub-incident-automation-v3848-resolved-notification.js <source-directory> <output-directory>');
if (!fs.existsSync(sourceRoot) || fs.existsSync(outputRoot)) throw new Error('Source must exist and output must not exist');
fs.cpSync(sourceRoot, outputRoot, { recursive: true });

const flowRoot = path.join(outputRoot, 'Microsoft.Flow', 'flows');
const assetId = read(path.join(flowRoot, 'manifest.json')).flowAssets.assetPaths[0];
const definitionPath = path.join(flowRoot, assetId, 'definition.json');
const manifestPath = path.join(outputRoot, 'manifest.json');
const wrapper = read(definitionPath);
const manifest = read(manifestPath);
const workflow = wrapper.properties.definition;
const matched = workflow.actions.Scope_Process_Incident.actions.Condition_Message_Already_Processed.else.actions
  .Condition_Priority_is_P1_or_P2.actions.Condition_Is_RESOLVED.actions.Condition_Matching_FIRING_Found.actions;
const post = matched.Post_RESOLVED_to_Teams;
const update = matched.Update_matching_incident_RESOLVED;
if (!post || !update || !matched.Scope_Update_Tier1_after_RESOLVED) throw new Error('Unexpected RESOLVED branch structure');
if (JSON.stringify(post.runAfter) !== JSON.stringify({ Scope_Update_Tier1_after_RESOLVED: ['Succeeded', 'Failed', 'TimedOut', 'Skipped'] })) {
  throw new Error('RESOLVED notification dependency changed; inspect source package');
}
post.runAfter = { Update_matching_incident_RESOLVED: ['Succeeded'] };

const version = '3.8.48';
const displayName = `Operations Hub - Incident Automation v${version}`;
wrapper.properties.displayName = displayName;
workflow.contentVersion = `${version}.0`;
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
manifest.details.displayName = displayName;
manifest.details.description = 'Send RESOLVED to Teams immediately after recording the matched incident; Azure DevOps follow-up continues independently.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = displayName;
write(definitionPath, wrapper);
write(manifestPath, manifest);

function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
