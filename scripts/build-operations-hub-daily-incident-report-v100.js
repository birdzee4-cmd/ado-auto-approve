const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-daily-incident-report-v100.js <source-package-directory> <output-directory>');
const source = path.resolve(sourceRoot);
const output = path.resolve(outputRoot);
if (!fs.existsSync(source)) throw new Error(`Source package directory does not exist: ${source}`);
if (fs.existsSync(output)) throw new Error(`Output directory already exists: ${output}`);
fs.cpSync(source, output, { recursive: true });

const packagePath = path.join(output, 'manifest.json');
const flowRoot = path.join(output, 'Microsoft.Flow', 'flows');
const flowManifestPath = path.join(flowRoot, 'manifest.json');
const flowManifest = readJson(flowManifestPath);
const oldAssetId = flowManifest.flowAssets.assetPaths[0];
const newAssetId = crypto.randomUUID();
fs.renameSync(path.join(flowRoot, oldAssetId), path.join(flowRoot, newAssetId));
flowManifest.flowAssets.assetPaths = [newAssetId];
writeJson(flowManifestPath, flowManifest);

const definitionPath = path.join(flowRoot, newAssetId, 'definition.json');
const wrapper = readJson(definitionPath);
const packageManifest = readJson(packagePath);
const workflow = wrapper.properties.definition;
const oldResource = packageManifest.resources[oldAssetId];
const keepResourceIds = new Set([newAssetId, '0d2b35a5-d007-4f43-9675-c117c2b07c88', '51b3690b-32c3-45ee-bfe1-48e48e2d0db7', '594d160d-2ee5-4065-9103-ace2b5295371', '0148280b-d737-4313-959a-28b4b68813ab']);

const displayName = 'Operations Hub - Daily Incident Report v1.0.0';
wrapper.name = crypto.randomUUID();
wrapper.id = `/providers/Microsoft.Flow/flows/${wrapper.name}`;
wrapper.properties.displayName = displayName;
workflow.contentVersion = '1.0.0.0';
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
workflow.triggers = {
  Recurrence: {
    recurrence: { frequency: 'Day', interval: 1, timeZone: 'SE Asia Standard Time', schedule: { hours: [16], minutes: [30] } },
    evaluatedRecurrence: { frequency: 'Day', interval: 1, timeZone: 'SE Asia Standard Time', schedule: { hours: [16], minutes: [30] } },
    type: 'Recurrence'
  }
};
workflow.actions = buildActions();
wrapper.properties.connectionReferences = {
  shared_sharepointonline: wrapper.properties.connectionReferences.shared_sharepointonline,
  'shared_teams-1': wrapper.properties.connectionReferences['shared_teams-1']
};

writeJson(path.join(flowRoot, newAssetId, 'apisMap.json'), {
  shared_sharepointonline: '0d2b35a5-d007-4f43-9675-c117c2b07c88',
  'shared_teams-1': '594d160d-2ee5-4065-9103-ace2b5295371'
});
writeJson(path.join(flowRoot, newAssetId, 'connectionsMap.json'), {
  shared_sharepointonline: '51b3690b-32c3-45ee-bfe1-48e48e2d0db7',
  'shared_teams-1': '0148280b-d737-4313-959a-28b4b68813ab'
});

packageManifest.details.displayName = 'OperationsHub-DailyIncidentReport-v1.0.0';
packageManifest.details.description = 'Daily Operations Hub Incident report sent to the existing Microsoft Teams group chat at 16:30 Asia/Bangkok. Includes today activity and the current open P1 queue.';
packageManifest.details.createdTime = new Date().toISOString();
packageManifest.details.packageTelemetryId = crypto.randomUUID();
packageManifest.resources[newAssetId] = {
  ...oldResource,
  details: { ...oldResource.details, displayName },
  dependsOn: ['0d2b35a5-d007-4f43-9675-c117c2b07c88', '51b3690b-32c3-45ee-bfe1-48e48e2d0db7', '594d160d-2ee5-4065-9103-ace2b5295371', '0148280b-d737-4313-959a-28b4b68813ab']
};
delete packageManifest.resources[oldAssetId];
for (const id of Object.keys(packageManifest.resources)) if (!keepResourceIds.has(id)) delete packageManifest.resources[id];

writeJson(definitionPath, wrapper);
writeJson(packagePath, packageManifest);
console.log(`Built ${displayName} at ${output}`);

function buildActions() {
  const site = 'https://buzzebees.sharepoint.com/sites/ADOAuto-Approve';
  const list = '5f744c7f-10a3-4ef4-9cf7-f64f65a71851';
  const spGet = parameters => ({ type: 'OpenApiConnection', inputs: { parameters: { dataset: site, table: list, ...parameters }, host: { apiId: '/providers/Microsoft.PowerApps/apis/shared_sharepointonline', connectionName: 'shared_sharepointonline', operationId: 'GetItems' }, authentication: "@parameters('$authentication')" } });
  const filter = (after, where) => ({ type: 'Query', runAfter: { [after]: ['Succeeded'] }, inputs: { from: "@body('Get_Todays_Incidents')?['value']", where } });
  const itemDisplay = "@{concat('INC-',formatDateTime(convertTimeZone(coalesce(items('For_each_Today_Incident')?['Created'],utcNow()),'UTC','SE Asia Standard Time'),'yyyy'),'-',padLeft(string(items('For_each_Today_Incident')?['ID']),6,'0'))}";
  const openDisplay = "@{concat('INC-',formatDateTime(convertTimeZone(coalesce(items('For_each_Open_Incident')?['Created'],utcNow()),'UTC','SE Asia Standard Time'),'yyyy'),'-',padLeft(string(items('For_each_Open_Incident')?['ID']),6,'0'))}";
  return {
    Compose_Report_Date: { type: 'Compose', inputs: "@formatDateTime(convertTimeZone(utcNow(),'UTC','SE Asia Standard Time'),'dd/MM/yyyy')" },
    Compose_Date_Key: { type: 'Compose', runAfter: { Compose_Report_Date: ['Succeeded'] }, inputs: "@formatDateTime(convertTimeZone(utcNow(),'UTC','SE Asia Standard Time'),'yyyy-MM-dd')" },
    Compose_Start_UTC: { type: 'Compose', runAfter: { Compose_Date_Key: ['Succeeded'] }, inputs: "@convertToUtc(concat(outputs('Compose_Date_Key'),'T00:00:00'),'SE Asia Standard Time')" },
    Compose_End_UTC: { type: 'Compose', runAfter: { Compose_Start_UTC: ['Succeeded'] }, inputs: "@convertToUtc(concat(formatDateTime(addDays(outputs('Compose_Date_Key'),1),'yyyy-MM-dd'),'T00:00:00'),'SE Asia Standard Time')" },
    Get_Todays_Incidents: { ...spGet({ '$filter': "@concat('Created ge datetime''',outputs('Compose_Start_UTC'),''' and Created lt datetime''',outputs('Compose_End_UTC'),'''')", '$orderby': 'Created desc', '$top': 100 }), runAfter: { Compose_End_UTC: ['Succeeded'] }, runtimeConfiguration: { paginationPolicy: { minimumItemCount: 100 } } },
    Get_Open_P1_Incidents: { ...spGet({ '$filter': "Priority eq 'P1' and WorkflowStatus ne 'CLOSED'", '$orderby': 'Created desc', '$top': 20 }), runAfter: { Compose_End_UTC: ['Succeeded'] } },
    Filter_Today_P1: filter('Get_Todays_Incidents', "@equals(toUpper(string(coalesce(item()?['Priority']?['Value'],item()?['Priority'],''))),'P1')"),
    Filter_Today_Firing: filter('Get_Todays_Incidents', "@equals(toUpper(string(coalesce(item()?['AlertStatus']?['Value'],item()?['AlertStatus'],''))),'FIRING')"),
    Filter_Today_Resolved: filter('Get_Todays_Incidents', "@equals(toUpper(string(coalesce(item()?['AlertStatus']?['Value'],item()?['AlertStatus'],''))),'RESOLVED')"),
    Filter_Today_Closed: filter('Get_Todays_Incidents', "@equals(toUpper(string(coalesce(item()?['WorkflowStatus']?['Value'],item()?['WorkflowStatus'],''))),'CLOSED')"),
    Filter_Today_Failed: filter('Get_Todays_Incidents', "@or(equals(toUpper(string(coalesce(item()?['WorkflowStatus']?['Value'],item()?['WorkflowStatus'],''))),'FAILED'),not(empty(item()?['ErrorDetail'])))"),
    Initialize_Today_Rows: { type: 'InitializeVariable', runAfter: { Filter_Today_P1: ['Succeeded'], Filter_Today_Firing: ['Succeeded'], Filter_Today_Resolved: ['Succeeded'], Filter_Today_Closed: ['Succeeded'], Filter_Today_Failed: ['Succeeded'] }, inputs: { variables: [{ name: 'TodayRows', type: 'string', value: '' }] } },
    Initialize_Open_Rows: { type: 'InitializeVariable', runAfter: { Initialize_Today_Rows: ['Succeeded'], Get_Open_P1_Incidents: ['Succeeded'] }, inputs: { variables: [{ name: 'OpenRows', type: 'string', value: '' }] } },
    For_each_Today_Incident: { type: 'Foreach', foreach: "@take(body('Get_Todays_Incidents')?['value'],20)", runAfter: { Initialize_Open_Rows: ['Succeeded'] }, runtimeConfiguration: { concurrency: { repetitions: 1 } }, actions: { Append_Today_Row: { type: 'AppendToStringVariable', inputs: { name: 'TodayRows', value: `<br>• <a href="https://mango-wave-09cff3700.7.azurestaticapps.net/operations.html#/incidents?id=@{uriComponent(items('For_each_Today_Incident')?['IncidentId'])}"><b>${itemDisplay}</b></a> | @{coalesce(items('For_each_Today_Incident')?['Priority']?['Value'],items('For_each_Today_Incident')?['Priority'],'-')} | @{coalesce(items('For_each_Today_Incident')?['Resource'],'-')} | @{coalesce(items('For_each_Today_Incident')?['AlertStatus']?['Value'],items('For_each_Today_Incident')?['AlertStatus'],'-')} / @{coalesce(items('For_each_Today_Incident')?['WorkflowStatus']?['Value'],items('For_each_Today_Incident')?['WorkflowStatus'],'-')}` } } } },
    For_each_Open_Incident: { type: 'Foreach', foreach: "@body('Get_Open_P1_Incidents')?['value']", runAfter: { For_each_Today_Incident: ['Succeeded'] }, runtimeConfiguration: { concurrency: { repetitions: 1 } }, actions: { Append_Open_Row: { type: 'AppendToStringVariable', inputs: { name: 'OpenRows', value: `<br>• <a href="https://mango-wave-09cff3700.7.azurestaticapps.net/operations.html#/incidents?id=@{uriComponent(items('For_each_Open_Incident')?['IncidentId'])}"><b>${openDisplay}</b></a> | @{coalesce(items('For_each_Open_Incident')?['Resource'],'-')} | @{coalesce(items('For_each_Open_Incident')?['WorkflowStatus']?['Value'],items('For_each_Open_Incident')?['WorkflowStatus'],'-')} | VSTS #@{coalesce(items('For_each_Open_Incident')?['AdoWorkItemId'],'-')} | @{coalesce(items('For_each_Open_Incident')?['AssignedTo'],'Unassigned')}` } } } },
    Compose_Report_Message: { type: 'Compose', runAfter: { For_each_Open_Incident: ['Succeeded'] }, inputs: `<p><b>📊 OPERATIONS HUB — DAILY INCIDENT REPORT</b><br>วันที่ @{outputs('Compose_Report_Date')} | ข้อมูลเวลา 00:00–16:30 น. (Asia/Bangkok)</p><p><b>สรุปงานวันนี้</b><br>Incident ใหม่: @{length(body('Get_Todays_Incidents')?['value'])}<br>P1: @{length(body('Filter_Today_P1'))}<br>FIRING: @{length(body('Filter_Today_Firing'))}<br>RESOLVED: @{length(body('Filter_Today_Resolved'))}<br>ปิด Incident แล้ว: @{length(body('Filter_Today_Closed'))}<br>รายการผิดพลาด/ต้องตรวจสอบ: @{length(body('Filter_Today_Failed'))}</p><p><b>รายการวันนี้ (สูงสุด 20 รายการ)</b>@{if(empty(variables('TodayRows')),'<br>• ไม่มี Incident ใหม่วันนี้',variables('TodayRows'))}</p><p><b>งาน P1 ที่ยังเปิดอยู่ (สูงสุด 20 รายการ)</b>@{if(empty(variables('OpenRows')),'<br>• ไม่มีงาน P1 ค้าง',variables('OpenRows'))}</p><p><a href="https://mango-wave-09cff3700.7.azurestaticapps.net/operations.html#/incidents">เปิด Operations Hub</a><br><small>สถานะอ้างอิงจาก SharePoint และรอบ VSTS Reconciliation ล่าสุด</small></p>` },
    Post_Daily_Report_to_Teams: { type: 'OpenApiConnection', runAfter: { Compose_Report_Message: ['Succeeded'] }, inputs: { parameters: { poster: 'Flow bot', location: 'Group chat', 'body/recipient': '19:a0a8b701b02c469b94f493d1ed9903b9@thread.v2', 'body/messageBody': "@outputs('Compose_Report_Message')" }, host: { apiId: '/providers/Microsoft.PowerApps/apis/shared_teams', connectionName: 'shared_teams-1', operationId: 'PostMessageToConversation' }, retryPolicy: { type: 'none' }, authentication: "@parameters('$authentication')" } }
  };
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
