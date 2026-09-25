@description('Logic App workflow name.')
param workflowName string = 'operations-hub-reconcile'

@description('Operations Hub reconciliation endpoint.')
param endpointUri string

@secure()
@description('Shared token sent only in the reconciliation request header.')
param automationKey string

@allowed([
  'Enabled'
  'Disabled'
])
param workflowState string = 'Disabled'

@minValue(5)
@maxValue(60)
param intervalMinutes int = 10

@minValue(1)
@maxValue(250)
param maxItems int = 100

@description('When true, authenticate and enumerate candidates without synchronizing or writing audit records.')
param dryRun bool = true

param location string = resourceGroup().location

resource operationsReconcile 'Microsoft.Logic/workflows@2019-05-01' = {
  name: workflowName
  location: location
  properties: {
    state: workflowState
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      parameters: {
        automationKey: {
          type: 'SecureString'
        }
      }
      triggers: {
        Recurrence: {
          type: 'Recurrence'
          recurrence: {
            frequency: 'Minute'
            interval: intervalMinutes
          }
        }
      }
      actions: {
        Reconcile_Operations_Hub: {
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
              'x-operations-automation-key': '@parameters(\'automationKey\')'
            }
            body: {
              maxItems: maxItems
              dryRun: dryRun
            }
          }
        }
      }
      outputs: {}
    }
    parameters: {
      automationKey: {
        value: automationKey
      }
    }
  }
}

output workflowResourceId string = operationsReconcile.id
output workflowState string = operationsReconcile.properties.state
