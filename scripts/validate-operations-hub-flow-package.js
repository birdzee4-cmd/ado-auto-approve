const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) throw new Error('Usage: node validate-operations-hub-flow-package.js <extracted-package-directory>');

const flowsRoot = path.join(root, 'Microsoft.Flow', 'flows');
const flowFolder = fs.readdirSync(flowsRoot).find(name => name !== 'manifest.json');
if (!flowFolder) throw new Error('Flow asset folder not found');

const wrapper = readJson(path.join(flowsRoot, flowFolder, 'definition.json'));
const manifest = readJson(path.join(root, 'manifest.json'));
const apiMap = readJson(path.join(flowsRoot, flowFolder, 'apisMap.json'));
const connectionMap = readJson(path.join(flowsRoot, flowFolder, 'connectionsMap.json'));
const definition = wrapper.properties.definition;

const errors = [];
const allActions = [];
walkContainer(definition.actions, 'actions');

const emailTrigger = definition.triggers && definition.triggers['When_a_new_email_arrives_(V3)'];
const expectedFolderPath = 'Id::AAMkADE0OWVjYjA5LWIyMDMtNDhjYS04ZDhjLWNkMWFhYzJiYWQyOQAuAAAAAAC8C8XS08R9Trfz1GrYHZKbAQBshOktFlHmSY3OPI6jffd6AAW8jkwhAAA=';
if (!emailTrigger) {
  errors.push('When a new email arrives (V3) trigger is missing');
} else {
  const triggerParameters = emailTrigger.inputs && emailTrigger.inputs.parameters || {};
  if (triggerParameters.folderPath !== expectedFolderPath) errors.push('Outlook trigger does not target AzureAppServiceHigh5xxRateCritical');
  if (triggerParameters.subjectFilter) errors.push('Outlook subjectFilter must be empty because FIRING and RESOLVED use different prefixes');
}

if (definition.contentVersion !== '2.7.0.0') errors.push(`Content version is ${definition.contentVersion}, expected 2.7.0.0`);

const names = allActions.map(entry => entry.name);
const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
if (duplicates.length) errors.push(`Duplicate action names: ${Array.from(new Set(duplicates)).join(', ')}`);

for (const entry of allActions) {
  if (entry.action.type === 'OpenApiConnection' || entry.action.type === 'OpenApiConnectionWebhook') {
    const connectionName = entry.action.inputs && entry.action.inputs.host && entry.action.inputs.host.connectionName;
    if (connectionName && !wrapper.properties.connectionReferences[connectionName]) {
      errors.push(`${entry.name} references missing connection ${connectionName}`);
    }
  }
}

const required = [
  'Get_items_by_MessageId',
  'Condition_Is_Supported_P1',
  'Terminate_Unsupported_or_Noncritical_Email',
  'Condition_Is_RESOLVED',
  'Create_FIRING_incident',
  'Start_and_wait_for_an_approval',
  'Condition_Approved',
  'Recheck_incident_before_ADO',
  'Create_Azure_DevOps_work_item',
  'Update_matching_incident_RESOLVED',
  'Create_unmatched_RESOLVED_as_CANCELLED',
  'Scope_Handle_Technical_Failure'
];
for (const name of required) if (!names.includes(name)) errors.push(`Required action is missing: ${name}`);

const approval = allActions.find(entry => entry.name === 'Start_and_wait_for_an_approval');
if (approval && approval.action.limit && approval.action.limit.timeout !== 'PT15M') {
  errors.push(`Approval timeout is ${approval.action.limit.timeout}, expected PT15M`);
}

const firstSeen = allActions.find(entry => entry.name === 'Compose_FirstSeenAt');
const resolvedAt = allActions.find(entry => entry.name === 'Compose_ResolvedAt');
for (const entry of [firstSeen, resolvedAt]) {
  if (!entry || !String(entry.action.inputs).includes("convertToUtc(") || !String(entry.action.inputs).includes("'SE Asia Standard Time'")) {
    errors.push(`${entry ? entry.name : 'UTC timestamp compose'} does not convert Bangkok local time to UTC`);
  }
  if (entry && String(entry.action.inputs).includes('+07:00')) errors.push(`${entry.name} still emits an offset timestamp instead of canonical UTC`);
}

const p1Condition = allActions.find(entry => entry.name === 'Condition_Is_Supported_P1');
const p1Json = JSON.stringify(p1Condition && p1Condition.action.expression || {});
for (const token of ['P1', 'Compose_IsFiring', 'Compose_IsResolved']) {
  if (!p1Json.includes(token)) errors.push(`P1 condition is missing ${token}`);
}
if (p1Json.includes("'CRITICAL'")) errors.push('P1 condition must not require CRITICAL');

const isFiring = allActions.find(entry => entry.name === 'Compose_IsFiring');
const isResolved = allActions.find(entry => entry.name === 'Compose_IsResolved');
const isFiringExpression = String(isFiring && isFiring.action.inputs || '');
const isResolvedExpression = String(isResolved && isResolved.action.inputs || '');
if (!isFiringExpression.includes('ALERT FIRING')) errors.push('Compose_IsFiring must detect ALERT FIRING');
if (!isResolvedExpression.includes('RESOLVED')) errors.push('Compose_IsResolved must detect RESOLVED');
const htmlToText = allActions.find(entry => entry.name === 'Html_to_text');
const normalizedEmailBody = allActions.find(entry => entry.name === 'Compose_NormalizedEmailBody');
if (!htmlToText || htmlToText.action.inputs.host.connectionName !== 'shared_conversionservice' || htmlToText.action.inputs.host.operationId !== 'HtmlToText') {
  errors.push('Email body must be converted by the Content Conversion HtmlToText action before parsing');
}
if (htmlToText && !Object.prototype.hasOwnProperty.call(htmlToText.action.inputs.parameters || {}, 'Content')) errors.push('HtmlToText must use its required Content parameter');
if (!String(normalizedEmailBody && normalizedEmailBody.action.inputs || '').includes("body('Html_to_text')")) errors.push('Normalized email body must use the Html_to_text output');
for (const prefix of ['WAITALERT_APPSERVICE', 'NOWALERT_APPSERVICE']) {
  if (isFiringExpression.includes(prefix) || isResolvedExpression.includes(prefix)) {
    errors.push(`FIRING/RESOLVED classification must not depend on ${prefix}`);
  }
}

const expectedApprover = 'kiattisak.yo@buzzebees.com';
const approvalAssignedTo = approval && approval.action.inputs && approval.action.inputs.parameters && approval.action.inputs.parameters['WebhookApprovalCreationInput/assignedTo'];
if (approvalAssignedTo !== expectedApprover) {
  errors.push(`Approval assignedTo is ${approvalAssignedTo || '(missing)'}, expected ${expectedApprover}`);
}

const messageLookup = allActions.find(entry => entry.name === 'Get_items_by_MessageId');
const messageFilter = messageLookup && messageLookup.action.inputs && messageLookup.action.inputs.parameters && messageLookup.action.inputs.parameters.$filter;
if (!String(messageFilter).includes('SourceMessageId') || !String(messageFilter).includes('LastSourceMessageId')) {
  errors.push('Message deduplication must search SourceMessageId and LastSourceMessageId');
}

const teamsActions = allActions.filter(entry => entry.action.inputs && entry.action.inputs.host && entry.action.inputs.host.connectionName === 'shared_teams-1');
const rawTeamsActions = teamsActions.filter(entry => JSON.stringify(entry.action.inputs.parameters && entry.action.inputs.parameters['body/messageBody']).includes("triggerOutputs()?['body/body']"));
if (rawTeamsActions.length) errors.push(`Raw email body is sent by Teams actions: ${rawTeamsActions.map(entry => entry.name).join(', ')}`);

const sharePointActions = allActions.filter(entry => entry.action.inputs && entry.action.inputs.host && entry.action.inputs.host.connectionName === 'shared_sharepointonline');
const choiceFields = ['AlertStatus', 'WorkflowStatus', 'Priority'];
const requiredSharePointFields = [
  'item/IncidentId',
  'item/SourceMessageId',
  'item/AlertStatus/Value',
  'item/WorkflowStatus/Value',
  'item/Priority/Value',
  'item/ReceivedAt'
];
for (const entry of sharePointActions) {
  const parameters = (entry.action.inputs && entry.action.inputs.parameters) || {};
  for (const field of choiceFields) {
    if (Object.prototype.hasOwnProperty.call(parameters, `item/${field}`)) {
      errors.push(`${entry.name} uses item/${field}; SharePoint Choice fields must use item/${field}/Value`);
    }
  }
  if (entry.action.inputs.host.operationId === 'PatchItem' || entry.action.inputs.host.operationId === 'PostItem') {
    for (const field of requiredSharePointFields) {
      if (!Object.prototype.hasOwnProperty.call(parameters, field)) {
        errors.push(`${entry.name} is missing required SharePoint update field ${field}`);
      }
    }
  }
}

const choiceValueKeys = sharePointActions.flatMap(entry => Object.keys((entry.action.inputs && entry.action.inputs.parameters) || {}))
  .filter(key => choiceFields.some(field => key === `item/${field}/Value`));
for (const field of choiceFields) {
  if (!choiceValueKeys.includes(`item/${field}/Value`)) errors.push(`No SharePoint action writes item/${field}/Value`);
}

const flowResource = Object.values(manifest.resources).find(resource => resource.type === 'Microsoft.Flow/flows');
if (!flowResource || flowResource.creationType !== 'New') errors.push('Flow package is not configured as Create as new');
if (!apiMap.shared_sharepointonline || !connectionMap.shared_sharepointonline) errors.push('SharePoint API/connection map is missing');
if (!apiMap.shared_conversionservice || !connectionMap.shared_conversionservice) errors.push('Content Conversion API/connection map is missing');
if (!wrapper.properties.connectionReferences.shared_sharepointonline) errors.push('SharePoint connection reference is missing');
if (!wrapper.properties.connectionReferences.shared_conversionservice) errors.push('Content Conversion connection reference is missing');

const summary = {
  ok: errors.length === 0,
  displayName: wrapper.properties.displayName,
  contentVersion: definition.contentVersion,
  actions: allActions.length,
  teamsActions: teamsActions.length,
  rawTeamsActions: rawTeamsActions.length,
  sharePointActions: sharePointActions.length,
  sharePointUpdateActions: sharePointActions.filter(entry => entry.action.inputs.host.operationId === 'PatchItem').length,
  sharePointChoiceValueKeys: Array.from(new Set(choiceValueKeys)).sort(),
  approvalTimeout: approval && approval.action.limit && approval.action.limit.timeout,
  approvalAssignedTo,
  firingClassification: isFiringExpression,
  resolvedClassification: isResolvedExpression,
  outlookFolder: emailTrigger && emailTrigger.inputs && emailTrigger.inputs.parameters && emailTrigger.inputs.parameters.folderPath,
  subjectFilter: emailTrigger && emailTrigger.inputs && emailTrigger.inputs.parameters && emailTrigger.inputs.parameters.subjectFilter || '',
  createAsNew: Boolean(flowResource && flowResource.creationType === 'New'),
  connections: Object.keys(wrapper.properties.connectionReferences).sort(),
  errors
};

console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exitCode = 1;

function walkContainer(actions, location) {
  if (!actions || typeof actions !== 'object') return;
  const siblingNames = new Set(Object.keys(actions));
  for (const [name, action] of Object.entries(actions)) {
    allActions.push({ name, action, location });
    for (const dependency of Object.keys(action.runAfter || {})) {
      if (!siblingNames.has(dependency)) errors.push(`${location}.${name} has missing sibling dependency ${dependency}`);
    }
    walkContainer(action.actions, `${location}.${name}.actions`);
    walkContainer(action.else && action.else.actions, `${location}.${name}.else.actions`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
