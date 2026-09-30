const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || 'tmp-v3819-build');
const flowManifest = readJson(path.join(root, 'Microsoft.Flow', 'flows', 'manifest.json'));
const assetId = flowManifest.flowAssets.assetPaths[0];
const wrapper = readJson(path.join(root, 'Microsoft.Flow', 'flows', assetId, 'definition.json'));
const workflow = wrapper.properties.definition;
const text = JSON.stringify(workflow);
const routing = JSON.stringify(workflow.actions.Condition_AppService_Subject_Routing.expression);
const intake = workflow.actions.Scope_Process_Incident.actions.Condition_Message_Already_Processed.else.actions;
const firing = intake.Condition_Priority_is_P1_or_P2.actions.Condition_Is_RESOLVED.else.actions;
const firingFilter = firing.Get_items_by_IncidentId.inputs.parameters['$filter'];

const checks = [
  ['v3.8.19 display name', wrapper.properties.displayName.endsWith('v3.8.19')],
  ['v3.8.19 content version', workflow.contentVersion === '3.8.19.0'],
  ['subject RESOLVED routing retained', routing.includes('ALERT RESOLVED') && routing.includes("body/subject") && routing.includes('RESOLVED')],
  ['body RESOLVED marker routes', routing.includes('✅ RESOLVED') && routing.includes('<B>RESOLVED AT:</B>')],
  ['body must look like an alert', routing.includes('<B>ALERT:</B>')],
  ['FIRING routing retained', routing.includes('ALERT FIRING') && routing.includes('🔥 ALERT FIRING')],
  ['Compose IsResolved accepts body marker', String(intake.Compose_IsResolved.inputs).includes('✅ RESOLVED') && String(intake.Compose_IsResolved.inputs).includes('<B>RESOLVED AT:</B>')],
  ['First Seen episode dedup retained', firingFilter.includes('FirstSeenAt eq') && firingFilter.includes("outputs('Compose_FirstSeenAt')")],
  ['Comments API retained', text.includes('/comments?format=html&api-version=7.1-preview.4')],
  ['comment failure handling retained', text.includes('Record_RESOLVED_comment_failure') && text.includes('Notify_RESOLVED_comment_failure')],
  ['message idempotency retained', text.includes('Condition_Message_Already_Processed') && text.includes('LastSourceMessageId eq')]
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  failed ||= !ok;
}
if (failed) process.exit(1);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
