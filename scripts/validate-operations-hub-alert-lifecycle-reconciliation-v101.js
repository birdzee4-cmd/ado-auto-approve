const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2] || 'tmp-alert-lifecycle-reconciliation-v101');
const fm = JSON.parse(fs.readFileSync(path.join(root, 'Microsoft.Flow', 'flows', 'manifest.json'), 'utf8'));
const id = fm.flowAssets.assetPaths[0];
const wrapper = JSON.parse(fs.readFileSync(path.join(root, 'Microsoft.Flow', 'flows', id, 'definition.json'), 'utf8'));
const text = JSON.stringify(wrapper.properties.definition);
const checks = [
  ['v1.0.1 display name', wrapper.properties.displayName.endsWith('v1.0.1')],
  ['P1/critical gate', text.includes('CRITICAL / P1') && text.includes('[CRITICAL]')],
  ['no NO MATCH Teams message', !text.includes('NO MATCH')],
  ['ambiguous only warning', text.includes('Condition_Ambiguous_Match') && text.includes('AMBIGUOUS MATCH')],
  ['ambiguity greater than one', text.includes('"greater":["@length(body(\'Get_Matching_Open_FIRING\')?[\'value\'])",1]')],
  ['keeps 5-minute reconciliation', text.includes('"frequency":"Minute","interval":5')],
  ['keeps idempotency', text.includes('Get_Already_Processed_Message') && text.includes('LastSourceMessageId')]
];
let failed = false;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); failed ||= !ok; }
if (failed) process.exit(1);
