[CmdletBinding()]
param(
  [string]$ResourceGroup = 'rg-ado-auto-approve',
  [string]$StaticWebAppName = 'ado-auto-approve',
  [string]$WorkflowName = 'operations-hub-read-model-sync',
  [string]$EndpointUri = 'https://mango-wave-09cff3700.7.azurestaticapps.net/api/operations-read-model-sync',
  [ValidateRange(5, 60)] [int]$IntervalMinutes = 10,
  [ValidateRange(10, 100)] [int]$PageSize = 50,
  [switch]$EnableWorkflow
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$syncToken = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
$state = if ($EnableWorkflow) { 'Enabled' } else { 'Disabled' }
$template = Join-Path $PSScriptRoot '..\infra\operations-read-model-sync.bicep'
az deployment group create --resource-group $ResourceGroup --template-file $template --parameters "workflowName=$WorkflowName" "endpointUri=$EndpointUri" "syncToken=$syncToken" "workflowState=$state" "intervalMinutes=$IntervalMinutes" "pageSize=$PageSize" --only-show-errors -o none
az staticwebapp appsettings set --name $StaticWebAppName --resource-group $ResourceGroup --setting-names "OPERATIONS_READ_MODEL_SYNC_TOKEN=$syncToken" --only-show-errors -o none
az resource show --resource-group $ResourceGroup --name $WorkflowName --resource-type Microsoft.Logic/workflows --api-version 2019-05-01 --query '{name:name,state:properties.state}' -o table
