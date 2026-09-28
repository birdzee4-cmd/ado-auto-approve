const fs = require('fs');
const path = require('path');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) throw new Error('Usage: node build-operations-hub-v3813-resolved-vsts.js <v3.8.10-directory> <output-directory>');
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
const resolved = workflow.actions.Scope_Process_Incident.actions.Condition_Message_Already_Processed.else.actions
  .Condition_Priority_is_P1_or_P2.actions.Condition_Is_RESOLVED.actions
  .Condition_Matching_FIRING_Found.actions;

if (!resolved.Update_matching_incident_RESOLVED || !resolved.Post_RESOLVED_to_Teams) {
  throw new Error('Expected v3.8.10 RESOLVED branch was not found');
}

resolved.Scope_Update_Tier1_after_RESOLVED = {
  type: 'Scope',
  runAfter: { Update_matching_incident_RESOLVED: ['Succeeded'] },
  actions: {
    Condition_Tier1_Work_Item_Available: {
      type: 'If',
      expression: {
        and: [{ not: { equals: ["@string(coalesce(first(body('Get_latest_open_FIRING')?['value'])?['AdoWorkItemId'],''))", ''] } }]
      },
      actions: {
        Add_RESOLVED_comment_to_Tier1: {
          type: 'OpenApiConnection',
          inputs: {
            parameters: {
              account: 'buzzebees',
              project: 'Buzzebees',
              type: 'IT Support Case',
              workItemId: "@int(first(body('Get_latest_open_FIRING')?['value'])?['AdoWorkItemId'])",
              format: 'Html',
              text: "<p><b>✅ MONITORING ALERT RESOLVED</b></p><p><b>Alert:</b> @{outputs('Compose_AlertName')}<br><b>Resource:</b> @{outputs('Compose_Resource')}<br><b>Environment:</b> @{outputs('Compose_Environment')}<br><b>First seen (Asia/Bangkok):</b> @{outputs('Compose_FirstSeenDisplay')}<br><b>Resolved at (Asia/Bangkok):</b> @{outputs('Compose_ResolvedAtDisplay')}<br><b>Incident:</b> @{first(body('Get_latest_open_FIRING')?['value'])?['IncidentId']}<br><b>Source:</b> Grafana Monitoring / Operations Hub</p>"
            },
            host: {
              apiId: '/providers/Microsoft.PowerApps/apis/shared_visualstudioteamservices',
              connectionName: 'shared_visualstudioteamservices',
              operationId: 'CreateWorkItemCommentAsync'
            },
            authentication: "@parameters('$authentication')"
          }
        },
        Get_related_work_items_for_RESOLVED: {
          type: 'OpenApiConnection',
          runAfter: { Add_RESOLVED_comment_to_Tier1: ['Succeeded', 'Failed', 'TimedOut'] },
          inputs: {
            parameters: {
              dataset: 'https://buzzebees.sharepoint.com/sites/ADOAuto-Approve',
              table: 'OperationsHubWorkItems',
              '$filter': "@concat('field_1 eq ''',replace(first(body('Get_latest_open_FIRING')?['value'])?['IncidentId'],'''',''''''),''' and field_3 eq ''RELATED''')",
              '$top': 100
            },
            host: {
              apiId: '/providers/Microsoft.PowerApps/apis/shared_sharepointonline',
              connectionName: 'shared_sharepointonline',
              operationId: 'GetItems'
            },
            authentication: "@parameters('$authentication')"
          }
        },
        Filter_open_related_work_items: {
          type: 'Query',
          runAfter: { Get_related_work_items_for_RESOLVED: ['Succeeded'] },
          inputs: {
            from: "@body('Get_related_work_items_for_RESOLVED')?['value']",
            where: "@not(or(equals(toUpper(string(coalesce(item()?['field_5'],''))),'CLOSED'),equals(toUpper(string(coalesce(item()?['field_5'],''))),'DONE'),equals(toUpper(string(coalesce(item()?['field_5'],''))),'RESOLVED'),equals(toUpper(string(coalesce(item()?['field_5'],''))),'REJECT'),equals(toUpper(string(coalesce(item()?['field_5'],''))),'REJECTED'),equals(toUpper(string(coalesce(item()?['field_5'],''))),'REMOVED')))"
          }
        },
        Condition_All_Related_Work_Items_Closed: {
          type: 'If',
          runAfter: { Filter_open_related_work_items: ['Succeeded'] },
          expression: { and: [{ equals: ["@length(body('Filter_open_related_work_items'))", 0] }] },
          actions: {
            Close_Tier1_after_RESOLVED: {
              type: 'OpenApiConnection',
              inputs: {
                parameters: {
                  account: 'buzzebees',
                  project: 'Buzzebees',
                  type: 'IT Support Case',
                  id: "@int(first(body('Get_latest_open_FIRING')?['value'])?['AdoWorkItemId'])",
                  'workItem/dynamicFields/System.State': 'Closed'
                },
                host: {
                  apiId: '/providers/Microsoft.PowerApps/apis/shared_visualstudioteamservices',
                  connectionName: 'shared_visualstudioteamservices',
                  operationId: 'UpdateWorkItem'
                },
                authentication: "@parameters('$authentication')"
              }
            },
            Record_Tier1_Closed_after_RESOLVED: {
              type: 'OpenApiConnection',
              runAfter: { Close_Tier1_after_RESOLVED: ['Succeeded'] },
              inputs: {
                parameters: {
                  dataset: 'https://buzzebees.sharepoint.com/sites/ADOAuto-Approve',
                  table: '5f744c7f-10a3-4ef4-9cf7-f64f65a71851',
                  id: "@first(body('Get_latest_open_FIRING')?['value'])?['ID']",
                  'item/IncidentId': "@first(body('Get_latest_open_FIRING')?['value'])?['IncidentId']",
                  'item/SourceMessageId': "@first(body('Get_latest_open_FIRING')?['value'])?['SourceMessageId']",
                  'item/ReceivedAt': "@first(body('Get_latest_open_FIRING')?['value'])?['ReceivedAt']",
                  'item/AlertStatus/Value': 'RESOLVED',
                  'item/WorkflowStatus/Value': "@coalesce(first(body('Get_latest_open_FIRING')?['value'])?['WorkflowStatus']?['Value'],first(body('Get_latest_open_FIRING')?['value'])?['WorkflowStatus'])",
                  'item/Priority/Value': "@coalesce(first(body('Get_latest_open_FIRING')?['value'])?['Priority']?['Value'],first(body('Get_latest_open_FIRING')?['value'])?['Priority'])",
                  'item/AdoWorkItemId': "@first(body('Get_latest_open_FIRING')?['value'])?['AdoWorkItemId']",
                  'item/AdoWorkItemUrl': "@first(body('Get_latest_open_FIRING')?['value'])?['AdoWorkItemUrl']",
                  'item/AdoState': 'Closed',
                  'item/AssignedTo': "@first(body('Get_latest_open_FIRING')?['value'])?['AssignedTo']",
                  'item/AdoClosedAt': '@utcNow()',
                  'item/LastSyncedAt': '@utcNow()'
                },
                host: {
                  apiId: '/providers/Microsoft.PowerApps/apis/shared_sharepointonline',
                  connectionName: 'shared_sharepointonline',
                  operationId: 'PatchItem'
                },
                authentication: "@parameters('$authentication')"
              }
            }
          },
          else: { actions: {} }
        }
      },
      else: { actions: {} }
    }
  }
};

resolved.Post_RESOLVED_to_Teams.runAfter = {
  Scope_Update_Tier1_after_RESOLVED: ['Succeeded', 'Failed', 'TimedOut', 'Skipped']
};

const displayName = 'Operations Hub - Incident Automation v3.8.13';
wrapper.properties.displayName = displayName;
workflow.contentVersion = '3.8.13.0';
workflow.metadata.clientLastModifiedTime = new Date().toISOString();
manifest.details.displayName = 'OperationsHub-IncidentAutomation-v3.8.13';
manifest.details.description = 'RESOLVED lifecycle: add a Tier 1 comment with the Azure DevOps Create work item comment action, close Tier 1 only when there are no open related Work Items, and isolate SharePoint/Teams processing from VSTS failures.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = displayName;
writeJson(definitionPath, wrapper);
writeJson(packagePath, manifest);
console.log(`Built ${displayName} at ${output}`);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
