const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node scripts/build-operations-hub-incident-automation-v3852-api-resolved-owner.js <source-directory> <output-directory>');
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
if (!matched.Scope_Update_Tier1_after_RESOLVED || !matched.Post_RESOLVED_to_Teams) {
  throw new Error('Unexpected v3.8.51 RESOLVED branch');
}

// The Operations Hub API owns the IT Support Discussion comment and Tier 1
// closure. Leaving either operation in this Flow races the API reconciliation.
delete matched.Scope_Update_Tier1_after_RESOLVED;

const version = '3.8.52';
const displayName = `Operations Hub - Incident Automation v${version}`;
wrapper.properties.displayName = displayName;
workflow.contentVersion = `${version}.0`;
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
manifest.details.displayName = displayName;
manifest.details.description = 'Keep RESOLVED incident update and Teams notification in this Flow; the Operations Hub API alone writes the IT Support Discussion comment and closes Tier 1.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = displayName;
write(definitionPath, wrapper);
write(manifestPath, manifest);

function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
