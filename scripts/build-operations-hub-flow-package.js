const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const stagingRoot = process.argv[2];
if (!stagingRoot) throw new Error('Usage: node build-operations-hub-flow-package.js <extracted-package-directory>');

const flowAssetsRoot = path.join(stagingRoot, 'Microsoft.Flow', 'flows');
const flowFolderName = fs.readdirSync(flowAssetsRoot).find(name => name !== 'manifest.json');
if (!flowFolderName) throw new Error('Power Automate flow asset folder was not found');

const flowFolder = path.join(flowAssetsRoot, flowFolderName);
const definitionPath = path.join(flowFolder, 'definition.json');
const apiMapPath = path.join(flowFolder, 'apisMap.json');
const connectionMapPath = path.join(flowFolder, 'connectionsMap.json');
const packageManifestPath = path.join(stagingRoot, 'manifest.json');

const wrapper = readJson(definitionPath);
const apiMap = readJson(apiMapPath);
const connectionMap = readJson(connectionMapPath);
const packageManifest = readJson(packageManifestPath);

const SITE_URL = 'https://buzzebees.sharepoint.com/sites/ADOAuto-Approve';
const LIST_ID = '5f744c7f-10a3-4ef4-9cf7-f64f65a71851';
const SHAREPOINT_CONNECTION = 'shared_sharepointonline';
const CONVERSION_CONNECTION = 'shared_conversionservice';
const FLOW_DISPLAY_NAME = 'Operations Hub - Incident Automation v2.7';
const APPROVER_EMAIL = 'kiattisak.yo@buzzebees.com';
const OUTLOOK_FOLDER_NAME = 'AzureAppServiceHigh5xxRateCritical';
const OUTLOOK_FOLDER_PATH = 'Id::AAMkADE0OWVjYjA5LWIyMDMtNDhjYS04ZDhjLWNkMWFhYzJiYWQyOQAuAAAAAAC8C8XS08R9Trfz1GrYHZKbAQBshOktFlHmSY3OPI6jffd6AAW8jkwhAAA=';

const sharePointApiResourceId = crypto.randomUUID();
const sharePointConnectionResourceId = crypto.randomUUID();
const conversionApiResourceId = crypto.randomUUID();
const conversionConnectionResourceId = crypto.randomUUID();
const newFlowId = crypto.randomUUID();

const workflow = wrapper.properties.definition;
workflow.contentVersion = '2.7.0.0';
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
workflow.metadata.provisioningMethod = 'FromDefinition';
configureEmailTrigger();
workflow.actions = buildActions();

wrapper.name = newFlowId;
wrapper.id = `/providers/Microsoft.Flow/flows/${newFlowId}`;
wrapper.properties.displayName = FLOW_DISPLAY_NAME;
wrapper.properties.connectionReferences[SHAREPOINT_CONNECTION] = {
  connectionName: `shared-sharepointonl-${crypto.randomUUID()}`,
  source: 'Embedded',
  id: '/providers/Microsoft.PowerApps/apis/shared_sharepointonline',
  tier: 'NotSpecified',
  apiName: 'sharepointonline',
  isProcessSimpleApiReferenceConversionAlreadyDone: false
};
wrapper.properties.connectionReferences[CONVERSION_CONNECTION] = {
  connectionName: `shared-conversionservice-${crypto.randomUUID()}`,
  source: 'Embedded',
  id: '/providers/Microsoft.PowerApps/apis/shared_conversionservice',
  tier: 'NotSpecified',
  apiName: 'conversionservice',
  isProcessSimpleApiReferenceConversionAlreadyDone: false
};

apiMap[SHAREPOINT_CONNECTION] = sharePointApiResourceId;
connectionMap[SHAREPOINT_CONNECTION] = sharePointConnectionResourceId;
apiMap[CONVERSION_CONNECTION] = conversionApiResourceId;
connectionMap[CONVERSION_CONNECTION] = conversionConnectionResourceId;

packageManifest.details.displayName = FLOW_DISPLAY_NAME;
packageManifest.details.description = 'P1 App Service FIRING/RESOLVED intake with Content Conversion HTML-to-text normalization, a single approver, UTC SharePoint timestamps, and guarded Azure DevOps creation.';
packageManifest.details.createdTime = new Date().toISOString();
packageManifest.details.packageTelemetryId = crypto.randomUUID();

const flowResource = packageManifest.resources[flowFolderName];
flowResource.suggestedCreationType = 'New';
flowResource.creationType = 'New';
flowResource.details.displayName = FLOW_DISPLAY_NAME;
flowResource.dependsOn = Array.from(new Set([
  ...flowResource.dependsOn,
  sharePointApiResourceId,
  sharePointConnectionResourceId,
  conversionApiResourceId,
  conversionConnectionResourceId
]));

packageManifest.resources[sharePointApiResourceId] = {
  id: '/providers/Microsoft.PowerApps/apis/shared_sharepointonline',
  name: 'shared_sharepointonline',
  type: 'Microsoft.PowerApps/apis',
  suggestedCreationType: 'Existing',
  details: {
    displayName: 'SharePoint',
    iconUri: 'https://connectoricons-prod.azureedge.net/releases/v1.0.1685/1.0.1685.3700/sharepointonline/icon.png'
  },
  configurableBy: 'System',
  hierarchy: 'Child',
  dependsOn: []
};

packageManifest.resources[sharePointConnectionResourceId] = {
  type: 'Microsoft.PowerApps/apis/connections',
  suggestedCreationType: 'Existing',
  creationType: 'Existing',
  details: {
    displayName: 'SharePoint connection',
    iconUri: 'https://connectoricons-prod.azureedge.net/releases/v1.0.1685/1.0.1685.3700/sharepointonline/icon.png'
  },
  configurableBy: 'User',
  hierarchy: 'Child',
  dependsOn: [sharePointApiResourceId]
};

packageManifest.resources[conversionApiResourceId] = {
  id: '/providers/Microsoft.PowerApps/apis/shared_conversionservice',
  name: 'shared_conversionservice',
  type: 'Microsoft.PowerApps/apis',
  suggestedCreationType: 'Existing',
  details: {
    displayName: 'Content Conversion',
    iconUri: 'https://connectoricons-prod.azureedge.net/releases/v1.0.1685/1.0.1685.3700/conversionservice/icon.png'
  },
  configurableBy: 'System',
  hierarchy: 'Child',
  dependsOn: []
};

packageManifest.resources[conversionConnectionResourceId] = {
  type: 'Microsoft.PowerApps/apis/connections',
  suggestedCreationType: 'Existing',
  creationType: 'Existing',
  details: {
    displayName: 'Content Conversion connection',
    iconUri: 'https://connectoricons-prod.azureedge.net/releases/v1.0.1685/1.0.1685.3700/conversionservice/icon.png'
  },
  configurableBy: 'User',
  hierarchy: 'Child',
  dependsOn: [conversionApiResourceId]
};

writeJson(definitionPath, wrapper);
writeJson(apiMapPath, apiMap);
writeJson(connectionMapPath, connectionMap);
writeJson(packageManifestPath, packageManifest);

function configureEmailTrigger() {
  const trigger = workflow.triggers && workflow.triggers['When_a_new_email_arrives_(V3)'];
  if (!trigger) throw new Error('When a new email arrives (V3) trigger was not found');

  trigger.inputs.parameters.folderPath = OUTLOOK_FOLDER_PATH;
  delete trigger.inputs.parameters.subjectFilter;
  trigger.metadata = { [OUTLOOK_FOLDER_PATH]: OUTLOOK_FOLDER_NAME };
}

function buildActions() {
  const processActions = {
    Compose_SourceMessageId: compose("@coalesce(triggerOutputs()?['body/internetMessageId'], triggerOutputs()?['body/id'])"),
    Get_items_by_MessageId: sharePoint('GetItems', {
      dataset: SITE_URL,
      table: LIST_ID,
      '$filter': "@concat('(SourceMessageId eq ''',replace(outputs('Compose_SourceMessageId'),'''',''''''),''' or LastSourceMessageId eq ''',replace(outputs('Compose_SourceMessageId'),'''',''''''),''')')",
      '$top': 1
    }, after('Compose_SourceMessageId')),
    Condition_Message_Already_Processed: condition(
      { and: [{ greater: ["@length(body('Get_items_by_MessageId')?['value'])", 0] }] },
      {
        Terminate_Duplicate_Message: terminate('Succeeded', 'Duplicate email ignored because SourceMessageId is already present in SharePoint.')
      },
      buildNewMessageActions(),
      after('Get_items_by_MessageId')
    )
  };

  return {
    // The template language has no htmlToText() function.  Use the supported
    // Content Conversion connector, then normalize its text newlines for parsing.
    Compose_EmailBody: compose("@triggerOutputs()?['body/body']"),
    Html_to_text: conversionHtmlToText("@outputs('Compose_EmailBody')", after('Compose_EmailBody')),
    Compose_NormalizedEmailBody: compose("@replace(replace(body('Html_to_text'),decodeUriComponent('%0D'),''),decodeUriComponent('%0A'),'|')", after('Html_to_text')),
    Scope_Process_Incident: {
      type: 'Scope',
      actions: processActions,
      runAfter: after('Compose_NormalizedEmailBody')
    },
    Scope_Handle_Technical_Failure: {
      type: 'Scope',
      actions: {
        Create_FAILED_incident: sharePoint('PostItem', {
          dataset: SITE_URL,
          table: LIST_ID,
          'item/Title': "@triggerOutputs()?['body/subject']",
          'item/IncidentId': "@concat('FAILED-', guid())",
          'item/SourceMessageId': "@coalesce(triggerOutputs()?['body/internetMessageId'], triggerOutputs()?['body/id'])",
          'item/LastSourceMessageId': "@coalesce(triggerOutputs()?['body/internetMessageId'], triggerOutputs()?['body/id'])",
          'item/AlertStatus/Value': "@if(contains(toUpper(triggerOutputs()?['body/subject']),'RESOLVED'),'RESOLVED','FIRING')",
          'item/WorkflowStatus/Value': 'FAILED',
          'item/Priority/Value': 'P1',
          'item/ReceivedAt': "@coalesce(triggerOutputs()?['body/receivedDateTime'], utcNow())",
          'item/LastAlertAt': '@utcNow()',
          'item/LastSyncedAt': '@utcNow()',
          'item/FlowRunId': "@workflow()?['run']?['name']",
          'item/OccurrenceCount': 1,
          'item/ErrorDetail': "@concat('Technical failure in Flow 1. RunId: ', workflow()?['run']?['name'])"
        }),
        Post_normalized_failure_to_Teams: teamsMessage(
          "<p><b>⚠️ Operations Hub Flow 1 failed</b><br><b>Subject:</b> @{triggerOutputs()?['body/subject']}<br><b>Run ID:</b> @{workflow()?['run']?['name']}<br>The failure was recorded in SharePoint.</p>",
          { Create_FAILED_incident: ['Succeeded', 'Failed', 'TimedOut'] }
        )
      },
      runAfter: { Scope_Process_Incident: ['Failed', 'TimedOut'] }
    }
  };
}

function buildNewMessageActions() {
  return {
    Compose_IsFiring: compose("@contains(toUpper(triggerOutputs()?['body/subject']),'ALERT FIRING')"),
    Compose_IsResolved: compose("@contains(toUpper(triggerOutputs()?['body/subject']),'RESOLVED')", after('Compose_IsFiring')),
    Compose_AlertName: compose(parseField('Alert:'), after('Compose_IsResolved')),
    Compose_Resource: compose(parseField('Resource:'), after('Compose_AlertName')),
    Compose_SeverityPriority: compose(parseField('Severity:'), after('Compose_Resource')),
    Compose_Severity: compose("@toUpper(trim(first(split(outputs('Compose_SeverityPriority'),'/'))))", after('Compose_SeverityPriority')),
    Compose_Priority: compose("@toUpper(if(contains(outputs('Compose_SeverityPriority'),'/'),trim(last(split(outputs('Compose_SeverityPriority'),'/'))),'UNKNOWN'))", after('Compose_Severity')),
    Condition_Is_Supported_P1: condition(
      { and: [
        { equals: ["@outputs('Compose_Priority')", 'P1'] },
        { or: [
          { equals: ["@outputs('Compose_IsFiring')", true] },
          { equals: ["@outputs('Compose_IsResolved')", true] }
        ] }
      ] },
      buildSupportedCriticalActions(),
      {
        Terminate_Unsupported_or_Noncritical_Email: terminate('Succeeded', 'Ignored: only ALERT FIRING or RESOLVED with CRITICAL / P1 is in scope.')
      },
      after('Compose_Priority')
    )
  };
}

function buildSupportedCriticalActions() {
  return {
    Compose_Subscription: compose(parseField('Subscription:')),
    Compose_ResourceGroup: compose(parseField('Resource Group:'), after('Compose_Subscription')),
    Compose_AppServicePlan: compose(parseField('Plan:'), after('Compose_ResourceGroup')),
    Compose_DefaultHost: compose(parseField('Default Host:'), after('Compose_AppServicePlan')),
    Compose_Metric: compose(parseField('Metric:'), after('Compose_DefaultHost')),
    Compose_CurrentValue: compose(parseField('Current Value:'), after('Compose_Metric')),
    Compose_ThresholdDetail: compose(parseField('Threshold:'), after('Compose_CurrentValue')),
    Compose_AlertSummary: compose(parseField('Summary:'), after('Compose_ThresholdDetail')),
    Compose_FirstSeenRaw: compose(parseField('First Seen:'), after('Compose_AlertSummary')),
    Compose_FirstSeenAt: compose(toUtcIso('Compose_FirstSeenRaw'), after('Compose_FirstSeenRaw')),
    Compose_FirstSeenDisplay: compose(toBangkokDisplay('Compose_FirstSeenAt'), after('Compose_FirstSeenAt')),
    Compose_Environment: compose(
      "@if(startsWith(toLower(outputs('Compose_Resource')),'prd-'),'Production',if(startsWith(toLower(outputs('Compose_Resource')),'stg-'),'Staging',if(startsWith(toLower(outputs('Compose_Resource')),'uat-'),'UAT',if(startsWith(toLower(outputs('Compose_Resource')),'dev-'),'Development','Unknown'))))",
      after('Compose_FirstSeenDisplay')
    ),
    Compose_IncidentId: compose(
      "@toLower(concat('INC-',formatDateTime(outputs('Compose_FirstSeenAt'),'yyyyMMddHHmmss'),'-',replace(replace(outputs('Compose_Resource'),' ','-'),'/','-'),'-',replace(replace(outputs('Compose_AlertName'),' ','-'),'/','-')))" ,
      after('Compose_Environment')
    ),
    Condition_Is_RESOLVED: condition(
      { and: [{ equals: ["@outputs('Compose_IsResolved')", true] }] },
      buildResolvedActions(),
      buildFiringActions(),
      after('Compose_IncidentId')
    )
  };
}

function buildResolvedActions() {
  return {
    Compose_ResolvedAtRaw: compose(parseField('Resolved At:')),
    Compose_ResolvedAt: compose(toUtcIso('Compose_ResolvedAtRaw'), after('Compose_ResolvedAtRaw')),
    Compose_ResolvedAtDisplay: compose(toBangkokDisplay('Compose_ResolvedAt'), after('Compose_ResolvedAt')),
    Get_latest_open_FIRING: sharePoint('GetItems', {
      dataset: SITE_URL,
      table: LIST_ID,
      '$filter': "@concat('Title eq ''',replace(outputs('Compose_AlertName'),'''',''''''),''' and Resource eq ''',replace(outputs('Compose_Resource'),'''',''''''),''' and AlertStatus eq ''FIRING'' and ResolvedAt eq null and FirstSeenAt lt ''',outputs('Compose_ResolvedAt'),'''')",
      '$orderby': 'FirstSeenAt desc',
      '$top': 1
    }, after('Compose_ResolvedAtDisplay')),
    Condition_Matching_FIRING_Found: condition(
      { and: [{ greater: ["@length(body('Get_latest_open_FIRING')?['value'])", 0] }] },
      {
        Update_matching_incident_RESOLVED: sharePoint('PatchItem', {
          dataset: SITE_URL,
          table: LIST_ID,
          id: "@first(body('Get_latest_open_FIRING')?['value'])?['ID']",
          ...requiredFetchedIncidentFields('Get_latest_open_FIRING'),
          'item/AlertStatus/Value': 'RESOLVED',
          'item/WorkflowStatus/Value': "@if(or(equals(coalesce(first(body('Get_latest_open_FIRING')?['value'])?['WorkflowStatus']?['Value'],first(body('Get_latest_open_FIRING')?['value'])?['WorkflowStatus']),'RECEIVED'),equals(coalesce(first(body('Get_latest_open_FIRING')?['value'])?['WorkflowStatus']?['Value'],first(body('Get_latest_open_FIRING')?['value'])?['WorkflowStatus']),'AWAITING_APPROVAL')),'CANCELLED',coalesce(first(body('Get_latest_open_FIRING')?['value'])?['WorkflowStatus']?['Value'],first(body('Get_latest_open_FIRING')?['value'])?['WorkflowStatus']))",
          'item/ResolvedAt': "@outputs('Compose_ResolvedAt')",
          'item/LastAlertAt': '@utcNow()',
          'item/LastSourceMessageId': "@outputs('Compose_SourceMessageId')",
          'item/OccurrenceCount': "@add(int(coalesce(first(body('Get_latest_open_FIRING')?['value'])?['OccurrenceCount'],0)),1)",
          'item/LastSyncedAt': '@utcNow()',
          'item/FlowRunId': "@workflow()?['run']?['name']"
        }),
        Post_RESOLVED_to_Teams: teamsMessage(resolvedTeamsBody(false), after('Update_matching_incident_RESOLVED'))
      },
      {
        Create_unmatched_RESOLVED_as_CANCELLED: sharePoint('PostItem', {
          ...baseIncidentFields(),
          'item/AlertStatus/Value': 'RESOLVED',
          'item/WorkflowStatus/Value': 'CANCELLED',
          'item/ResolvedAt': "@outputs('Compose_ResolvedAt')",
          'item/ErrorDetail': 'RESOLVED received without a matching FIRING incident; recorded as CANCELLED.'
        }),
        Post_unmatched_RESOLVED_to_Teams: teamsMessage(resolvedTeamsBody(true), after('Create_unmatched_RESOLVED_as_CANCELLED'))
      },
      after('Get_latest_open_FIRING')
    )
  };
}

function buildFiringActions() {
  return {
    Get_items_by_IncidentId: sharePoint('GetItems', {
      dataset: SITE_URL,
      table: LIST_ID,
      '$filter': "@concat('IncidentId eq ''',replace(outputs('Compose_IncidentId'),'''',''''''),'''')",
      '$top': 1
    }),
    Condition_FIRING_Incident_Exists: condition(
      { and: [{ greater: ["@length(body('Get_items_by_IncidentId')?['value'])", 0] }] },
      {
        Update_repeated_FIRING: sharePoint('PatchItem', {
          dataset: SITE_URL,
          table: LIST_ID,
          id: "@first(body('Get_items_by_IncidentId')?['value'])?['ID']",
          ...requiredFetchedIncidentFields('Get_items_by_IncidentId'),
          'item/LastAlertAt': '@utcNow()',
          'item/LastSourceMessageId': "@outputs('Compose_SourceMessageId')",
          'item/OccurrenceCount': "@add(int(coalesce(first(body('Get_items_by_IncidentId')?['value'])?['OccurrenceCount'],0)),1)",
          'item/LastSyncedAt': '@utcNow()',
          'item/FlowRunId': "@workflow()?['run']?['name']"
        }),
        Post_repeated_FIRING_to_Teams: teamsMessage(firingTeamsBody('Repeated alert; existing incident updated.'), after('Update_repeated_FIRING'))
      },
      buildNewFiringActions(),
      after('Get_items_by_IncidentId')
    )
  };
}

function buildNewFiringActions() {
  return {
    Create_FIRING_incident: sharePoint('PostItem', {
      ...baseIncidentFields(),
      'item/AlertStatus/Value': 'FIRING',
      'item/WorkflowStatus/Value': 'RECEIVED'
    }),
    Post_FIRING_to_Teams: teamsMessage(firingTeamsBody('New incident recorded; approval will be requested.'), after('Create_FIRING_incident')),
    Update_incident_AWAITING_APPROVAL: sharePoint('PatchItem', {
      dataset: SITE_URL,
      table: LIST_ID,
      id: "@body('Create_FIRING_incident')?['ID']",
      ...requiredCreatedIncidentFields('AWAITING_APPROVAL'),
      'item/ApprovalAttempt': 1,
      'item/ApprovalRequestedAt': '@utcNow()',
      'item/LastSyncedAt': '@utcNow()'
    }, after('Post_FIRING_to_Teams')),
    Start_and_wait_for_an_approval: {
      type: 'OpenApiConnectionWebhook',
      limit: { timeout: 'PT15M' },
      inputs: {
        parameters: {
          approvalType: 'Basic',
          'WebhookApprovalCreationInput/title': "Review incident @{outputs('Compose_IncidentId')} | @{outputs('Compose_AlertName')}",
          'WebhookApprovalCreationInput/assignedTo': APPROVER_EMAIL,
          'WebhookApprovalCreationInput/details': "Alert: @{outputs('Compose_AlertName')}\nResource: @{outputs('Compose_Resource')}\nEnvironment: @{outputs('Compose_Environment')}\nSeverity / Priority: @{outputs('Compose_Severity')} / @{outputs('Compose_Priority')}\nMetric: @{outputs('Compose_Metric')}\nCurrent value: @{outputs('Compose_CurrentValue')}\nThreshold: @{outputs('Compose_ThresholdDetail')}\nFirst seen (Asia/Bangkok): @{outputs('Compose_FirstSeenDisplay')}\nIncident ID: @{outputs('Compose_IncidentId')}",
          'WebhookApprovalCreationInput/enableNotifications': true,
          'WebhookApprovalCreationInput/enableReassignment': true
        },
        host: connectorHost('shared_approvals', 'StartAndWaitForAnApproval'),
        authentication: "@parameters('$authentication')"
      },
      runAfter: after('Update_incident_AWAITING_APPROVAL')
    },
    Compose_ApprovalResult: compose(
      "@if(equals(actions('Start_and_wait_for_an_approval')?['status'],'Succeeded'),coalesce(body('Start_and_wait_for_an_approval')?['outcome'],'Reject'),if(equals(actions('Start_and_wait_for_an_approval')?['status'],'TimedOut'),'Timeout','Error'))",
      { Start_and_wait_for_an_approval: ['Succeeded', 'TimedOut', 'Failed'] }
    ),
    Get_incident_for_approval_metadata: sharePoint('GetItem', {
      dataset: SITE_URL,
      table: LIST_ID,
      id: "@body('Create_FIRING_incident')?['ID']"
    }, after('Compose_ApprovalResult')),
    Update_approval_metadata: sharePoint('PatchItem', {
      dataset: SITE_URL,
      table: LIST_ID,
      id: "@body('Create_FIRING_incident')?['ID']",
      ...requiredGetItemFields('Get_incident_for_approval_metadata'),
      'item/ApprovalOutcome': "@outputs('Compose_ApprovalResult')",
      'item/ApprovalId': "@coalesce(body('Start_and_wait_for_an_approval')?['approvalId'],body('Start_and_wait_for_an_approval')?['id'],'')",
      'item/ApprovalBy': "@coalesce(first(body('Start_and_wait_for_an_approval')?['responses'])?['responder']?['displayName'],'')",
      'item/ApprovalComment': "@coalesce(first(body('Start_and_wait_for_an_approval')?['responses'])?['comments'],'')",
      'item/ApprovalCompletedAt': '@utcNow()',
      'item/LastSyncedAt': '@utcNow()'
    }, after('Get_incident_for_approval_metadata')),
    Condition_Approved: condition(
      { and: [{ equals: ["@toLower(outputs('Compose_ApprovalResult'))", 'approve'] }] },
      buildApprovedActions(),
      buildNotApprovedActions(),
      after('Update_approval_metadata')
    )
  };
}

function buildApprovedActions() {
  return {
    Recheck_incident_before_ADO: sharePoint('GetItem', {
      dataset: SITE_URL,
      table: LIST_ID,
      id: "@body('Create_FIRING_incident')?['ID']"
    }),
    Condition_Incident_still_active: condition(
      { and: [
        { not: { equals: ["@coalesce(body('Recheck_incident_before_ADO')?['AlertStatus']?['Value'],body('Recheck_incident_before_ADO')?['AlertStatus'])", 'RESOLVED'] } },
        { not: { equals: ["@coalesce(body('Recheck_incident_before_ADO')?['WorkflowStatus']?['Value'],body('Recheck_incident_before_ADO')?['WorkflowStatus'])", 'CANCELLED'] } },
        { equals: ["@empty(body('Recheck_incident_before_ADO')?['AdoWorkItemId'])", true] }
      ] },
      {
        Create_Azure_DevOps_work_item: {
          type: 'OpenApiConnection',
          inputs: {
            parameters: {
              account: 'buzzebees',
              project: 'Buzzebees',
              type: 'IT Support Case',
              'workItem/title': "[INC-@{formatDateTime(outputs('Compose_FirstSeenAt'),'yyyy')}-@{formatNumber(int(body('Create_FIRING_incident')?['ID']),'000000')}] @{outputs('Compose_AlertName')} | @{outputs('Compose_Resource')}",
              'workItem/description': "<p><b>Case ID:</b> INC-@{formatDateTime(outputs('Compose_FirstSeenAt'),'yyyy')}-@{formatNumber(int(body('Create_FIRING_incident')?['ID']),'000000')}</p><p><b>Alert:</b> @{outputs('Compose_AlertName')}</p><p><b>Resource:</b> @{outputs('Compose_Resource')}<br><b>Environment:</b> @{outputs('Compose_Environment')}<br><b>Severity / Priority:</b> @{outputs('Compose_Severity')} / @{outputs('Compose_Priority')}<br><b>Metric:</b> @{outputs('Compose_Metric')}<br><b>Current value:</b> @{outputs('Compose_CurrentValue')}<br><b>Threshold:</b> @{outputs('Compose_ThresholdDetail')}<br><b>First seen (Asia/Bangkok):</b> @{outputs('Compose_FirstSeenDisplay')}<br><b>Incident ID:</b> @{outputs('Compose_IncidentId')}<br><b>Platform:</b> Azure App Service<br><b>App Service Plan:</b> @{outputs('Compose_AppServicePlan')}<br><b>Default Host:</b> @{outputs('Compose_DefaultHost')}</p>",
              'workItem/area': 'Buzzebees\\Other\\IT Support Team',
              'workItem/userEnteredFields': {
                'Impact Case': 'User Request',
                SystemProgram: 'Support Request',
                TYPE_ALL: 'Problem Server',
                SUBTYPE: 'Problem Server',
                Owner: 'Poon',
                'Assigned to': 'natthakit@buzzebees.com',
                'Priority Case': '2-High'
              },
              'workItem/dynamicFields/Custom.Permission': 'None',
              'workItem/dynamicFields/System.Tags': 'ITSupport_Pool;ITSupport-ProblemServer;ITSupport-AutoCreateIncidentCase'
            },
            host: connectorHost('shared_visualstudioteamservices', 'CreateWorkItem'),
            authentication: "@parameters('$authentication')"
          }
        },
        Update_incident_CREATED: sharePoint('PatchItem', {
          dataset: SITE_URL,
          table: LIST_ID,
          id: "@body('Create_FIRING_incident')?['ID']",
          ...requiredCreatedIncidentFields('CREATED'),
          'item/AdoWorkItemId': "@body('Create_Azure_DevOps_work_item')?['id']",
          'item/AdoWorkItemUrl': "@coalesce(body('Create_Azure_DevOps_work_item')?['_links']?['html']?['href'],body('Create_Azure_DevOps_work_item')?['url'],'')",
          'item/AdoState': "@coalesce(body('Create_Azure_DevOps_work_item')?['fields']?['System.State'],'New')",
          'item/AssignedTo': 'natthakit@buzzebees.com',
          'item/AdoCreatedAt': '@utcNow()',
          'item/LastSyncedAt': '@utcNow()'
        }, after('Create_Azure_DevOps_work_item'))
      },
      {
        Update_approval_cancelled_by_RESOLVED: sharePoint('PatchItem', {
          dataset: SITE_URL,
          table: LIST_ID,
          id: "@body('Create_FIRING_incident')?['ID']",
          ...requiredGetItemFields('Recheck_incident_before_ADO'),
          'item/WorkflowStatus/Value': 'CANCELLED',
          'item/ApprovalOutcome': 'CancelledByResolved',
          'item/LastSyncedAt': '@utcNow()'
        })
      },
      after('Recheck_incident_before_ADO')
    )
  };
}

function buildNotApprovedActions() {
  return {
    Get_incident_before_not_approved_update: sharePoint('GetItem', {
      dataset: SITE_URL,
      table: LIST_ID,
      id: "@body('Create_FIRING_incident')?['ID']"
    }),
    Condition_Rejected: condition(
      { and: [{ equals: ["@toLower(outputs('Compose_ApprovalResult'))", 'reject'] }] },
      {
        Update_incident_REJECTED: sharePoint('PatchItem', {
          dataset: SITE_URL,
          table: LIST_ID,
          id: "@body('Create_FIRING_incident')?['ID']",
          ...requiredGetItemFields('Get_incident_before_not_approved_update'),
          'item/WorkflowStatus/Value': 'REJECTED',
          'item/LastSyncedAt': '@utcNow()'
        })
      },
      {
        Condition_Approval_Timed_Out: condition(
          { and: [{ equals: ["@outputs('Compose_ApprovalResult')", 'Timeout'] }] },
          {
            Update_incident_APPROVAL_TIMEOUT: sharePoint('PatchItem', {
              dataset: SITE_URL,
              table: LIST_ID,
              id: "@body('Create_FIRING_incident')?['ID']",
              ...requiredGetItemFields('Get_incident_before_not_approved_update'),
              'item/WorkflowStatus/Value': 'CANCELLED',
              'item/ApprovalOutcome': 'Timeout',
              'item/LastSyncedAt': '@utcNow()',
              'item/ErrorDetail': 'Approval expired after 15 minutes; no ADO work item was created.'
            })
          },
          {
            Update_incident_APPROVAL_ERROR: sharePoint('PatchItem', {
              dataset: SITE_URL,
              table: LIST_ID,
              id: "@body('Create_FIRING_incident')?['ID']",
              ...requiredGetItemFields('Get_incident_before_not_approved_update'),
              'item/WorkflowStatus/Value': 'FAILED',
              'item/ApprovalOutcome': 'Error',
              'item/LastSyncedAt': '@utcNow()',
              'item/ErrorDetail': 'Approval connector failed; no ADO work item was created.'
            })
          }
        )
      },
      after('Get_incident_before_not_approved_update')
    )
  };
}

function baseIncidentFields() {
  return {
    dataset: SITE_URL,
    table: LIST_ID,
    'item/Title': "@outputs('Compose_AlertName')",
    'item/IncidentId': "@outputs('Compose_IncidentId')",
    'item/SourceMessageId': "@outputs('Compose_SourceMessageId')",
    'item/LastSourceMessageId': "@outputs('Compose_SourceMessageId')",
    'item/Priority/Value': "@outputs('Compose_Priority')",
    'item/Service': "@outputs('Compose_AlertName')",
    'item/Resource': "@outputs('Compose_Resource')",
    'item/Environment': "@outputs('Compose_Environment')",
    'item/Metric': "@outputs('Compose_Metric')",
    'item/Severity': "@outputs('Compose_Severity')",
    'item/ReceivedAt': "@coalesce(triggerOutputs()?['body/receivedDateTime'], utcNow())",
    'item/FirstSeenAt': "@outputs('Compose_FirstSeenAt')",
    'item/LastAlertAt': '@utcNow()',
    'item/OccurrenceCount': 1,
    'item/FlowRunId': "@workflow()?['run']?['name']",
    'item/Subscription': "@outputs('Compose_Subscription')",
    'item/ResourceGroup': "@outputs('Compose_ResourceGroup')",
    'item/AppServicePlan': "@outputs('Compose_AppServicePlan')",
    'item/DefaultHost': "@outputs('Compose_DefaultHost')",
    'item/CurrentValue': "@outputs('Compose_CurrentValue')",
    'item/ThresholdDetail': "@outputs('Compose_ThresholdDetail')",
    'item/AlertSummary': "@outputs('Compose_AlertSummary')",
    'item/LastSyncedAt': '@utcNow()'
  };
}

function requiredCreatedIncidentFields(workflowStatus) {
  return {
    'item/IncidentId': "@outputs('Compose_IncidentId')",
    'item/SourceMessageId': "@outputs('Compose_SourceMessageId')",
    'item/AlertStatus/Value': 'FIRING',
    'item/WorkflowStatus/Value': workflowStatus,
    'item/Priority/Value': "@outputs('Compose_Priority')",
    'item/ReceivedAt': "@coalesce(triggerOutputs()?['body/receivedDateTime'], utcNow())"
  };
}

function requiredFetchedIncidentFields(getItemsAction) {
  const item = `first(body('${getItemsAction}')?['value'])`;
  return {
    'item/IncidentId': `@${item}?['IncidentId']`,
    'item/SourceMessageId': `@${item}?['SourceMessageId']`,
    'item/AlertStatus/Value': `@coalesce(${item}?['AlertStatus']?['Value'],${item}?['AlertStatus'])`,
    'item/WorkflowStatus/Value': `@coalesce(${item}?['WorkflowStatus']?['Value'],${item}?['WorkflowStatus'])`,
    'item/Priority/Value': `@coalesce(${item}?['Priority']?['Value'],${item}?['Priority'])`,
    'item/ReceivedAt': `@${item}?['ReceivedAt']`
  };
}

function requiredGetItemFields(getItemAction) {
  const item = `body('${getItemAction}')`;
  return {
    'item/IncidentId': `@${item}?['IncidentId']`,
    'item/SourceMessageId': `@${item}?['SourceMessageId']`,
    'item/AlertStatus/Value': `@coalesce(${item}?['AlertStatus']?['Value'],${item}?['AlertStatus'])`,
    'item/WorkflowStatus/Value': `@coalesce(${item}?['WorkflowStatus']?['Value'],${item}?['WorkflowStatus'])`,
    'item/Priority/Value': `@coalesce(${item}?['Priority']?['Value'],${item}?['Priority'])`,
    'item/ReceivedAt': `@${item}?['ReceivedAt']`
  };
}

function firingTeamsBody(note) {
  return `<p><b>🔥 ALERT FIRING</b><br><b>Alert:</b> @{outputs('Compose_AlertName')}<br><b>Resource:</b> @{outputs('Compose_Resource')}<br><b>Environment:</b> @{outputs('Compose_Environment')}<br><b>Severity / Priority:</b> @{outputs('Compose_Severity')} / @{outputs('Compose_Priority')}<br><b>Metric:</b> @{outputs('Compose_Metric')}<br><b>Current value:</b> @{outputs('Compose_CurrentValue')}<br><b>First seen (Asia/Bangkok):</b> @{outputs('Compose_FirstSeenDisplay')}<br><b>Incident ID:</b> @{outputs('Compose_IncidentId')}<br>${note}</p>`;
}

function resolvedTeamsBody(unmatched) {
  const note = unmatched ? 'No matching FIRING was found; recorded as CANCELLED.' : 'The matching incident was updated.';
  return `<p><b>✅ RESOLVED</b><br><b>Alert:</b> @{outputs('Compose_AlertName')}<br><b>Resource:</b> @{outputs('Compose_Resource')}<br><b>Environment:</b> @{outputs('Compose_Environment')}<br><b>First seen (Asia/Bangkok):</b> @{outputs('Compose_FirstSeenDisplay')}<br><b>Resolved at (Asia/Bangkok):</b> @{outputs('Compose_ResolvedAtDisplay')}<br>${note}</p>`;
}

function parseField(marker) {
  return `@if(contains(outputs('Compose_NormalizedEmailBody'),'${marker}'),trim(first(split(last(split(outputs('Compose_NormalizedEmailBody'),'${marker}')),'|'))),'')`;
}

function toUtcIso(actionName) {
  return `@convertToUtc(concat(substring(outputs('${actionName}'),6,4),'-',substring(outputs('${actionName}'),3,2),'-',substring(outputs('${actionName}'),0,2),'T',substring(outputs('${actionName}'),11,5),':00'),'SE Asia Standard Time','yyyy-MM-ddTHH:mm:ssZ')`;
}

function toBangkokDisplay(actionName) {
  return `@convertTimeZone(outputs('${actionName}'),'UTC','SE Asia Standard Time','dd/MM/yyyy HH:mm')`;
}

function compose(inputs, runAfter = {}) {
  return { type: 'Compose', inputs, runAfter };
}

function condition(expression, yesActions, noActions, runAfter = {}) {
  return { type: 'If', expression, actions: yesActions, else: { actions: noActions }, runAfter };
}

function terminate(status, message) {
  const inputs = { runStatus: status };
  if (status === 'Failed') inputs.runError = { message };
  return { type: 'Terminate', inputs, runAfter: {} };
}

function sharePoint(operationId, parameters, runAfter = {}) {
  return {
    type: 'OpenApiConnection',
    inputs: {
      parameters,
      host: connectorHost(SHAREPOINT_CONNECTION, operationId),
      authentication: "@parameters('$authentication')"
    },
    runAfter
  };
}

function conversionHtmlToText(html, runAfter = {}) {
  return {
    type: 'OpenApiConnection',
    inputs: {
      // Content Conversion's HtmlToText operation requires the exact key `Content`.
      parameters: { Content: html },
      host: connectorHost(CONVERSION_CONNECTION, 'HtmlToText'),
      authentication: "@parameters('$authentication')"
    },
    runAfter
  };
}

function teamsMessage(messageBody, runAfter = {}) {
  return {
    type: 'OpenApiConnection',
    inputs: {
      parameters: {
        poster: 'Flow bot',
        location: 'Group chat',
        'body/recipient': '19:a0a8b701b02c469b94f493d1ed9903b9@thread.v2',
        'body/messageBody': messageBody
      },
      host: connectorHost('shared_teams-1', 'PostMessageToConversation'),
      authentication: "@parameters('$authentication')"
    },
    runAfter
  };
}

function connectorHost(connectionName, operationId) {
  const apiNames = {
    shared_sharepointonline: 'shared_sharepointonline',
    shared_conversionservice: 'shared_conversionservice',
    'shared_teams-1': 'shared_teams',
    shared_approvals: 'shared_approvals',
    shared_visualstudioteamservices: 'shared_visualstudioteamservices'
  };
  return {
    apiId: `/providers/Microsoft.PowerApps/apis/${apiNames[connectionName]}`,
    connectionName,
    operationId
  };
}

function after(actionName) {
  return { [actionName]: ['Succeeded'] };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
}
