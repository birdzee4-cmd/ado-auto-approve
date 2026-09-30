const fs = require('fs');
const path = require('path');

const [packageRoot] = process.argv.slice(2);
if (!packageRoot) throw new Error('Usage: node validate-operations-hub-daily-incident-report-v100.js <package-directory>');
const root = path.resolve(packageRoot);
const manifest = readJson(path.join(root, 'manifest.json'));
const flowRoot = path.join(root, 'Microsoft.Flow', 'flows');
const flowManifest = readJson(path.join(flowRoot, 'manifest.json'));
const assetPaths = flowManifest.flowAssets?.assetPaths;
check(Array.isArray(assetPaths) && assetPaths.length === 1, 'package contains exactly one flow');
const assetId = assetPaths[0];
const wrapper = readJson(path.join(flowRoot, assetId, 'definition.json'));
const workflow = wrapper.properties.definition;

check(wrapper.properties.displayName === 'Operations Hub - Daily Incident Report v1.0.0', 'flow display name is correct');
check(workflow.contentVersion === '1.0.0.0', 'content version is correct');
check(manifest.details.displayName === 'OperationsHub-DailyIncidentReport-v1.0.0', 'package display name is correct');
const recurrence = workflow.triggers.Recurrence.recurrence;
check(recurrence.frequency === 'Day' && recurrence.interval === 1, 'flow runs every calendar day');
check(recurrence.timeZone === 'SE Asia Standard Time', 'schedule uses Asia/Bangkok time zone');
check(recurrence.schedule.hours[0] === 16 && recurrence.schedule.minutes[0] === 30, 'schedule is 16:30');

const actions = workflow.actions;
check(actions.Get_Todays_Incidents.inputs.parameters.$filter.includes('Created ge'), 'today query has a lower date boundary');
check(actions.Get_Todays_Incidents.inputs.parameters.$filter.includes('Created lt'), 'today query has an upper date boundary');
check(actions.Get_Open_P1_Incidents.inputs.parameters.$filter === "Priority eq 'P1' and WorkflowStatus ne 'CLOSED'", 'open P1 queue is included');
check(actions.Post_Daily_Report_to_Teams.inputs.parameters['body/recipient'] === '19:a0a8b701b02c469b94f493d1ed9903b9@thread.v2', 'report targets the existing Teams group chat');
check(actions.Compose_Report_Message.inputs.includes('00:00–16:30'), 'report window is stated');
check(actions.Compose_Report_Message.inputs.includes('OpenRows'), 'open queue detail is included');
check(actions.Compose_Report_Message.inputs.includes('Operations Hub'), 'Operations Hub link is included');
check(Object.keys(wrapper.properties.connectionReferences).sort().join(',') === 'shared_sharepointonline,shared_teams-1', 'only SharePoint and Teams connections are required');
check(Object.keys(manifest.resources).length === 5, 'package contains flow plus two connector and two connection resources');
console.log('PASS: Daily Incident Report v1.0.0 package invariants are satisfied.');

function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`OK: ${message}`);
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
