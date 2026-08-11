@description('Logic App workflow name.')
param workflowName string = 'ado-hourly-log-sync-staging'

@description('Static Web App reconciliation endpoint.')
param endpointUri string

@secure()
@description('Shared token sent only in the reconciliation request header.')
param syncToken string

@allowed([
  'Enabled'
  'Disabled'
])
param workflowState string = 'Disabled'

param location string = resourceGroup().location

resource hourlyLogSync 'Microsoft.Logic/workflows@2019-05-01' = {
  name: workflowName
  location: location
  properties: {
    state: workflowState
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      parameters: {
        syncToken: {
          type: 'SecureString'
        }
      }
      triggers: {
        Recurrence: {
          type: 'Recurrence'
          recurrence: {
            frequency: 'Minute'
            interval: 60
          }
        }
      }
      actions: {
        Reconcile_Approval_Logs: {
          type: 'Http'
          runAfter: {}
          runtimeConfiguration: {
            secureData: {
              properties: [
                'inputs'
                'outputs'
              ]
            }
          }
          inputs: {
            method: 'POST'
            uri: endpointUri
            headers: {
              'Content-Type': 'application/json'
              'x-hourly-sync-token': '@parameters(\'syncToken\')'
            }
            body: {
              lookbackHours: 48
              maxPrs: 100
            }
          }
        }
      }
      outputs: {}
    }
    parameters: {
      syncToken: {
        value: syncToken
      }
    }
  }
}

output workflowResourceId string = hourlyLogSync.id
