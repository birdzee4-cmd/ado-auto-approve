const fs = require('fs');
const path = require('path');

const [dailyRoot, incidentRoot] = process.argv.slice(2);
if (!dailyRoot || !incidentRoot) throw new Error('Usage: node validate-power-automate-format-number-hotfixes.js <daily-v1.0.2> <incident-v3.8.10>');
const daily = loadWorkflow(dailyRoot);
const incident = loadWorkflow(incidentRoot);

check(daily.wrapper.properties.displayName === 'Operations Hub - Daily Incident Report v1.0.2', 'daily display name is v1.0.2');
check(daily.workflow.contentVersion === '1.0.2.0', 'daily content version is v1.0.2');
const dailyText = JSON.stringify(daily.workflow);
check(!dailyText.includes('padLeft('), 'daily flow contains no unsupported padLeft expression');
check(dailyText.includes("formatNumber(int(items('For_each_Today_Incident')?['ID']),'000000')"), 'today rows use formatNumber');
check(dailyText.includes("formatNumber(int(items('For_each_Open_Incident')?['ID']),'000000')"), 'open rows use formatNumber');
check(dailyText.includes('19:658f8d4bfe6540a89613319286bc664b@thread.v2'), 'IT Support chat remains configured');
check(dailyText.includes('19:a0a8b701b02c469b94f493d1ed9903b9@thread.v2'), 'Azure App Service chat remains configured');

check(incident.wrapper.properties.displayName === 'Operations Hub - Incident Automation v3.8.10', 'incident display name is v3.8.10');
check(incident.workflow.contentVersion === '3.8.10.0', 'incident content version is v3.8.10');
const incidentText = JSON.stringify(incident.workflow);
check(!incidentText.includes('padLeft('), 'incident flow contains no unsupported padLeft expression');
check(incidentText.includes("formatNumber(int(body('Create_FIRING_incident')?['ID']),'000000')"), 'Approval display ID uses formatNumber');
check(incidentText.includes('workItem/dynamicFields/System.AssignedTo'), 'approver assignment fix remains present');
console.log('PASS: Power Automate format-number hotfixes are valid.');

function loadWorkflow(root) {
  const absolute = path.resolve(root);
  const flowRoot = path.join(absolute, 'Microsoft.Flow', 'flows');
  const manifest = JSON.parse(fs.readFileSync(path.join(flowRoot, 'manifest.json'), 'utf8'));
  const wrapper = JSON.parse(fs.readFileSync(path.join(flowRoot, manifest.flowAssets.assetPaths[0], 'definition.json'), 'utf8'));
  return { wrapper, workflow: wrapper.properties.definition };
}
function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`OK: ${message}`);
}
