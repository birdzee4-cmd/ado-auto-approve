const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const POWER_AUTOMATE = path.join(ROOT, 'artifacts', 'power-automate');

buildIncidentAutomation();
buildReconciliation();

function buildIncidentAutomation() {
  const source = path.join(POWER_AUTOMATE, 'v3.7.7-source');
  const target = path.join(POWER_AUTOMATE, 'v3.7.8-staging');
  copyClean(source, target);

  const definitionFile = findDefinition(target);
  const wrapper = readJson(definitionFile);
  const definition = wrapper.properties.definition;
  const conditionApproved = findAction(definition.actions, 'Condition_Approved');
  const createWorkItem = findAction(definition.actions, 'Create_Azure_DevOps_work_item');

  wrapper.properties.displayName = 'Operations Hub - Incident Automation v3.7.8';
  definition.contentVersion = '3.7.8.0';
  createWorkItem.inputs.parameters['workItem/title'] = "[INC-@{formatDateTime(outputs('Compose_FirstSeenAt'),'yyyy')}-@{formatNumber(int(body('Create_FIRING_incident')?['ID']),'000000')}] @{outputs('Compose_AlertName')} | @{outputs('Compose_Resource')}";
  createWorkItem.inputs.parameters['workItem/description'] = "<p><b>Case ID:</b> INC-@{formatDateTime(outputs('Compose_FirstSeenAt'),'yyyy')}-@{formatNumber(int(body('Create_FIRING_incident')?['ID']),'000000')}</p><p><b>Alert:</b> @{outputs('Compose_AlertName')}</p><p><b>Resource:</b> @{outputs('Compose_Resource')}<br><b>Environment:</b> @{outputs('Compose_Environment')}<br><b>Severity / Priority:</b> @{outputs('Compose_Severity')} / @{outputs('Compose_Priority')}<br><b>Metric:</b> @{outputs('Compose_Metric')}<br><b>Current value:</b> @{outputs('Compose_CurrentValue')}<br><b>Threshold:</b> @{outputs('Compose_ThresholdDetail')}<br><b>First seen (Asia/Bangkok):</b> @{outputs('Compose_FirstSeenDisplay')}<br><b>Incident ID:</b> @{outputs('Compose_IncidentId')}</p>";
  conditionApproved.else.actions = {
    Condition_Approval_Explicitly_Rejected: {
      type: 'If',
      expression: {
        or: [
          { equals: ["@toLower(outputs('Compose_ApprovalResult'))", 'reject'] },
          { equals: ["@toLower(outputs('Compose_ApprovalResult'))", 'rejected'] }
        ]
      },
      actions: {
        Update_Rejected_Work_Item: adoUpdate({
          account: 'buzzebees',
          id: "@body('Create_Azure_DevOps_work_item')?['id']",
          project: 'Buzzebees',
          type: 'IT Support Case',
          'workItem/dynamicFields/Custom.ApprovalStatus': 'Reject',
          'workItem/dynamicFields/System.State': 'Reject'
        }),
        Update_Incident_Rejected: sharePointPatch({
          id: "@body('Create_FIRING_incident')?['ID']",
          ...incidentIdentityFields(),
          'item/WorkflowStatus/Value': 'REJECTED',
          'item/Priority/Value': "@outputs('Compose_Priority')",
          'item/ApprovalOutcome': 'Reject',
          'item/ApprovalStatus': 'Rejected',
          'item/AdoWorkItemId': "@body('Create_Azure_DevOps_work_item')?['id']",
          'item/AdoWorkItemUrl': "@outputs('Compose_Work_Item_URL')",
          'item/AdoState': 'Reject',
          'item/LastSyncedAt': '@utcNow()',
          'item/ApprovalCompletedAt': '@utcNow()',
          'item/AdoUpdatedAt': '@utcNow()',
          'item/AdoRevision': "@int(coalesce(body('Update_Rejected_Work_Item')?['rev'],body('Create_Azure_DevOps_work_item')?['rev'],0))",
          'item/ErrorDetail': ''
        }, after('Update_Rejected_Work_Item')),
        Notify_Approval_Rejected: teamsMessage(
          '<p>❌ P1 acknowledgement rejected. Existing Work Item <a href="@{outputs(\'Compose_Work_Item_URL\')}">#@{body(\'Create_Azure_DevOps_work_item\')?[\'id\']}</a> moved to Reject; incident @{outputs(\'Compose_IncidentId\')} is REJECTED.</p>',
          after('Update_Incident_Rejected')
        ),
        Preserve_Rejected_Incident_When_VSTS_Update_Fails: sharePointPatch({
          id: "@body('Create_FIRING_incident')?['ID']",
          ...incidentIdentityFields(),
          'item/WorkflowStatus/Value': 'REJECTED',
          'item/Priority/Value': "@outputs('Compose_Priority')",
          'item/ApprovalOutcome': 'Reject',
          'item/ApprovalStatus': 'Rejected',
          'item/AdoWorkItemId': "@body('Create_Azure_DevOps_work_item')?['id']",
          'item/AdoWorkItemUrl': "@outputs('Compose_Work_Item_URL')",
          'item/AdoState': "@coalesce(body('Create_Azure_DevOps_work_item')?['fields']?['System.State'],'New')",
          'item/LastSyncedAt': '@utcNow()',
          'item/ApprovalCompletedAt': '@utcNow()',
          'item/ErrorDetail': 'Approval was explicitly rejected, but updating the existing VSTS Work Item to Reject failed. Reconciliation may retry this same Work Item; do not create another Work Item.'
        }, { Update_Rejected_Work_Item: ['Failed', 'TimedOut'] }),
        Notify_Rejected_VSTS_Update_Failure: teamsMessage(
          '<p>⚠️ P1 was explicitly rejected, but the existing VSTS Work Item could not be moved to Reject. SharePoint remains REJECTED. Reconcile Work Item <a href="@{outputs(\'Compose_Work_Item_URL\')}">#@{body(\'Create_Azure_DevOps_work_item\')?[\'id\']}</a>; do not create a duplicate.</p>',
          after('Preserve_Rejected_Incident_When_VSTS_Update_Fails')
        )
      },
      else: {
        actions: {
          Update_Incident_Approval_Error: sharePointPatch({
            id: "@body('Create_FIRING_incident')?['ID']",
            ...incidentIdentityFields(),
            'item/WorkflowStatus/Value': 'FAILED',
            'item/Priority/Value': "@outputs('Compose_Priority')",
            'item/ApprovalOutcome': "@outputs('Compose_ApprovalResult')",
            'item/ApprovalStatus': 'Error',
            'item/AdoWorkItemId': "@body('Create_Azure_DevOps_work_item')?['id']",
            'item/AdoWorkItemUrl': "@outputs('Compose_Work_Item_URL')",
            'item/AdoState': "@coalesce(body('Create_Azure_DevOps_work_item')?['fields']?['System.State'],'New')",
            'item/LastSyncedAt': '@utcNow()',
            'item/ApprovalCompletedAt': '@utcNow()',
            'item/ErrorDetail': 'Approval connector failed or returned an unsupported outcome. VSTS state was intentionally left unchanged; connector error is not a rejection.'
          }),
          Notify_Approval_Error: teamsMessage(
            '<p>⚠️ P1 approval connector failed or returned an unsupported outcome. Existing Work Item <a href="@{outputs(\'Compose_Work_Item_URL\')}">#@{body(\'Create_Azure_DevOps_work_item\')?[\'id\']}</a> was left unchanged. Review the flow run; do not treat this as a rejection.</p>',
            after('Update_Incident_Approval_Error')
          )
        }
      }
    }
  };

  writeJson(definitionFile, wrapper);
  updatePackageManifest(target, 'OperationsHub-IncidentAutomation-v3.7.8', 'Operations Hub - Incident Automation v3.7.8');
}

function buildReconciliation() {
  const source = path.join(POWER_AUTOMATE, 'vsts-reconciliation-v1.2.1-source');
  const target = path.join(POWER_AUTOMATE, 'vsts-reconciliation-v1.3.0-staging');
  copyClean(source, target);

  const definitionFile = findDefinition(target);
  const wrapper = readJson(definitionFile);
  const definition = wrapper.properties.definition;
  const scope = findAction(definition.actions, 'Scope_Sync_Current_Incident');
  const actions = scope.actions;

  wrapper.properties.displayName = 'Operations Hub - VSTS Reconciliation v1.3.0';
  definition.contentVersion = '1.3.0.0';

  actions.Compose_Approval_Is_Explicitly_Rejected = {
    runAfter: { Compose_Approval_Is_Explicitly_Approved: ['Succeeded'] },
    type: 'Compose',
    inputs: "@or(equals(outputs('Compose_Approval_Status'),'rejected'),equals(outputs('Compose_Approval_Outcome'),'reject'),equals(outputs('Compose_Approval_Outcome'),'rejected'))"
  };

  actions.Compose_Approval_Is_Error = {
    runAfter: { Compose_Approval_Is_Explicitly_Rejected: ['Succeeded'] },
    type: 'Compose',
    inputs: "@or(equals(outputs('Compose_Approval_Status'),'error'),equals(outputs('Compose_Approval_Outcome'),'error'))"
  };

  actions.Condition_Repair_VSTS_State_From_Approval = {
    runAfter: { Compose_Approval_Is_Error: ['Succeeded'] },
    type: 'If',
    expression: "@and(not(or(equals(outputs('Compose_VSTS_State'),'closed'),equals(outputs('Compose_VSTS_State'),'done'))),or(and(outputs('Compose_Approval_Is_Explicitly_Rejected'),not(or(equals(outputs('Compose_VSTS_State'),'reject'),equals(outputs('Compose_VSTS_State'),'rejected')))),and(outputs('Compose_Approval_Is_Explicitly_Approved'),or(equals(outputs('Compose_VSTS_State'),'new'),equals(outputs('Compose_VSTS_State'),'open'),equals(outputs('Compose_VSTS_State'),'awaiting approval')))))",
    actions: {
      Update_VSTS_State_From_Approval: adoUpdate({
        account: 'buzzebees',
        id: "@string(items('For_each_Incident')?['AdoWorkItemId'])",
        project: 'Buzzebees',
        type: 'IT Support Case',
        'workItem/dynamicFields/Custom.ApprovalStatus': "@if(outputs('Compose_Approval_Is_Explicitly_Rejected'),'Reject','Approve')",
        'workItem/dynamicFields/System.State': "@if(outputs('Compose_Approval_Is_Explicitly_Rejected'),'Reject','Processing')"
      })
    },
    else: { actions: {} }
  };

  actions.Compose_Effective_VSTS_State = {
    runAfter: { Condition_Repair_VSTS_State_From_Approval: ['Succeeded'] },
    type: 'Compose',
    inputs: "@if(or(equals(outputs('Compose_VSTS_State'),'closed'),equals(outputs('Compose_VSTS_State'),'done')),outputs('Compose_VSTS_State'),if(outputs('Compose_Approval_Is_Explicitly_Rejected'),'reject',if(and(outputs('Compose_Approval_Is_Explicitly_Approved'),or(equals(outputs('Compose_VSTS_State'),'new'),equals(outputs('Compose_VSTS_State'),'open'),equals(outputs('Compose_VSTS_State'),'awaiting approval'))),'processing',outputs('Compose_VSTS_State'))))"
  };

  actions.Compose_Desired_Workflow_Status.runAfter = { Compose_Effective_VSTS_State: ['Succeeded'] };
  actions.Compose_Desired_Workflow_Status.inputs = "@if(or(equals(outputs('Compose_Effective_VSTS_State'),'closed'),equals(outputs('Compose_Effective_VSTS_State'),'done')),'CLOSED',if(outputs('Compose_Approval_Is_Explicitly_Rejected'),'REJECTED',if(or(equals(outputs('Compose_Effective_VSTS_State'),'reject'),equals(outputs('Compose_Effective_VSTS_State'),'rejected')),'REJECTED',if(outputs('Compose_Approval_Is_Error'),'FAILED',if(and(equals(toUpper(outputs('Compose_Current_Workflow_Status')),'REJECTED'),not(outputs('Compose_Approval_Is_Explicitly_Approved'))),'REJECTED',if(or(equals(outputs('Compose_Effective_VSTS_State'),'verified results'),equals(outputs('Compose_Effective_VSTS_State'),'verified result'),equals(outputs('Compose_Effective_VSTS_State'),'verified'),equals(outputs('Compose_Effective_VSTS_State'),'resolved')),'VERIFIED',if(equals(outputs('Compose_Effective_VSTS_State'),'pending'),'PENDING',if(or(equals(outputs('Compose_Effective_VSTS_State'),'processing'),equals(outputs('Compose_Effective_VSTS_State'),'active')),'PROCESSING',if(or(equals(outputs('Compose_Effective_VSTS_State'),'new'),equals(outputs('Compose_Effective_VSTS_State'),'open'),equals(outputs('Compose_Effective_VSTS_State'),'awaiting approval')),'AWAITING_APPROVAL',if(or(equals(outputs('Compose_Effective_VSTS_State'),'cancelled'),equals(outputs('Compose_Effective_VSTS_State'),'canceled'),equals(outputs('Compose_Effective_VSTS_State'),'removed')),'CANCELLED',outputs('Compose_Current_Workflow_Status')))))))))))";

  const updateParams = actions.Update_Incident_From_VSTS.inputs.parameters;
  updateParams['item/AdoState'] = "@if(equals(outputs('Compose_Effective_VSTS_State'),'reject'),'Reject',if(equals(outputs('Compose_Effective_VSTS_State'),'processing'),'Processing',coalesce(body('Get_VSTS_Work_Item')?['fields']?['System_State'],items('For_each_Incident')?['AdoState'])))";
  updateParams['item/AdoRevision'] = "@int(coalesce(body('Update_VSTS_State_From_Approval')?['rev'],body('Get_VSTS_Work_Item')?['rev'],0))";

  writeJson(definitionFile, wrapper);
  updatePackageManifest(target, 'OperationsHub-VSTS-Reconciliation-v1.3.0', 'Operations Hub - VSTS Reconciliation v1.3.0');
}

function adoUpdate(parameters, runAfter = undefined) {
  const action = {
    type: 'OpenApiConnection',
    inputs: {
      parameters,
      host: {
        apiId: '/providers/Microsoft.PowerApps/apis/shared_visualstudioteamservices',
        connectionName: 'shared_visualstudioteamservices',
        operationId: 'UpdateWorkItem'
      },
      authentication: "@parameters('$authentication')"
    }
  };
  if (runAfter) action.runAfter = runAfter;
  return action;
}

function sharePointPatch(parameters, runAfter = undefined) {
  const action = {
    type: 'OpenApiConnection',
    inputs: {
      parameters: {
        dataset: 'https://buzzebees.sharepoint.com/sites/ADOAuto-Approve',
        table: '5f744c7f-10a3-4ef4-9cf7-f64f65a71851',
        ...parameters
      },
      host: {
        apiId: '/providers/Microsoft.PowerApps/apis/shared_sharepointonline',
        connectionName: 'shared_sharepointonline',
        operationId: 'PatchItem'
      },
      authentication: "@parameters('$authentication')"
    }
  };
  if (runAfter) action.runAfter = runAfter;
  return action;
}

function teamsMessage(messageBody, runAfter) {
  return {
    type: 'OpenApiConnection',
    runAfter,
    inputs: {
      parameters: {
        poster: 'Flow bot',
        location: 'Group chat',
        'body/recipient': '19:a0a8b701b02c469b94f493d1ed9903b9@thread.v2',
        'body/messageBody': messageBody
      },
      host: {
        apiId: '/providers/Microsoft.PowerApps/apis/shared_teams',
        connectionName: 'shared_teams-1',
        operationId: 'PostMessageToConversation'
      },
      authentication: "@parameters('$authentication')"
    }
  };
}

function incidentIdentityFields() {
  return {
    'item/IncidentId': "@outputs('Compose_IncidentId')",
    'item/SourceMessageId': "@outputs('Compose_SourceMessageId')",
    'item/ReceivedAt': "@coalesce(triggerOutputs()?['body/receivedDateTime'], utcNow())",
    'item/AlertStatus/Value': 'FIRING'
  };
}

function after(name) {
  return { [name]: ['Succeeded'] };
}

function findAction(actions, name) {
  if (!actions) return null;
  if (actions[name]) return actions[name];
  for (const action of Object.values(actions)) {
    const nested = findAction(action.actions, name) || findAction(action.else && action.else.actions, name);
    if (nested) return nested;
  }
  return null;
}

function updatePackageManifest(root, packageName, flowName) {
  const manifestFile = path.join(root, 'manifest.json');
  const manifest = readJson(manifestFile);
  manifest.details.displayName = packageName;
  manifest.details.description = 'Operations Hub lifecycle upgrade; import as a new flow.';
  const flowResource = Object.values(manifest.resources).find(resource => resource.type === 'Microsoft.Flow/flows');
  flowResource.suggestedCreationType = 'New';
  flowResource.creationType = 'Existing, New, Update';
  flowResource.details.displayName = flowName;
  writeJson(manifestFile, manifest);
}

function findDefinition(root) {
  const flowsRoot = path.join(root, 'Microsoft.Flow', 'flows');
  const folder = fs.readdirSync(flowsRoot).find(name => name !== 'manifest.json');
  return path.join(flowsRoot, folder, 'definition.json');
}

function copyClean(source, target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
}
