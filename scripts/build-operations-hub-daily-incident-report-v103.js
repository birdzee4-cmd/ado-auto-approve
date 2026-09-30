const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-daily-incident-report-v103.js <v1.0.3-directory> <output-directory>');
const source = path.resolve(sourceRoot);
const output = path.resolve(outputRoot);
if (!fs.existsSync(source)) throw new Error(`Source package directory does not exist: ${source}`);
if (fs.existsSync(output)) throw new Error(`Output directory already exists: ${output}`);
fs.cpSync(source, output, { recursive: true });

const flowRoot = path.join(output, 'Microsoft.Flow', 'flows');
const fm = readJson(path.join(flowRoot, 'manifest.json'));
const assetId = fm.flowAssets.assetPaths[0];
const definitionPath = path.join(flowRoot, assetId, 'definition.json');
const packagePath = path.join(output, 'manifest.json');
const wrapper = readJson(definitionPath);
const manifest = readJson(packagePath);
const workflow = wrapper.properties.definition;
const old = workflow.actions;
const SITE = 'https://buzzebees.sharepoint.com/sites/ADOAuto-Approve';
const INCIDENTS = '5f744c7f-10a3-4ef4-9cf7-f64f65a71851';

// Retain the proven time-window calculations and daily filters, then replace
// the legacy WorkflowStatus backlog with the same queue rules as Operations Hub.
const keep = {};
for (const name of ['Compose_Run_Hour','Compose_Report_Date','Compose_Date_Key','Compose_Start_Local','Compose_End_Local','Compose_Start_UTC','Compose_End_UTC','Get_Todays_Incidents','Filter_Today_P1','Filter_Today_Firing','Filter_Today_Resolved','Filter_Today_Failed','Initialize_Today_Rows','For_each_Today_Incident']) {
  if (old[name]) keep[name] = old[name];
}
keep.Initialize_Today_Rows.runAfter = {
  Filter_Today_P1: ['Succeeded'], Filter_Today_Firing: ['Succeeded'],
  Filter_Today_Resolved: ['Succeeded'], Filter_Today_Failed: ['Succeeded']
};
keep.For_each_Today_Incident.runAfter = { Initialize_Today_Rows: ['Succeeded'] };

// Scheduled runs use the fixed boundary; manual runs must not report into the future.
keep.Compose_Effective_End_UTC = {
  type: 'Compose',
  inputs: "@if(less(ticks(utcNow()),ticks(outputs('Compose_End_UTC'))),utcNow(),outputs('Compose_End_UTC'))",
  runAfter: { Compose_End_UTC: ['Succeeded'] }
};
keep.Get_Todays_Incidents.runAfter = { Compose_Effective_End_UTC: ['Succeeded'] };
keep.Get_Todays_Incidents.inputs.parameters['$filter'] = keep.Get_Todays_Incidents.inputs.parameters['$filter'].replace(/Compose_End_UTC/g, 'Compose_Effective_End_UTC');

keep.Get_All_Incidents = getItems(INCIDENTS, '', 'Created desc', 1000, 'Compose_Effective_End_UTC');
keep.Get_All_Related_Work_Items = getItems('OperationsHubWorkItems', '', 'Created desc', 5000, 'Compose_Effective_End_UTC');
keep.Get_Closure_Audit = getItems('OperationsHubAudit', "field_6 eq 'INCIDENT_CLOSED' and field_7 eq 'SUCCEEDED'", 'field_15 desc', 5000, 'Compose_Effective_End_UTC');
keep.Filter_Resolved_In_Period = query("@body('Get_All_Incidents')?['value']", "@and(not(equals(string(coalesce(item()?['ResolvedAt'],'')),'')),greaterOrEquals(ticks(item()?['ResolvedAt']),ticks(outputs('Compose_Start_UTC'))),less(ticks(item()?['ResolvedAt']),ticks(outputs('Compose_End_UTC'))))", 'Get_All_Incidents');
keep.Filter_Closed_In_Period = query("@body('Get_Closure_Audit')?['value']", "@and(greaterOrEquals(ticks(item()?['field_15']),ticks(outputs('Compose_Start_UTC'))),less(ticks(item()?['field_15']),ticks(outputs('Compose_End_UTC'))))", 'Get_Closure_Audit');
keep.Initialize_Queue_Records = variable('QueueRecords', 'array', [], ['Get_All_Incidents','Get_All_Related_Work_Items','Get_Closure_Audit','Filter_Resolved_In_Period','Filter_Closed_In_Period','Filter_Today_P1','Filter_Today_Firing','Filter_Today_Failed']);
keep.Initialize_Backlog_Rows = variable('BacklogRows', 'string', '', ['Initialize_Queue_Records']);
keep.Initialize_Backlog_Count = variable('BacklogCount', 'integer', 0, ['Initialize_Backlog_Rows']);
keep.For_each_Current_Incident = {
  type: 'Foreach',
  foreach: "@body('Get_All_Incidents')?['value']",
  runAfter: { Initialize_Backlog_Count: ['Succeeded'] },
  runtimeConfiguration: { concurrency: { repetitions: 1 } },
  actions: {
    Filter_Related_Items: query("@body('Get_All_Related_Work_Items')?['value']", "@equals(toLower(string(coalesce(item()?['field_1'],item()?['IncidentId'],''))),toLower(string(items('For_each_Current_Incident')?['IncidentId'])))"),
    Filter_Open_Related_Items: query("@body('Filter_Related_Items')", "@not(contains(createArray('CLOSED','DONE','REMOVED','RESOLVED','REJECT','REJECTED'),toUpper(string(coalesce(item()?['field_5'],item()?['State'],'')))))", 'Filter_Related_Items'),
    Filter_Incident_Closure: query("@body('Get_Closure_Audit')?['value']", "@equals(toLower(string(coalesce(item()?['field_4'],item()?['IncidentId'],''))),toLower(string(items('For_each_Current_Incident')?['IncidentId'])))", 'Filter_Open_Related_Items'),
    Compose_Primary_Closed: compose("@contains(createArray('CLOSED','DONE','REMOVED','RESOLVED','REJECT','REJECTED'),toUpper(string(coalesce(items('For_each_Current_Incident')?['AdoState'],''))))", 'Filter_Incident_Closure'),
    Compose_Incident_Queue: compose("@if(greater(length(body('Filter_Incident_Closure')),0),'CLOSED',if(or(equals(toUpper(string(coalesce(items('For_each_Current_Incident')?['WorkflowStatus']?['Value'],items('For_each_Current_Incident')?['WorkflowStatus'],''))),'FAILED'),contains(createArray('RECEIVED','AWAITING_APPROVAL'),toUpper(string(coalesce(items('For_each_Current_Incident')?['WorkflowStatus']?['Value'],items('For_each_Current_Incident')?['WorkflowStatus'],'')))),equals(string(coalesce(items('For_each_Current_Incident')?['AdoWorkItemId'],'')),''),not(empty(string(coalesce(items('For_each_Current_Incident')?['ErrorDetail'],''))))),'NEEDS_ATTENTION',if(greater(length(body('Filter_Open_Related_Items')),0),'WAITING_SUPPORT',if(and(outputs('Compose_Primary_Closed'),equals(toUpper(string(coalesce(items('For_each_Current_Incident')?['AlertStatus']?['Value'],items('For_each_Current_Incident')?['AlertStatus'],''))),'FIRING')),'WAITING_RESOLVED',if(and(outputs('Compose_Primary_Closed'),equals(toUpper(string(coalesce(items('For_each_Current_Incident')?['AlertStatus']?['Value'],items('For_each_Current_Incident')?['AlertStatus'],''))),'RESOLVED')),'READY_TO_CLOSE','ACTIVE')))))", 'Compose_Primary_Closed'),
    Append_Queue_Record: {
      type: 'AppendToArrayVariable', runAfter: { Compose_Incident_Queue: ['Succeeded'] },
      inputs: { name: 'QueueRecords', value: { queue: "@outputs('Compose_Incident_Queue')", incidentId: "@items('For_each_Current_Incident')?['IncidentId']" } }
    },
    Condition_Append_Backlog_Row: {
      type: 'If', runAfter: { Append_Queue_Record: ['Succeeded'] },
      expression: { and: [
        { not: { equals: ["@outputs('Compose_Incident_Queue')", 'CLOSED'] } },
        { less: ["@variables('BacklogCount')", 20] }
      ] },
      actions: {
        Append_Backlog_Row: {
          type: 'AppendToStringVariable',
          inputs: { name: 'BacklogRows', value: "<br>• <a href=\"https://mango-wave-09cff3700.7.azurestaticapps.net/operations.html#/incidents?id=@{uriComponent(items('For_each_Current_Incident')?['IncidentId'])}\"><b>@{concat('INC-',formatDateTime(convertTimeZone(coalesce(items('For_each_Current_Incident')?['Created'],utcNow()),'UTC','SE Asia Standard Time'),'yyyy'),'-',formatNumber(int(items('For_each_Current_Incident')?['ID']),'000000'))}</b></a> | @{coalesce(items('For_each_Current_Incident')?['Resource'],'-')} | @{outputs('Compose_Incident_Queue')} | Alert @{coalesce(items('For_each_Current_Incident')?['AlertStatus']?['Value'],items('For_each_Current_Incident')?['AlertStatus'],'-')} | VSTS @{coalesce(items('For_each_Current_Incident')?['AdoState'],'-')} #@{coalesce(items('For_each_Current_Incident')?['AdoWorkItemId'],'-')}" }
        },
        Increment_Backlog_Count: { type: 'IncrementVariable', runAfter: { Append_Backlog_Row: ['Succeeded'] }, inputs: { name: 'BacklogCount', value: 1 } }
      }, else: { actions: {} }
    }
  }
};

for (const queue of ['ACTIVE','NEEDS_ATTENTION','WAITING_SUPPORT','WAITING_RESOLVED','READY_TO_CLOSE','CLOSED']) {
  keep[`Filter_Queue_${queue}`] = query("@variables('QueueRecords')", `@equals(item()?['queue'],'${queue}')`, 'For_each_Current_Incident');
}
keep.Compose_Report_Message = {
  type: 'Compose',
  runAfter: Object.fromEntries(['ACTIVE','NEEDS_ATTENTION','WAITING_SUPPORT','WAITING_RESOLVED','READY_TO_CLOSE','CLOSED'].map(q => [`Filter_Queue_${q}`, ['Succeeded']])),
  inputs: "<p><b>📊 OPERATIONS HUB — DAILY INCIDENT REPORT</b><br>@{formatDateTime(convertTimeZone(outputs('Compose_Start_UTC'),'UTC','SE Asia Standard Time'),'dd/MM HH:mm')}–@{formatDateTime(convertTimeZone(outputs('Compose_Effective_End_UTC'),'UTC','SE Asia Standard Time'),'dd/MM HH:mm')} น. (Asia/Bangkok)</p><p><b>กิจกรรม</b><br>Received: @{length(body('Get_Todays_Incidents')?['value'])}@{if(greater(length(body('Filter_Resolved_In_Period')),0),concat('<br>Resolved: ',length(body('Filter_Resolved_In_Period'))),'')}@{if(greater(length(body('Filter_Closed_In_Period')),0),concat('<br>Closed during period: ',length(body('Filter_Closed_In_Period'))),'')}@{if(greater(length(body('Filter_Today_Failed')),0),concat('<br>Automation errors: ',length(body('Filter_Today_Failed'))),'')}</p><p><b>คิวที่ต้องดำเนินการ</b>@{if(greater(length(body('Filter_Queue_ACTIVE')),0),concat('<br>Active: ',length(body('Filter_Queue_ACTIVE'))),'')}@{if(greater(length(body('Filter_Queue_NEEDS_ATTENTION')),0),concat('<br>Needs attention: ',length(body('Filter_Queue_NEEDS_ATTENTION'))),'')}@{if(greater(length(body('Filter_Queue_WAITING_SUPPORT')),0),concat('<br>Waiting support: ',length(body('Filter_Queue_WAITING_SUPPORT'))),'')}@{if(greater(length(body('Filter_Queue_WAITING_RESOLVED')),0),concat('<br>Waiting resolved: ',length(body('Filter_Queue_WAITING_RESOLVED'))),'')}@{if(greater(length(body('Filter_Queue_READY_TO_CLOSE')),0),concat('<br>Ready to close: ',length(body('Filter_Queue_READY_TO_CLOSE'))),'')}<br><b>Total open backlog: @{sub(length(variables('QueueRecords')),length(body('Filter_Queue_CLOSED')))}</b></p><p><b>รายการรับเข้า</b>@{if(empty(variables('TodayRows')),'<br>• ไม่มีรายการ',variables('TodayRows'))}</p><p><b>รายการที่ต้องดำเนินการ</b>@{if(empty(variables('BacklogRows')),'<br>• ไม่มีรายการ',variables('BacklogRows'))}</p><p><a href=\"https://mango-wave-09cff3700.7.azurestaticapps.net/operations.html#/incidents\">เปิด Operations Hub</a></p>"
};
keep.Compose_Report_Message.runAfter.For_each_Today_Incident = ['Succeeded'];
keep.Post_Daily_Report_to_AzureAppServiceHigh5xxRateCritical = old.Post_Daily_Report_to_AzureAppServiceHigh5xxRateCritical;
keep.Post_Daily_Report_to_AzureAppServiceHigh5xxRateCritical.runAfter = { Compose_Report_Message: ['Succeeded'] };
keep.Post_Daily_Report_to_IT_Support_Team_2025 = old.Post_Daily_Report_to_IT_Support_Team_2025;
keep.Post_Daily_Report_to_IT_Support_Team_2025.runAfter = { Compose_Report_Message: ['Succeeded'] };
workflow.actions = keep;
workflow.contentVersion = '1.0.7.0';
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = 'Operations Hub - Daily Incident Report v1.0.7';
manifest.details.displayName = 'OperationsHub-DailyIncidentReport-v1.0.7';
manifest.details.description = 'Compact two-window report with bounded manual-run periods, event-time activity metrics, and non-zero open queue summaries.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = wrapper.properties.displayName;
writeJson(definitionPath, wrapper);
writeJson(packagePath, manifest);
console.log(`Built ${wrapper.properties.displayName} at ${output}`);

function getItems(table, filter, orderby, top, after) {
  const parameters = { dataset: SITE, table, '$orderby': orderby, '$top': top };
  if (filter) parameters['$filter'] = filter;
  return { type: 'OpenApiConnection', inputs: { parameters, host: { apiId: '/providers/Microsoft.PowerApps/apis/shared_sharepointonline', connectionName: 'shared_sharepointonline', operationId: 'GetItems' }, authentication: "@parameters('$authentication')" }, runAfter: { [after]: ['Succeeded'] }, runtimeConfiguration: { paginationPolicy: { minimumItemCount: top } } };
}
function variable(name, type, value, after) { return { type: 'InitializeVariable', inputs: { variables: [{ name, type, value }] }, runAfter: Object.fromEntries(after.map(x => [x, ['Succeeded']])) }; }
function query(from, where, after) { const x = { type: 'Query', inputs: { from, where } }; if (after) x.runAfter = { [after]: ['Succeeded'] }; return x; }
function compose(inputs, after) { return { type: 'Compose', inputs, runAfter: { [after]: ['Succeeded'] } }; }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
