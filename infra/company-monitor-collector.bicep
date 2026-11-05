param workflowName string = 'company-deployment-monitor-collector'
param endpointUri string = 'https://mango-wave-09cff3700.7.azurestaticapps.net/api/company-monitor-collect'
@secure()
param collectorKey string
@allowed(['Enabled', 'Disabled'])
param workflowState string = 'Disabled'
param location string = resourceGroup().location

resource collector 'Microsoft.Logic/workflows@2019-05-01' = {
  name: workflowName
  location: location
  properties: {
    state: workflowState
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      parameters: { collectorKey: { type: 'SecureString' } }
      triggers: {
        Every_minute: {
          type: 'Recurrence'
          recurrence: { frequency: 'Minute', interval: 1 }
          runtimeConfiguration: { concurrency: { runs: 1 } }
        }
      }
      actions: {
        Archive_monitor: {
          type: 'Http'
          runAfter: {}
          inputs: {
            method: 'POST'
            uri: endpointUri
            headers: { 'x-company-monitor-key': '@parameters(\'collectorKey\')' }
            retryPolicy: { type: 'exponential', count: 3, interval: 'PT10S' }
          }
          runtimeConfiguration: { secureData: { properties: ['inputs', 'outputs'] } }
        }
      }
      outputs: {}
    }
    parameters: { collectorKey: { value: collectorKey } }
  }
}
output workflowId string = collector.id
