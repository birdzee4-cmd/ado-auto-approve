const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2] || 'tmp-alert-lifecycle-reconciliation-v102');
const fm = JSON.parse(fs.readFileSync(path.join(root, 'Microsoft.Flow', 'flows', 'manifest.json'), 'utf8'));
const id = fm.flowAssets.assetPaths[0];
const w = JSON.parse(fs.readFileSync(path.join(root, 'Microsoft.Flow', 'flows', id, 'definition.json'), 'utf8'));
const d = w.properties.definition;
const text = JSON.stringify(d);
const a = d.actions.For_Each_RESOLVED_Email.actions.Condition_Is_Eligible_RESOLVED.actions;
const filter = a.Condition_Message_Not_Processed.actions.Get_Matching_Open_FIRING.inputs.parameters['$filter'];
const checks = [
  ['v1.0.2 name', w.properties.displayName.endsWith('v1.0.2')],
  ['First Seen parsed', text.includes('Compose_First_Seen_Raw') && text.includes('Compose_First_Seen_At')],
  ['exact episode matching', filter.includes('FirstSeenAt eq') && filter.includes("outputs('Compose_First_Seen_At')")],
  ['P1 gate retained', text.includes('CRITICAL / P1') && text.includes('[CRITICAL]')],
  ['NO MATCH remains silent', !text.includes('NO MATCH')],
  ['ambiguity guard retained', text.includes('Condition_Ambiguous_Match')],
  ['5-minute and 48-hour scan retained', text.includes('"interval":5') && text.includes('addHours(utcNow(),-48)')]
];
let failed = false;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); failed ||= !ok; }
if (failed) process.exit(1);
