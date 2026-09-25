const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) {
  throw new Error('Usage: node build-operations-hub-v386-lifecycle-fix.js <v3.8.5-extracted-directory> <output-directory>');
}

const source = path.resolve(sourceRoot);
const output = path.resolve(outputRoot);
if (!fs.existsSync(source)) throw new Error(`Source package directory does not exist: ${source}`);
if (fs.existsSync(output)) throw new Error(`Output directory already exists: ${output}`);

fs.cpSync(source, output, { recursive: true });

const packageManifestPath = path.join(output, 'manifest.json');
const flowAssetsRoot = path.join(output, 'Microsoft.Flow', 'flows');
const flowManifest = readJson(path.join(flowAssetsRoot, 'manifest.json'));
const assetPaths = flowManifest.flowAssets && flowManifest.flowAssets.assetPaths;
if (!Array.isArray(assetPaths) || assetPaths.length !== 1) {
  throw new Error('Expected exactly one flow asset in Microsoft.Flow/flows/manifest.json');
}

const flowResourceId = assetPaths[0];
const definitionPath = path.join(flowAssetsRoot, flowResourceId, 'definition.json');
const wrapper = readJson(definitionPath);
const packageManifest = readJson(packageManifestPath);
const workflow = wrapper.properties && wrapper.properties.definition;
if (!workflow) throw new Error('Flow workflow definition was not found');

const triggerEntries = Object.entries(workflow.triggers || {}).filter(([, trigger]) =>
  trigger.inputs && trigger.inputs.host && trigger.inputs.host.operationId === 'OnNewEmailV3'
);
if (triggerEntries.length !== 1) throw new Error(`Expected one OnNewEmailV3 trigger, found ${triggerEntries.length}`);

const [, emailTrigger] = triggerEntries[0];
delete emailTrigger.inputs.parameters.subjectFilter;

// Keep ingestion serialized until approval is split into a second flow. The current
// SharePoint query-before-create dedup is not atomic, so higher concurrency can
// create duplicate incidents and work items.
emailTrigger.runtimeConfiguration = emailTrigger.runtimeConfiguration || {};
emailTrigger.runtimeConfiguration.concurrency = { runs: 1 };

const actions = indexActions(workflow.actions || {});
const route = requiredAction(actions, 'Condition_AppService_Subject_Routing');
route.expression = {
  and: [
    {
      startsWith: [
        "@toUpper(trim(triggerOutputs()?['body/subject']))",
        '[BUZZEBEES][NOWALERT_APPSERVICE]'
      ]
    },
    {
      or: [
        { contains: ["@toUpper(triggerOutputs()?['body/subject'])", 'ALERT FIRING'] },
        { contains: ["@toUpper(triggerOutputs()?['body/subject'])", 'ALERT RESOLVED'] }
      ]
    }
  ]
};

const messageLookup = requiredAction(actions, 'Get_items_by_SourceMessageId');
messageLookup.inputs.parameters.$filter =
  "@concat('(SourceMessageId eq ''',replace(outputs('Compose_SourceMessageId'),'''',''''''),''' or LastSourceMessageId eq ''',replace(outputs('Compose_SourceMessageId'),'''',''''''),''')')";

const firingExists = requiredAction(actions, 'Condition_FIRING_Incident_Exists');
firingExists.expression = {
  and: [{ greater: ["@length(body('Get_items_by_IncidentId')?['value'])", 0] }]
};

// Refuse to emit an apparently fixed package if the existing RESOLVED correlation
// branch has been removed or weakened in the input artifact.
const resolvedLookup = requiredAction(actions, 'Get_latest_open_FIRING');
const resolvedFilter = String(resolvedLookup.inputs && resolvedLookup.inputs.parameters && resolvedLookup.inputs.parameters.$filter || '');
for (const invariant of ['Title eq', 'Resource eq', "AlertStatus eq ''FIRING''", 'ResolvedAt eq null', 'FirstSeenAt lt']) {
  if (!resolvedFilter.includes(invariant)) throw new Error(`RESOLVED correlation filter is missing: ${invariant}`);
}

const displayName = 'Operations Hub - Incident Automation v3.8.6';
workflow.contentVersion = '3.8.6.0';
workflow.metadata = workflow.metadata || {};
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = displayName;

packageManifest.details.displayName = 'OperationsHub-IncidentAutomation-v3.8.6';
packageManifest.details.description =
  'Lifecycle repair: accept App Service FIRING and RESOLVED mail, deduplicate by both message ID fields, restore FIRING incident dedup, and preserve safe serialized ingestion.';
packageManifest.details.createdTime = new Date().toISOString();
const flowResource = packageManifest.resources && packageManifest.resources[flowResourceId];
if (!flowResource) throw new Error(`Flow resource ${flowResourceId} was not found in package manifest`);
flowResource.details.displayName = displayName;

writeJson(definitionPath, wrapper);
writeJson(packageManifestPath, packageManifest);
console.log(`Built ${displayName} at ${output}`);

function indexActions(rootActions) {
  const result = new Map();
  visit(rootActions);
  return result;

  function visit(group) {
    for (const [name, action] of Object.entries(group || {})) {
      if (result.has(name)) throw new Error(`Duplicate action name is ambiguous: ${name}`);
      result.set(name, action);
      visit(action.actions);
      visit(action.else && action.else.actions);
    }
  }
}

function requiredAction(actions, name) {
  const action = actions.get(name);
  if (!action) throw new Error(`Required action was not found: ${name}`);
  return action;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}
