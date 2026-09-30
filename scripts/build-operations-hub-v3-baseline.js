const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const stagingRoot = process.argv[2];
if (!stagingRoot) throw new Error('Usage: node build-operations-hub-v3-baseline.js <extracted-package-directory>');

const flowAssetsRoot = path.join(stagingRoot, 'Microsoft.Flow', 'flows');
const flowFolderName = fs.readdirSync(flowAssetsRoot).find(name => name !== 'manifest.json');
if (!flowFolderName) throw new Error('Power Automate flow asset folder was not found');

const definitionPath = path.join(flowAssetsRoot, flowFolderName, 'definition.json');
const manifestPath = path.join(stagingRoot, 'manifest.json');
const wrapper = readJson(definitionPath);
const manifest = readJson(manifestPath);
const definition = wrapper.properties.definition;

const FLOW_NAME = 'Operations Hub - Incident Automation v3.1 P1-P2 Test';
const OUTLOOK_FOLDER_NAME = 'AzureAppServiceHigh5xxRateCritical';
const OUTLOOK_FOLDER_PATH = 'Id::AAMkADE0OWVjYjA5LWIyMDMtNDhjYS04ZDhjLWNkMWFhYzJiYWQyOQAuAAAAAAC8C8XS08R9Trfz1GrYHZKbAQBshOktFlHmSY3OPI6jffd6AAW8jkwhAAA=';
const APPROVER = 'kiattisak.yo@buzzebees.com';
const TEST_SUBJECT_FILTER = '🔥 ALERT FIRING';

const trigger = definition.triggers && definition.triggers['When_a_new_email_arrives_(V3)'];
if (!trigger) throw new Error('When a new email arrives (V3) trigger was not found');
trigger.inputs.parameters.folderPath = OUTLOOK_FOLDER_PATH;
trigger.inputs.parameters.subjectFilter = TEST_SUBJECT_FILTER;
trigger.metadata = { [OUTLOOK_FOLDER_PATH]: OUTLOOK_FOLDER_NAME };

const approval = findAction(definition.actions, 'Start_and_wait_for_an_approval');
if (!approval) throw new Error('Start and wait for an approval action was not found');
approval.inputs.parameters['WebhookApprovalCreationInput/assignedTo'] = APPROVER;

// Keep the proven v2.2 process unchanged, but place one explicit priority gate
// immediately before its FIRING/RESOLVED branches.  This makes the test scope
// P1/P2 only without changing the established approval action or its dependencies.
const resolvedCondition = findAction(definition.actions, 'Condition_Is_RESOLVED');
if (!resolvedCondition) throw new Error('Condition_Is_RESOLVED action was not found');
const resolvedParent = findActionContainer(definition.actions, 'Condition_Is_RESOLVED');
if (!resolvedParent) throw new Error('Condition_Is_RESOLVED parent container was not found');
const originalRunAfter = resolvedCondition.runAfter;
delete resolvedParent.Condition_Is_RESOLVED;
resolvedCondition.runAfter = {};
resolvedParent.Condition_Priority_is_P1_or_P2 = {
  type: 'If',
  expression: {
    or: [
      { equals: ["@toUpper(outputs('Compose_Priority'))", 'P1'] },
      { equals: ["@toUpper(outputs('Compose_Priority'))", 'P2'] }
    ]
  },
  actions: { Condition_Is_RESOLVED: resolvedCondition },
  else: {
    actions: {
      Terminate_Unsupported_Priority: {
        type: 'Terminate',
        inputs: { runStatus: 'Succeeded' },
        runAfter: {}
      }
    }
  },
  runAfter: originalRunAfter
};

const newFlowId = crypto.randomUUID();
wrapper.name = newFlowId;
wrapper.id = `/providers/Microsoft.Flow/flows/${newFlowId}`;
wrapper.properties.displayName = FLOW_NAME;
definition.contentVersion = '3.1.0.0';
definition.metadata.clientLastModifiedTime = new Date().toISOString();
definition.metadata.provisioningMethod = 'FromDefinition';

manifest.details.displayName = FLOW_NAME;
manifest.details.description = 'Approval test copied from the proven v2.2 flow. It accepts ALERT FIRING emails with parsed Priority P1 or P2 only, with a single approver.';
manifest.details.createdTime = new Date().toISOString();
manifest.details.packageTelemetryId = crypto.randomUUID();
const flowResource = manifest.resources[flowFolderName];
flowResource.creationType = 'New';
flowResource.suggestedCreationType = 'New';
flowResource.details.displayName = FLOW_NAME;

writeJson(definitionPath, wrapper);
writeJson(manifestPath, manifest);

function findAction(actions, name) {
  if (!actions || typeof actions !== 'object') return undefined;
  if (actions[name]) return actions[name];
  for (const action of Object.values(actions)) {
    const found = findAction(action.actions, name) || findAction(action.else && action.else.actions, name);
    if (found) return found;
  }
  return undefined;
}

function findActionContainer(actions, name) {
  if (!actions || typeof actions !== 'object') return undefined;
  if (actions[name]) return actions;
  for (const action of Object.values(actions)) {
    const found = findActionContainer(action.actions, name) || findActionContainer(action.else && action.else.actions, name);
    if (found) return found;
  }
  return undefined;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
}
