@description('Scheduled Operations Hub read-model sync workflow name.')
param workflowName string = 'operations-hub-read-model-sync'
@description('Protected sync endpoint.')
param endpointUri string
@secure()
param syncToken string
@allowed(['Enabled','Disabled'])
param workflowState string = 'Disabled'
@minValue(5)
@maxValue(60)
param intervalMinutes int = 10
@minValue(10)
@maxValue(100)
param pageSize int = 50
param location string = resourceGroup().location

resource workflow 'Microsoft.Logic/workflows@2019-05-01' = {
  name: workflowName
  location: location
  properties: {
    state: workflowState
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      parameters: { syncToken: { type: 'SecureString' } }
      triggers: {
        Recurrence: {
          type: 'Recurrence'
          recurrence: { frequency: 'Minute', interval: intervalMinutes }
        }
      }
      actions: {
        Sync_Read_Model_Page: {
          type: 'Http'
          runAfter: {}
          runtimeConfiguration: { secureData: { properties: ['inputs','outputs'] } }
          inputs: {
            method: 'POST'
            uri: endpointUri
            headers: {
              'Content-Type': 'application/json'
              'x-operations-read-model-token': '@parameters(\'syncToken\')'
            }
            body: { pageSize: pageSize }
          }
        }
      }
      outputs: {}
    }
    parameters: { syncToken: { value: syncToken } }
  }
}
