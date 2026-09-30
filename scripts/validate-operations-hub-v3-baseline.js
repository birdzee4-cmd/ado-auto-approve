const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) throw new Error('Usage: node validate-operations-hub-v3-baseline.js <extracted-package-directory>');

const flowsRoot = path.join(root, 'Microsoft.Flow', 'flows');
const flowFolder = fs.readdirSync(flowsRoot).find(name => name !== 'manifest.json');
const wrapper = JSON.parse(fs.readFileSync(path.join(flowsRoot, flowFolder, 'definition.json'), 'utf8'));
const definition = wrapper.properties.definition;
const errors = [];

const trigger = definition.triggers && definition.triggers['When_a_new_email_arrives_(V3)'];
const expectedFolder = 'Id::AAMkADE0OWVjYjA5LWIyMDMtNDhjYS04ZDhjLWNkMWFhYzJiYWQyOQAuAAAAAAC8C8XS08R9Trfz1GrYHZKbAQBshOktFlHmSY3OPI6jffd6AAW8jkwhAAA=';
if (!trigger || trigger.inputs.parameters.folderPath !== expectedFolder) errors.push('Outlook trigger is not set to AzureAppServiceHigh5xxRateCritical');
if (trigger && trigger.inputs.parameters.subjectFilter !== '🔥 ALERT FIRING') errors.push('Subject filter must be 🔥 ALERT FIRING for this test');
if (definition.contentVersion !== '3.1.0.0') errors.push('Content version must be 3.1.0.0');

const approval = findAction(definition.actions, 'Start_and_wait_for_an_approval');
if (!approval) errors.push('Approval action is missing');
if (approval && approval.inputs.parameters['WebhookApprovalCreationInput/assignedTo'] !== 'kiattisak.yo@buzzebees.com') errors.push('Approval is not assigned only to kiattisak.yo@buzzebees.com');
if (approval && approval.inputs.host.operationId !== 'StartAndWaitForAnApproval') errors.push('Approval action operation is not StartAndWaitForAnApproval');
if (findAction(definition.actions, 'Html_to_text')) errors.push('Baseline must not introduce Content Conversion');
const priorityGate = findAction(definition.actions, 'Condition_Priority_is_P1_or_P2');
const priorityGateJson = JSON.stringify(priorityGate && priorityGate.expression || {});
if (!priorityGate || !priorityGateJson.includes('P1') || !priorityGateJson.includes('P2')) errors.push('P1/P2 priority gate is missing or incomplete');

console.log(JSON.stringify({ ok: errors.length === 0, displayName: wrapper.properties.displayName, errors }, null, 2));
if (errors.length) process.exitCode = 1;

function findAction(actions, name) {
  if (!actions || typeof actions !== 'object') return undefined;
  if (actions[name]) return actions[name];
  for (const action of Object.values(actions)) {
    const found = findAction(action.actions, name) || findAction(action.else && action.else.actions, name);
    if (found) return found;
  }
  return undefined;
}
