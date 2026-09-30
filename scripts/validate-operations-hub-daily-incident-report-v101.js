const fs = require('fs');
const path = require('path');

const [packageRoot] = process.argv.slice(2);
if (!packageRoot) throw new Error('Usage: node validate-operations-hub-daily-incident-report-v101.js <package-directory>');
const root = path.resolve(packageRoot);
const manifest = readJson(path.join(root, 'manifest.json'));
const flowRoot = path.join(root, 'Microsoft.Flow', 'flows');
const flowManifest = readJson(path.join(flowRoot, 'manifest.json'));
const assetId = flowManifest.flowAssets.assetPaths[0];
const wrapper = readJson(path.join(flowRoot, assetId, 'definition.json'));
const workflow = wrapper.properties.definition;
const actions = workflow.actions;

check(wrapper.properties.displayName === 'Operations Hub - Daily Incident Report v1.0.1', 'flow display name is correct');
check(workflow.contentVersion === '1.0.1.0', 'content version is correct');
check(manifest.details.displayName === 'OperationsHub-DailyIncidentReport-v1.0.1', 'package display name is correct');
const recurrence = workflow.triggers.Recurrence.recurrence;
check(recurrence.frequency === 'Day' && recurrence.interval === 1, 'flow runs every calendar day');
check(recurrence.timeZone === 'SE Asia Standard Time', 'schedule uses Asia/Bangkok');
check(JSON.stringify(recurrence.schedule.hours) === '[8,16]' && recurrence.schedule.minutes[0] === 30, 'schedule runs at 08:30 and 16:30');
check(actions.Compose_Start_UTC.inputs.includes("T16:30:00") && actions.Compose_Start_UTC.inputs.includes("T08:30:00"), 'morning and afternoon start boundaries are explicit');
check(actions.Compose_End_UTC.inputs.includes("T08:30:00") && actions.Compose_End_UTC.inputs.includes("T16:30:00"), 'morning and afternoon end boundaries are explicit');
check(actions.Compose_Report_Message.inputs.includes("Compose_Start_UTC") && actions.Compose_Report_Message.inputs.includes("Compose_End_UTC"), 'message shows the actual report window');

const azure = actions.Post_Daily_Report_to_AzureAppServiceHigh5xxRateCritical;
const support = actions.Post_Daily_Report_to_IT_Support_Team_2025;
check(azure.inputs.parameters['body/recipient'] === '19:a0a8b701b02c469b94f493d1ed9903b9@thread.v2', 'AzureAppServiceHigh5xxRateCritical target is correct');
check(support.inputs.parameters['body/recipient'] === '19:658f8d4bfe6540a89613319286bc664b@thread.v2', 'IT_Support_Team_2025 target is correct');
check(JSON.stringify(azure.runAfter) === JSON.stringify(support.runAfter), 'both Teams deliveries run independently from the same completed report');
check(azure.inputs.retryPolicy.type === 'none' && support.inputs.retryPolicy.type === 'none', 'one delivery cannot create hidden duplicate retries');
check(Object.keys(wrapper.properties.connectionReferences).sort().join(',') === 'shared_sharepointonline,shared_teams-1', 'only SharePoint and Teams connections are required');
console.log('PASS: Daily Incident Report v1.0.1 package invariants are satisfied.');

function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`OK: ${message}`);
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
