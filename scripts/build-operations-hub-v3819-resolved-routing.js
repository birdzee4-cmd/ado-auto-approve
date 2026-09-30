const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-v3819-resolved-routing.js <v3.8.18-directory> <output-directory>');
const source = path.resolve(sourceRoot);
const output = path.resolve(outputRoot);
if (!fs.existsSync(source)) throw new Error(`Source package directory does not exist: ${source}`);
if (fs.existsSync(output)) throw new Error(`Output directory already exists: ${output}`);
fs.cpSync(source, output, { recursive: true });

const flowRoot = path.join(output, 'Microsoft.Flow', 'flows');
const flowManifest = readJson(path.join(flowRoot, 'manifest.json'));
const assetId = flowManifest.flowAssets.assetPaths[0];
const definitionPath = path.join(flowRoot, assetId, 'definition.json');
const packagePath = path.join(output, 'manifest.json');
const wrapper = readJson(definitionPath);
const manifest = readJson(packagePath);
const workflow = wrapper.properties.definition;

const routing = workflow.actions.Condition_AppService_Subject_Routing;
routing.expression = {
  and: [
    {
      or: [
        { startsWith: ["@toUpper(trim(triggerOutputs()?['body/subject']))", '[BUZZEBEES][NOWALERT_APPSERVICE]'] },
        { contains: ["@toUpper(outputs('Compose_EmailBody'))", '<B>ALERT:</B>'] }
      ]
    },
    {
      or: [
        { contains: ["@toUpper(triggerOutputs()?['body/subject'])", 'ALERT FIRING'] },
        { contains: ["@toUpper(triggerOutputs()?['body/subject'])", 'ALERT RESOLVED'] },
        { contains: ["@toUpper(triggerOutputs()?['body/subject'])", 'RESOLVED'] },
        { contains: ["@toUpper(outputs('Compose_EmailBody'))", '🔥 ALERT FIRING'] },
        { contains: ["@toUpper(outputs('Compose_EmailBody'))", '✅ RESOLVED'] },
        { contains: ["@toUpper(outputs('Compose_EmailBody'))", '<B>RESOLVED AT:</B>'] }
      ]
    }
  ]
};

const intakeActions = workflow.actions.Scope_Process_Incident.actions
  .Condition_Message_Already_Processed.else.actions;
intakeActions.Compose_IsResolved.inputs = "@or(contains(toUpper(triggerOutputs()?['body/subject']),'RESOLVED'),contains(toUpper(outputs('Compose_EmailBody')),'✅ RESOLVED'),contains(toUpper(outputs('Compose_EmailBody')),'<B>RESOLVED AT:</B>'))";

workflow.contentVersion = '3.8.19.0';
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
wrapper.properties.displayName = 'Operations Hub - Incident Automation v3.8.19';
manifest.details.displayName = 'OperationsHub-IncidentAutomation-v3.8.19';
manifest.details.description = 'RESOLVED routing repair: accept production RESOLVED messages by subject or trusted alert-body markers, update the matching incident, and post the Tier 1 Discussion comment while retaining v3.8.18 episode deduplication.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = wrapper.properties.displayName;

writeJson(definitionPath, wrapper);
writeJson(packagePath, manifest);
console.log(`Built ${wrapper.properties.displayName} at ${output}`);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
