[CmdletBinding()]
param(
  [string]$ResourceGroup = 'rg-ado-auto-approve',
  [string]$StaticWebAppName = 'ado-auto-approve',
  [string]$WorkflowName = 'operations-hub-auto-close-ready',
  [string]$EndpointUri = 'https://mango-wave-09cff3700.7.azurestaticapps.net/api/operations-auto-close-ready',
  [ValidateRange(1, 250)]
  [int]$MaxItems = 100,
  [switch]$EnableWorkflow,
  [switch]$EnableAutoClose
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$templatePath = Join-Path $PSScriptRoot '..\infra\operations-auto-close-ready.bicep'

if ($EnableAutoClose -and -not $EnableWorkflow) {
  throw 'EnableAutoClose requires EnableWorkflow.'
}

$automationKey = az staticwebapp appsettings list --name $StaticWebAppName --resource-group $ResourceGroup --query "properties.OPERATIONS_AUTOMATION_KEY" --output tsv
if ([string]::IsNullOrWhiteSpace($automationKey)) {
  throw 'OPERATIONS_AUTOMATION_KEY is not configured on the Static Web App. Configure the shared key first; this script never generates a replacement key.'
}

Write-Host 'Deploying Auto Close scheduler disabled by default...'
az deployment group create `
  --resource-group $ResourceGroup `
  --template-file $templatePath `
  --parameters "workflowName=$WorkflowName" "endpointUri=$EndpointUri" "automationKey=$automationKey" "workflowState=Disabled" `
  --only-show-errors --output none

if ($EnableAutoClose) {
  az staticwebapp appsettings set `
    --name $StaticWebAppName --resource-group $ResourceGroup `
    --setting-names 'OPERATIONS_CLOSE_ENABLED=true' `
    --only-show-errors --output none
}

if ($EnableWorkflow) {
  az resource update `
    --resource-group $ResourceGroup --name $WorkflowName `
    --resource-type Microsoft.Logic/workflows --api-version 2019-05-01 `
    --set properties.state=Enabled --only-show-errors --output none
}

az resource show `
  --resource-group $ResourceGroup --name $WorkflowName `
  --resource-type Microsoft.Logic/workflows --api-version 2019-05-01 `
  --query '{name:name,state:properties.state,location:location}' --output table
