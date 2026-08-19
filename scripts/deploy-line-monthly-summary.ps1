[CmdletBinding()]
param(
  [string]$ResourceGroup = 'rg-ado-auto-approve',
  [string]$StaticWebAppName = 'ado-auto-approve',
  [string]$WorkflowName = 'ado-line-monthly-pr-summary-staging',
  [string]$EndpointUri = 'https://mango-wave-09cff3700.7.azurestaticapps.net/api/line-monthly-summary'
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$templatePath = Join-Path $PSScriptRoot '..\infra\line-monthly-summary.bicep'
$tokenBytes = New-Object byte[] 32
$tokenGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $tokenGenerator.GetBytes($tokenBytes)
} finally {
  $tokenGenerator.Dispose()
}
$summaryToken = [Convert]::ToBase64String($tokenBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

Write-Host 'Deploying the LINE monthly summary workflow in a disabled state...'
$deploymentArgs = @(
  'deployment', 'group', 'create',
  '--resource-group', $ResourceGroup,
  '--template-file', $templatePath,
  '--parameters', "workflowName=$WorkflowName", "endpointUri=$EndpointUri", "summaryToken=$summaryToken", 'workflowState=Disabled',
  '--only-show-errors',
  '--output', 'none'
)
az @deploymentArgs

Write-Host 'Saving the matching token in Static Web App settings...'
$settingsArgs = @(
  'staticwebapp', 'appsettings', 'set',
  '--name', $StaticWebAppName,
  '--resource-group', $ResourceGroup,
  '--setting-names', "LINE_MONTHLY_SUMMARY_TOKEN=$summaryToken",
  '--only-show-errors',
  '--output', 'none'
)
az @settingsArgs

Write-Host 'Enabling the LINE monthly summary workflow...'
$enableArgs = @(
  'resource', 'update',
  '--resource-group', $ResourceGroup,
  '--name', $WorkflowName,
  '--resource-type', 'Microsoft.Logic/workflows',
  '--api-version', '2019-05-01',
  '--set', 'properties.state=Enabled',
  '--only-show-errors',
  '--output', 'none'
)
az @enableArgs

$showArgs = @(
  'resource', 'show',
  '--resource-group', $ResourceGroup,
  '--name', $WorkflowName,
  '--resource-type', 'Microsoft.Logic/workflows',
  '--api-version', '2019-05-01',
  '--query', '{name:name,state:properties.state,location:location}',
  '--output', 'table'
)
az @showArgs
