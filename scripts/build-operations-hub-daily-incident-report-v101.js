const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-daily-incident-report-v101.js <v1.0.0-directory> <output-directory>');
const source = path.resolve(sourceRoot);
const output = path.resolve(outputRoot);
if (!fs.existsSync(source)) throw new Error(`Source package directory does not exist: ${source}`);
if (fs.existsSync(output)) throw new Error(`Output directory already exists: ${output}`);
fs.cpSync(source, output, { recursive: true });

const packagePath = path.join(output, 'manifest.json');
const flowRoot = path.join(output, 'Microsoft.Flow', 'flows');
const flowManifest = readJson(path.join(flowRoot, 'manifest.json'));
const assetId = flowManifest.flowAssets.assetPaths[0];
const definitionPath = path.join(flowRoot, assetId, 'definition.json');
const wrapper = readJson(definitionPath);
const manifest = readJson(packagePath);
const workflow = wrapper.properties.definition;
const actions = workflow.actions;

const schedule = { frequency: 'Day', interval: 1, timeZone: 'SE Asia Standard Time', schedule: { hours: [8, 16], minutes: [30] } };
workflow.triggers.Recurrence.recurrence = schedule;
workflow.triggers.Recurrence.evaluatedRecurrence = JSON.parse(JSON.stringify(schedule));

const localNow = "convertTimeZone(utcNow(),'UTC','SE Asia Standard Time')";
actions.Compose_Start_UTC.inputs = `@convertToUtc(if(less(int(formatDateTime(${localNow},'HH')),12),concat(formatDateTime(addDays(${localNow},-1),'yyyy-MM-dd'),'T16:30:00'),concat(outputs('Compose_Date_Key'),'T08:30:00')),'SE Asia Standard Time')`;
actions.Compose_End_UTC.inputs = `@convertToUtc(if(less(int(formatDateTime(${localNow},'HH')),12),concat(outputs('Compose_Date_Key'),'T08:30:00'),concat(outputs('Compose_Date_Key'),'T16:30:00')),'SE Asia Standard Time')`;

actions.Compose_Report_Message.inputs = actions.Compose_Report_Message.inputs.replace(
  'ข้อมูลเวลา 00:00–16:30 น. (Asia/Bangkok)',
  "ข้อมูลช่วง @{formatDateTime(convertTimeZone(outputs('Compose_Start_UTC'),'UTC','SE Asia Standard Time'),'dd/MM HH:mm')}–@{formatDateTime(convertTimeZone(outputs('Compose_End_UTC'),'UTC','SE Asia Standard Time'),'dd/MM HH:mm')} น. (Asia/Bangkok)"
).replace('สรุปงานวันนี้', 'สรุปงานในรอบนี้').replace('Incident ใหม่:', 'Incident ที่รับเข้าในรอบ:').replace('รายการวันนี้ (สูงสุด 20 รายการ)', 'รายการในรอบนี้ (สูงสุด 20 รายการ)').replace('ไม่มี Incident ใหม่วันนี้', 'ไม่มี Incident ใหม่ในรอบนี้');

const teamsTemplate = actions.Post_Daily_Report_to_Teams;
delete actions.Post_Daily_Report_to_Teams;
actions.Post_Daily_Report_to_AzureAppServiceHigh5xxRateCritical = clone(teamsTemplate);
actions.Post_Daily_Report_to_AzureAppServiceHigh5xxRateCritical.inputs.parameters['body/recipient'] = '19:a0a8b701b02c469b94f493d1ed9903b9@thread.v2';
actions.Post_Daily_Report_to_IT_Support_Team_2025 = clone(teamsTemplate);
actions.Post_Daily_Report_to_IT_Support_Team_2025.inputs.parameters['body/recipient'] = '19:658f8d4bfe6540a89613319286bc664b@thread.v2';

const displayName = 'Operations Hub - Daily Incident Report v1.0.1';
wrapper.properties.displayName = displayName;
workflow.contentVersion = '1.0.1.0';
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
manifest.details.displayName = 'OperationsHub-DailyIncidentReport-v1.0.1';
manifest.details.description = 'Two non-overlapping daily Incident report windows (previous 16:30 to 08:30, and 08:30 to 16:30 Asia/Bangkok), delivered independently to IT_Support_Team_2025 and AzureAppServiceHigh5xxRateCritical.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = displayName;

writeJson(definitionPath, wrapper);
writeJson(packagePath, manifest);
console.log(`Built ${displayName} at ${output}`);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
