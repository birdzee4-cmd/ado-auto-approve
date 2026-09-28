const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2] || 'tmp-alert-lifecycle-reconciliation-v100');
const fm = JSON.parse(fs.readFileSync(path.join(root, 'Microsoft.Flow', 'flows', 'manifest.json'), 'utf8'));
const id = fm.flowAssets.assetPaths[0];
const wrapper = JSON.parse(fs.readFileSync(path.join(root, 'Microsoft.Flow', 'flows', id, 'definition.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const d = wrapper.properties.definition;
const text = JSON.stringify(d);
const checks = [
  ['display name', wrapper.properties.displayName === 'Operations Hub - Alert Lifecycle Reconciliation v1.0.0'],
  ['5-minute recurrence', d.triggers.Recurrence_Every_5_Minutes.recurrence.interval === 5],
  ['48-hour lookback', text.includes('addHours(utcNow(),-48)')],
  ['Outlook GetEmailsV3', text.includes('GetEmailsV3') && text.includes('searchQuery')],
  ['sequential processing', text.includes('"repetitions":1')],
  ['message idempotency', text.includes('LastSourceMessageId') && text.includes('Get_Already_Processed_Message')],
  ['strict correlation', text.includes('Get_Matching_Open_FIRING') && text.includes('FirstSeenAt lt')],
  ['ambiguity guard', text.includes('AMBIGUOUS MATCH') && text.includes('No incident was changed')],
  ['RESOLVED update', text.includes('Update_Matching_Incident_RESOLVED') && text.includes('"item/AlertStatus/Value":"RESOLVED"')],
  ['no Azure DevOps actions', !text.includes('shared_visualstudioteamservices')],
  ['only 3 connection references', Object.keys(wrapper.properties.connectionReferences || {}).length === 3],
  ['only 7 package resources', Object.keys(pkg.resources).length === 7]
];
let failed = false;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); failed ||= !ok; }
if (failed) process.exit(1);
