const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-incident-automation-v3865-occurrence-messages.js <source-directory> <output-directory>');
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

const opening = occurrence => `@{if(equals(mod(sub(int(${occurrence}),1),5),0),'แจ้งเหตุ P1 ครับ',if(equals(mod(sub(int(${occurrence}),1),5),1),'ขอแจ้งเหตุการณ์ P1 ครับ',if(equals(mod(sub(int(${occurrence}),1),5),2),'Alert P1 กำลังตรวจสอบครับ',if(equals(mod(sub(int(${occurrence}),1),5),3),'พบ Alert P1 กำลังดำเนินการตรวจสอบครับ','ตรวจพบ Alert P1 ครับ'))))}`;
const newMessage = opening("body('Create_FIRING_incident')?['OccurrenceCount']") + '<br><br><b>Alert:</b> @{outputs(\'Compose_AlertName\')}<br><b>Resource:</b> @{outputs(\'Compose_Resource\')}<br><b>Environment:</b> @{outputs(\'Compose_Environment\')}<br><b>Platform:</b> @{outputs(\'Compose_Platform\')}<br><b>First seen (Asia/Bangkok):</b> @{outputs(\'Compose_FirstSeenDisplay\')}<br><b>Case ID:</b> INC-@{formatDateTime(outputs(\'Compose_FirstSeenAt\'),\'yyyy\')}-@{formatNumber(int(body(\'Create_FIRING_incident\')?[\'ID\']),\'000000\')}<br><br>กำลังตรวจสอบเหตุการณ์นี้ครับ';
const repeatedMessage = opening("add(int(coalesce(first(body('Get_items_by_IncidentId')?['value'])?['OccurrenceCount'],1)),1)") + '<br><br><b>Alert:</b> @{outputs(\'Compose_AlertName\')}<br><b>Resource:</b> @{outputs(\'Compose_Resource\')}<br><b>Environment:</b> @{outputs(\'Compose_Environment\')}<br><b>Platform:</b> @{outputs(\'Compose_Platform\')}<br><b>Incident ID:</b> @{outputs(\'Compose_IncidentId\')}<br><br>เหตุการณ์เดิมยังพบต่อเนื่อง กำลังติดตามอยู่ครับ';

const newAction = findAction(workflow.actions, 'Post_New_P1_Alert_to_Test_Monitor');
const repeatAction = findAction(workflow.actions, 'Post_repeated_FIRING_to_Teams');
const repeatBranch = findAction(workflow.actions, 'Condition_FIRING_Incident_Exists');
if (!newAction || !repeatAction || !repeatBranch?.actions || !repeatBranch.else?.actions) throw new Error('Expected v3.8.64 Test Monitor and repeated FIRING actions were not found');

newAction.inputs.parameters.poster = 'User';
newAction.inputs.parameters['body/messageBody'] = `<p>${newMessage}</p>`;

const repeated = clone(repeatAction);
repeated.inputs.parameters.poster = 'User';
repeated.inputs.parameters['body/recipient'] = newAction.inputs.parameters['body/recipient'];
repeated.inputs.parameters['body/messageBody'] = `<p>${repeatedMessage}</p>`;
repeated.runAfter = { Update_repeated_FIRING: ['Succeeded'] };
// The repeated notification belongs to the same true branch as Update_repeated_FIRING.
// Putting it under else makes runAfter cross condition branches and Power Automate rejects the import.
repeatBranch.actions.Post_Repeated_P1_Alert_to_Test_Monitor = repeated;

const version = '3.8.66';
const displayName = `Operations Hub - Incident Automation v${version}`;
workflow.contentVersion = `${version}.0`;
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = displayName;
manifest.details.displayName = `OperationsHub-IncidentAutomationv${version}-OccurrenceMessages-Import`;
manifest.details.description = 'Adds deterministic five-message rotation by Incident Occurrence for New and repeated P1 notifications, preserving the v3.8.64 Export behavior and User sender.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].creationType = 'Existing, New, Update';
manifest.resources[assetId].details.displayName = displayName;
write(definitionPath, wrapper);
write(manifestPath, manifest);
console.log(JSON.stringify({ version, outputRoot, actions: ['Post_New_P1_Alert_to_Test_Monitor', 'Post_Repeated_P1_Alert_to_Test_Monitor'] }));
