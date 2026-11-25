const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2] || 'artifacts/power-automate/_work/tmp-daily-incident-report-v103');
const fm = JSON.parse(fs.readFileSync(path.join(root, 'Microsoft.Flow', 'flows', 'manifest.json'), 'utf8'));
const id = fm.flowAssets.assetPaths[0];
const w = JSON.parse(fs.readFileSync(path.join(root, 'Microsoft.Flow', 'flows', id, 'definition.json'), 'utf8'));
const text = JSON.stringify(w.properties.definition);
const checks = [
  ['v1.0.10 name', w.properties.displayName.endsWith('v1.0.10')],
  ['operations closure is authoritative', text.includes('Compose_Operations_Closed') && text.includes('Compose_Incident_Closed')],
  ['closed incidents with no open related work excluded', text.includes("equals(length(body('Filter_Open_Related_Items')),0)")],
  ['follow up section is separate', text.includes('FollowUpRows') && text.includes('Follow up — Incident')],
  ['follow up excluded from backlog section', text.includes("@outputs('Compose_Incident_Queue')") && text.includes("'WAITING_SUPPORT'") && text.includes('BacklogCount')],
  ['two daily runs retained', text.includes('"hours":[8,16]') && text.includes('"minutes":[30]')],
  ['related work items source', text.includes('OperationsHubWorkItems')],
  ['closure audit source', text.includes('OperationsHubAudit') && text.includes('INCIDENT_CLOSED')],
  ['six queue classifications', ['ACTIVE','NEEDS_ATTENTION','WAITING_SUPPORT','WAITING_RESOLVED','READY_TO_CLOSE','CLOSED'].every(x => text.includes(`Filter_Queue_${x}`))],
  ['legacy open P1 removed', !text.includes('Get_Open_P1_Incidents') && !text.includes("WorkflowStatus ne 'CLOSED'")],
  ['legacy workflow closed count removed', !text.includes('Filter_Today_Closed')],
  ['period event metrics', text.includes('Filter_Resolved_In_Period') && text.includes('Filter_Closed_In_Period')],
  ['no cumulative totals in message', !w.properties.definition.actions.Compose_Report_Message.inputs.includes('All incidents:') && !w.properties.definition.actions.Compose_Report_Message.inputs.includes('<br>Closed:')],
  ['open backlog total removed', !w.properties.definition.actions.Compose_Report_Message.inputs.includes('Total open backlog:')],
  ['report queue wording', w.properties.definition.actions.Compose_Report_Message.inputs.includes('งานที่ยังค้างไม่ถูกปิด') && w.properties.definition.actions.Compose_Report_Message.inputs.includes('งานที่ยังต้องดำเนินการ')],
  ['intake lifecycle wording', w.properties.definition.actions.Compose_Report_Message.inputs.includes('Incident ที่เกิดขึ้นระหว่างช่วงเวลา') && !text.includes('Tracking / lifecycle:')],
  ['backlog progress wording', !text.includes('Progress / VSTS:') && text.includes('App Support:') && text.includes('IT Tier2:')],
  ['bounded manual run end', text.includes('Compose_Effective_End_UTC') && text.includes('ticks(utcNow())')],
  ['both Teams destinations retained', text.includes('Post_Daily_Report_to_AzureAppServiceHigh5xxRateCritical') && text.includes('Post_Daily_Report_to_IT_Support_Team_2025')]
];
let failed = false;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); failed ||= !ok; }
if (failed) process.exit(1);
