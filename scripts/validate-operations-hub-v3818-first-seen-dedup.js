const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || 'tmp-v3818-build');
const flowManifest = readJson(path.join(root, 'Microsoft.Flow', 'flows', 'manifest.json'));
const assetId = flowManifest.flowAssets.assetPaths[0];
const wrapper = readJson(path.join(root, 'Microsoft.Flow', 'flows', assetId, 'definition.json'));
const workflow = wrapper.properties.definition;
const text = JSON.stringify(workflow);
const firingActions = workflow.actions.Scope_Process_Incident.actions
  .Condition_Message_Already_Processed.else.actions
  .Condition_Priority_is_P1_or_P2.actions
  .Condition_Is_RESOLVED.else.actions;
const filter = firingActions.Get_items_by_IncidentId.inputs.parameters['$filter'];

const checks = [
  ['v3.8.18 display name', wrapper.properties.displayName.endsWith('v3.8.18')],
  ['v3.8.18 content version', workflow.contentVersion === '3.8.18.0'],
  ['same alert required', filter.includes("outputs('Compose_AlertName')")],
  ['same resource required', filter.includes("outputs('Compose_Resource')")],
  ['same environment required', filter.includes("outputs('Compose_Environment')")],
  ['same First Seen required', filter.includes("FirstSeenAt eq") && filter.includes("outputs('Compose_FirstSeenAt')")],
  ['only unresolved FIRING reused', filter.includes("AlertStatus eq ''FIRING''") && filter.includes('ResolvedAt eq null')],
  ['query returns newest single match', firingActions.Get_items_by_IncidentId.inputs.parameters['$orderby'] === 'LastAlertAt desc' && firingActions.Get_items_by_IncidentId.inputs.parameters['$top'] === 1],
  ['message idempotency retained', text.includes('Condition_Message_Already_Processed') && text.includes('LastSourceMessageId eq')],
  ['v3.8.17 Comments API retained', text.includes('/comments?format=html&api-version=7.1-preview.4')],
  ['resolved comment failure handling retained', text.includes('Record_RESOLVED_comment_failure') && text.includes('Notify_RESOLVED_comment_failure')]
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  failed ||= !ok;
}
if (failed) process.exit(1);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
