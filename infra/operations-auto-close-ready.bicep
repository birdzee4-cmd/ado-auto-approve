@description('Logic App workflow name.')
param workflowName string = 'operations-hub-auto-close-ready'

@description('Auto-close API endpoint.')
param endpointUri string

@secure()
param automationKey string

@allowed([
  'Enabled'
  'Disabled'
])
param workflowState string = 'Disabled'

param location string = resourceGroup().location

resource autoClose 'Microsoft.Logic/workflows@2019-05-01' = {
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
            frequency: 'Hour'
            interval: 1
            timeZone: 'SE Asia Standard Time'
          }
        }
      }
      actions: {
        Auto_Close_Ready_Incidents: {
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
              dryRun: false
              maxItems: 100
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

output workflowResourceId string = autoClose.id
output workflowState string = autoClose.properties.state
