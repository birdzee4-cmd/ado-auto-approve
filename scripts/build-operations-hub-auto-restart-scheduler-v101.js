const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node scripts/build-operations-hub-auto-restart-scheduler-v101.js <source> <output>');

fs.cpSync(sourceRoot, outputRoot, { recursive: true });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));

const version = '1.0.1';
const flowRoot = path.join(outputRoot, 'Microsoft.Flow', 'flows');
const flowManifest = read(path.join(flowRoot, 'manifest.json'));
const flowId = flowManifest.flowAssets.assetPaths[0];
const definitionPath = path.join(flowRoot, flowId, 'definition.json');
const manifestPath = path.join(outputRoot, 'manifest.json');
const wrapper = read(definitionPath);
const manifest = read(manifestPath);
const definition = wrapper.properties.definition;

definition.parameters = {
  $authentication: { defaultValue: {}, type: 'SecureObject' },
  $connections: { defaultValue: {}, type: 'Object' },
  operationsReconcileEndpoint: {
    defaultValue: 'https://mango-wave-09cff3700.7.azurestaticapps.net/api/operations-reconcile',
    type: 'String'
  },
  operationsAutomationKey: {
    defaultValue: '__SET_TO_OPERATIONS_AUTOMATION_KEY__',
    type: 'SecureString'
  }
};

definition.triggers = {
  Recurrence: {
    recurrence: { frequency: 'Minute', interval: 1, timeZone: 'SE Asia Standard Time' },
    evaluatedRecurrence: { frequency: 'Minute', interval: 1, timeZone: 'SE Asia Standard Time' },
    type: 'Recurrence'
  }
};

definition.actions = {
  Call_Operations_Reconciliation_API: {
    runAfter: {},
    type: 'Http',
    inputs: {
      uri: "@parameters('operationsReconcileEndpoint')",
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-operations-automation-key': "@parameters('operationsAutomationKey')"
      },
      body: { scope: 'ALL', maxItems: 100 }
    }
  }
};

definition.contentVersion = version;
definition.metadata = definition.metadata || {};
definition.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = `Operations Hub - Auto-Restart Scheduler v${version}`;
manifest.details.displayName = `OperationsHub-AutoRestartScheduler-v${version}-Import`;
manifest.details.description = 'One-minute scheduler for Operations Hub reconciliation API. Set operationsAutomationKey to the same secret as the API OPERATIONS_AUTOMATION_KEY before enabling.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[flowId].details.displayName = wrapper.properties.displayName;

write(definitionPath, wrapper);
write(manifestPath, manifest);
