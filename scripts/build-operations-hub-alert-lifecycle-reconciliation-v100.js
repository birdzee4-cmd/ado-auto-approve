const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-alert-lifecycle-reconciliation-v100.js <v3.8.10-directory> <output-directory>');
const source = path.resolve(sourceRoot);
const output = path.resolve(outputRoot);
if (!fs.existsSync(source)) throw new Error(`Source package directory does not exist: ${source}`);
if (fs.existsSync(output)) throw new Error(`Output directory already exists: ${output}`);
fs.cpSync(source, output, { recursive: true });

const packagePath = path.join(output, 'manifest.json');
const flowRoot = path.join(output, 'Microsoft.Flow', 'flows');
const flowManifestPath = path.join(flowRoot, 'manifest.json');
const flowManifest = readJson(flowManifestPath);
const assetId = flowManifest.flowAssets.assetPaths[0];
const definitionPath = path.join(flowRoot, assetId, 'definition.json');
const apisMapPath = path.join(flowRoot, assetId, 'apisMap.json');
const connectionsMapPath = path.join(flowRoot, assetId, 'connectionsMap.json');
const wrapper = readJson(definitionPath);
const manifest = readJson(packagePath);
const workflow = wrapper.properties.definition;

const SITE = 'https://buzzebees.sharepoint.com/sites/ADOAuto-Approve';
const LIST = '5f744c7f-10a3-4ef4-9cf7-f64f65a71851';
const FOLDER = 'Id::AAMkADE0OWVjYjA5LWIyMDMtNDhjYS04ZDhjLWNkMWFhYzJiYWQyOQAuAAAAAAC8C8XS08R9Trfz1GrYHZKbAQBshOktFlHmSY3OPI6jffd6AAZHrGg6AAA=';
const CHAT = '19:a0a8b701b02c469b94f493d1ed9903b9@thread.v2';

workflow.contentVersion = '1.0.0.0';
workflow.triggers = {
  Recurrence_Every_5_Minutes: {
    type: 'Recurrence',
    recurrence: { frequency: 'Minute', interval: 5, timeZone: 'SE Asia Standard Time' }
  }
};
workflow.actions = {
  Get_RESOLVED_Emails: openApi('shared_office365-1', 'shared_office365', 'GetEmailsV3', {
    folderPath: FOLDER,
    fetchOnlyUnread: false,
    includeAttachments: false,
    searchQuery: 'RESOLVED',
    top: 1000
  }),
  For_Each_RESOLVED_Email: {
    type: 'Foreach',
    foreach: "@body('Get_RESOLVED_Emails')?['value']",
    runAfter: { Get_RESOLVED_Emails: ['Succeeded'] },
    runtimeConfiguration: { concurrency: { repetitions: 1 } },
    actions: {
      Compose_Email_Subject: compose("@coalesce(items('For_Each_RESOLVED_Email')?['subject'],'')"),
      Compose_Email_Body: compose("@coalesce(items('For_Each_RESOLVED_Email')?['body'],'')", 'Compose_Email_Subject'),
      Compose_Message_Id: compose("@coalesce(items('For_Each_RESOLVED_Email')?['id'],items('For_Each_RESOLVED_Email')?['internetMessageId'],'')", 'Compose_Email_Body'),
      Condition_Is_Eligible_RESOLVED: {
        type: 'If',
        runAfter: { Compose_Message_Id: ['Succeeded'] },
        expression: { and: [
          { greaterOrEquals: ["@ticks(coalesce(items('For_Each_RESOLVED_Email')?['receivedDateTime'],utcNow()))", "@ticks(addHours(utcNow(),-48))"] },
          { contains: ["@toUpper(outputs('Compose_Email_Subject'))", 'RESOLVED'] },
          { contains: ["@outputs('Compose_Email_Body')", 'Resource:'] },
          { contains: ["@outputs('Compose_Email_Body')", 'Alert:</b>'] }
        ] },
        actions: buildEligibleActions(),
        else: { actions: {} }
      }
    }
  }
};
workflow.outputs = {};
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
workflow.parameters = workflow.parameters || {};
wrapper.properties.connectionReferences = Object.fromEntries(Object.entries(wrapper.properties.connectionReferences || {}).filter(([key]) => ['shared_office365-1', 'shared_sharepointonline', 'shared_teams-1'].includes(key)));

// This flow needs only Outlook, SharePoint, and Teams.
const keepResourceIds = new Set([
  assetId,
  '044156f4-6f73-45f0-8720-c15c8ba63c1f', '35e383d7-6f98-4f0d-a974-1c4e204c9f40',
  '0d2b35a5-d007-4f43-9675-c117c2b07c88', '51b3690b-32c3-45ee-bfe1-48e48e2d0db7',
  '594d160d-2ee5-4065-9103-ace2b5295371', '0148280b-d737-4313-959a-28b4b68813ab'
]);
for (const id of Object.keys(manifest.resources)) if (!keepResourceIds.has(id)) delete manifest.resources[id];
const root = manifest.resources[assetId];
root.details.displayName = 'Operations Hub - Alert Lifecycle Reconciliation v1.0.0';
root.dependsOn = (root.dependsOn || []).filter(x => keepResourceIds.has(typeof x === 'string' ? x : x.id));
wrapper.properties.displayName = 'Operations Hub - Alert Lifecycle Reconciliation v1.0.0';
manifest.details.displayName = 'OperationsHub-AlertLifecycleReconciliation-v1.0.0';
manifest.details.description = 'Scheduled 5-minute, 48-hour Outlook reconciliation for missed RESOLVED monitoring messages. Idempotently updates one matching FIRING SharePoint incident and reports unmatched or ambiguous messages to Teams; it does not modify Azure DevOps directly.';
manifest.details.createdTime = new Date().toISOString();

writeJson(definitionPath, wrapper);
writeJson(apisMapPath, Object.fromEntries(Object.entries(readJson(apisMapPath)).filter(([key]) => ['shared_office365-1', 'shared_sharepointonline', 'shared_teams-1'].includes(key))));
writeJson(connectionsMapPath, Object.fromEntries(Object.entries(readJson(connectionsMapPath)).filter(([key]) => ['shared_office365-1', 'shared_sharepointonline', 'shared_teams-1'].includes(key))));
writeJson(packagePath, manifest);
writeJson(flowManifestPath, flowManifest);
console.log(`Built ${wrapper.properties.displayName} at ${output}`);

function buildEligibleActions() {
  return {
    Compose_Alert_Name: compose("@trim(first(split(last(split(outputs('Compose_Email_Body'),'Alert:</b>')),'<br>')))"),
    Compose_Resource: compose("@trim(replace(replace(replace(first(split(last(split(outputs('Compose_Email_Body'),'Resource:')),'<br>')),'<b>',''),'</b>',''),'•',''))", 'Compose_Alert_Name'),
    Compose_Resolved_At_Raw: compose("@if(contains(outputs('Compose_Email_Body'),'Resolved At:</b>'),trim(first(split(last(split(outputs('Compose_Email_Body'),'Resolved At:</b>')),'<br>'))),'')", 'Compose_Resource'),
    Compose_Resolved_At: compose("@if(greaterOrEquals(length(outputs('Compose_Resolved_At_Raw')),16),concat(substring(outputs('Compose_Resolved_At_Raw'),6,4),'-',substring(outputs('Compose_Resolved_At_Raw'),3,2),'-',substring(outputs('Compose_Resolved_At_Raw'),0,2),'T',substring(outputs('Compose_Resolved_At_Raw'),11,5),':00+07:00'),coalesce(items('For_Each_RESOLVED_Email')?['receivedDateTime'],utcNow()))", 'Compose_Resolved_At_Raw'),
    Get_Already_Processed_Message: sharePointGet("@concat('LastSourceMessageId eq ''',replace(outputs('Compose_Message_Id'),'''',''''''),'''')", 'ID desc', 1, 'Compose_Resolved_At'),
    Condition_Message_Not_Processed: {
      type: 'If',
      runAfter: { Get_Already_Processed_Message: ['Succeeded'] },
      expression: { and: [{ equals: ["@length(body('Get_Already_Processed_Message')?['value'])", 0] }] },
      actions: {
        Get_Matching_Open_FIRING: sharePointGet("@concat('Title eq ''',replace(outputs('Compose_Alert_Name'),'''',''''''),''' and Resource eq ''',replace(outputs('Compose_Resource'),'''',''''''),''' and AlertStatus eq ''FIRING'' and ResolvedAt eq null and FirstSeenAt lt ''',outputs('Compose_Resolved_At'),'''')", 'FirstSeenAt desc', 2),
        Condition_Exactly_One_Match: {
          type: 'If',
          runAfter: { Get_Matching_Open_FIRING: ['Succeeded'] },
          expression: { and: [{ equals: ["@length(body('Get_Matching_Open_FIRING')?['value'])", 1] }] },
          actions: {
            Update_Matching_Incident_RESOLVED: openApi('shared_sharepointonline', 'shared_sharepointonline', 'PatchItem', {
              dataset: SITE, table: LIST,
              id: "@first(body('Get_Matching_Open_FIRING')?['value'])?['ID']",
              'item/IncidentId': "@first(body('Get_Matching_Open_FIRING')?['value'])?['IncidentId']",
              'item/SourceMessageId': "@first(body('Get_Matching_Open_FIRING')?['value'])?['SourceMessageId']",
              'item/ReceivedAt': "@first(body('Get_Matching_Open_FIRING')?['value'])?['ReceivedAt']",
              'item/AlertStatus/Value': 'RESOLVED',
              'item/WorkflowStatus/Value': "@if(or(equals(coalesce(first(body('Get_Matching_Open_FIRING')?['value'])?['WorkflowStatus']?['Value'],first(body('Get_Matching_Open_FIRING')?['value'])?['WorkflowStatus']),'RECEIVED'),equals(coalesce(first(body('Get_Matching_Open_FIRING')?['value'])?['WorkflowStatus']?['Value'],first(body('Get_Matching_Open_FIRING')?['value'])?['WorkflowStatus']),'AWAITING_APPROVAL')),'CANCELLED',coalesce(first(body('Get_Matching_Open_FIRING')?['value'])?['WorkflowStatus']?['Value'],first(body('Get_Matching_Open_FIRING')?['value'])?['WorkflowStatus']))",
              'item/Priority/Value': "@coalesce(first(body('Get_Matching_Open_FIRING')?['value'])?['Priority']?['Value'],first(body('Get_Matching_Open_FIRING')?['value'])?['Priority'])",
              'item/LastSyncedAt': '@utcNow()',
              'item/LastSourceMessageId': "@outputs('Compose_Message_Id')",
              'item/FlowRunId': "@workflow()?['run']?['name']",
              'item/ResolvedAt': "@outputs('Compose_Resolved_At')",
              'item/LastAlertAt': "@coalesce(items('For_Each_RESOLVED_Email')?['receivedDateTime'],utcNow())",
              'item/OccurrenceCount': "@add(int(coalesce(first(body('Get_Matching_Open_FIRING')?['value'])?['OccurrenceCount'],0)),1)"
            })
          },
          else: { actions: {
            Post_Reconciliation_Anomaly_to_Teams: openApi('shared_teams-1', 'shared_teams', 'PostMessageToConversation', {
              poster: 'Flow bot', location: 'Group chat', 'body/recipient': CHAT,
              'body/messageBody': "<p><b>⚠️ ALERT LIFECYCLE RECONCILIATION</b><br><b>Result:</b> @{if(equals(length(body('Get_Matching_Open_FIRING')?['value']),0),'NO MATCH','AMBIGUOUS MATCH')}<br><b>Alert:</b> @{outputs('Compose_Alert_Name')}<br><b>Resource:</b> @{outputs('Compose_Resource')}<br><b>Resolved at:</b> @{outputs('Compose_Resolved_At')}<br><b>Matches:</b> @{length(body('Get_Matching_Open_FIRING')?['value'])}<br>No incident was changed. Please review Operations Hub.</p>"
            })
          } },
          expression: { and: [{ equals: ["@length(body('Get_Matching_Open_FIRING')?['value'])", 1] }] }
        }
      },
      else: { actions: {} }
    }
  };
}

function compose(inputs, after) {
  const a = { type: 'Compose', inputs };
  if (after) a.runAfter = { [after]: ['Succeeded'] };
  return a;
}
function openApi(connectionName, api, operationId, parameters) {
  return { type: 'OpenApiConnection', inputs: { parameters, host: { apiId: `/providers/Microsoft.PowerApps/apis/${api}`, connectionName, operationId }, authentication: "@parameters('$authentication')" } };
}
function sharePointGet(filter, orderby, top, after) {
  const a = openApi('shared_sharepointonline', 'shared_sharepointonline', 'GetItems', { dataset: SITE, table: LIST, '$filter': filter, '$orderby': orderby, '$top': top });
  if (after) a.runAfter = { [after]: ['Succeeded'] };
  return a;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
