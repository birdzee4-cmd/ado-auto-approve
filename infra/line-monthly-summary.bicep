@description('Logic App workflow name.')
param workflowName string = 'ado-line-monthly-pr-summary-staging'

@description('Static Web App LINE monthly summary endpoint.')
param endpointUri string

@secure()
@description('Shared token sent only in the LINE monthly summary request header.')
param summaryToken string

@allowed([
  'Enabled'
  'Disabled'
])
param workflowState string = 'Disabled'

param location string = resourceGroup().location

resource lineMonthlySummary 'Microsoft.Logic/workflows@2019-05-01' = {
  name: workflowName
  location: location
  properties: {
    state: workflowState
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      parameters: {
        summaryToken: {
          type: 'SecureString'
        }
      }
      triggers: {
        Recurrence: {
          type: 'Recurrence'
          recurrence: {
            frequency: 'Month'
            interval: 1
            timeZone: 'SE Asia Standard Time'
            schedule: {
              monthDays: [
                1
              ]
              hours: [
                8
              ]
              minutes: [
                5
              ]
            }
          }
        }
      }
      actions: {
        Send_LINE_Monthly_PR_Summary: {
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
              'x-line-monthly-summary-token': '@parameters(\'summaryToken\')'
            }
            body: {
              source: 'Logic Apps'
              scheduledFor: '08:05 Asia/Bangkok'
            }
          }
        }
      }
      outputs: {}
    }
    parameters: {
      summaryToken: {
        value: summaryToken
      }
    }
  }
}

output workflowResourceId string = lineMonthlySummary.id
