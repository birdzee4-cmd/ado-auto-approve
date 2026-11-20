const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-incident-automation-v3863-test-monitor.js <source-directory> <output-directory>');
if (!fs.existsSync(sourceRoot) || fs.existsSync(outputRoot)) throw new Error('Source must exist and output must be new');

fs.cpSync(sourceRoot, outputRoot, { recursive: true });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const clone = value => JSON.parse(JSON.stringify(value));
const placeholder = '__REPLACE_WITH_TEST_MONITOR_SEND_MESSAGE_CHAT__';

const flowRoot = path.join(outputRoot, 'Microsoft.Flow', 'flows');
const flowManifestPath = path.join(flowRoot, 'manifest.json');
const flowManifest = read(flowManifestPath);
const assetId = flowManifest.flowAssets.assetPaths[0];
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

function addSibling(actions, sourceName, targetName, heading, message) {
  const source = actions[sourceName];
  if (!source) throw new Error(`Action ${sourceName} not found in expected branch`);
  if (actions[targetName]) throw new Error(`Action ${targetName} already exists`);
  const target = clone(source);
  target.inputs.parameters.poster = 'User';
  target.inputs.parameters['body/recipient'] = placeholder;
  target.inputs.parameters['body/messageBody'] = message;
  target.metadata = target.metadata || {};
  target.metadata.operationMetadataId = undefined;
  delete target.metadata.operationMetadataId;
  actions[targetName] = target;
  return heading;
}

const resolved = findAction(workflow.actions, 'Post_RESOLVED_to_Teams');
const firing = findAction(workflow.actions, 'Post_FIRING_to_Teams');
if (!resolved || !firing) throw new Error('Expected New FIRING and RESOLVED Teams actions were not found');

const version = process.env.PACKAGE_VERSION || '3.8.63';
const displayName = `Operations Hub - Incident Automation v${version}`;
const newAlertMessage = '<p><b>🚨 New P1 Alert</b><br><b>Alert:</b> @{outputs(\'Compose_AlertName\')}<br><b>Resource:</b> @{outputs(\'Compose_Resource\')}<br><b>Environment:</b> @{outputs(\'Compose_Environment\')}<br><b>Platform:</b> @{outputs(\'Compose_Platform\')}<br><b>First seen (Asia/Bangkok):</b> @{outputs(\'Compose_FirstSeenDisplay\')}<br><b>Case ID:</b> INC-@{formatDateTime(outputs(\'Compose_FirstSeenAt\'),\'yyyy\')}-@{formatNumber(int(body(\'Create_FIRING_incident\')?[\'ID\']),\'000000\')}<br><br>กำลังตรวจสอบเหตุการณ์นี้ครับ</p>';
const resolvedMessage = '<p><b>✅ RESOLVED</b><br><b>Case ID:</b> INC-@{formatDateTime(first(body(\'Get_latest_open_FIRING\')?[\'value\'])?[\'FirstSeenAt\'],\'yyyy\')}-@{formatNumber(int(first(body(\'Get_latest_open_FIRING\')?[\'value\'])?[\'ID\']),\'000000\')}<br><b>Alert:</b> @{outputs(\'Compose_AlertName\')}<br><b>Resource:</b> @{outputs(\'Compose_Resource\')}<br><b>Environment:</b> @{outputs(\'Compose_Environment\')}<br><b>Platform:</b> @{outputs(\'Compose_Platform\')}<br><b>First seen (Asia/Bangkok):</b> @{outputs(\'Compose_FirstSeenDisplay\')}<br><b>Resolved at (Asia/Bangkok):</b> @{outputs(\'Compose_ResolvedAtDisplay\')}<br><br>เหตุการณ์ได้รับการแก้ไขแล้วครับ</p>';

const firingActions = findAction(workflow.actions, 'Condition_FIRING_Incident_Exists');
if (!firingActions || !firingActions.else || !firingActions.else.actions) throw new Error('New FIRING branch not found');
addSibling(firingActions.else.actions, 'Post_FIRING_to_Teams', 'Post_New_P1_Alert_to_Test_Monitor', 'New P1 Alert', newAlertMessage);

const resolvedActions = findAction(workflow.actions, 'Condition_Matching_FIRING_Found');
if (!resolvedActions || !resolvedActions.actions) throw new Error('RESOLVED branch not found');
addSibling(resolvedActions.actions, 'Post_RESOLVED_to_Teams', 'Post_RESOLVED_to_Test_Monitor', 'Resolved notification', resolvedMessage);

workflow.contentVersion = `${version}.0`;
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = displayName;
manifest.details.displayName = `OperationsHub-IncidentAutomationv${version}-TestMonitor-Import`;
manifest.details.description = 'Adds plain-text New P1 Alert and RESOLVED notifications to the Test Monitor Send Message group chat while preserving v3.8.62 processing and the existing Teams destination.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].creationType = 'Existing, New, Update';
manifest.resources[assetId].details.displayName = displayName;

write(definitionPath, wrapper);
write(manifestPath, manifest);
console.log(JSON.stringify({ version, outputRoot, placeholder, added: ['Post_New_P1_Alert_to_Test_Monitor', 'Post_RESOLVED_to_Test_Monitor'] }));
