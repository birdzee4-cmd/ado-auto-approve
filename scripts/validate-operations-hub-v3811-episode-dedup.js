const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2] || 'tmp-v3811-episode-dedup');
const fm = JSON.parse(fs.readFileSync(path.join(root, 'Microsoft.Flow', 'flows', 'manifest.json'), 'utf8'));
const id = fm.flowAssets.assetPaths[0];
const w = JSON.parse(fs.readFileSync(path.join(root, 'Microsoft.Flow', 'flows', id, 'definition.json'), 'utf8'));
const d = w.properties.definition;
const branch = d.actions.Scope_Process_Incident.actions.Condition_Message_Already_Processed.else.actions
  .Condition_Priority_is_P1_or_P2.actions.Condition_Is_RESOLVED.else.actions;
const filter = branch.Get_items_by_IncidentId.inputs.parameters['$filter'];
const checks = [
  ['v3.8.11 name', w.properties.displayName.endsWith('v3.8.11')],
  ['same alert', filter.includes("outputs('Compose_AlertName')")],
  ['same resource', filter.includes("outputs('Compose_Resource')")],
  ['same environment', filter.includes("outputs('Compose_Environment')")],
  ['same First Seen episode', filter.includes("FirstSeenAt eq") && filter.includes("outputs('Compose_FirstSeenAt')")],
  ['only open FIRING reused', filter.includes("AlertStatus eq ''FIRING''") && filter.includes('ResolvedAt eq null')],
  ['message idempotency retained', JSON.stringify(d).includes('Condition_Message_Already_Processed')]
];
let failed = false;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); failed ||= !ok; }
if (failed) process.exit(1);
