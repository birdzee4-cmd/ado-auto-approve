[CmdletBinding()]
param(
  [string]$ResourceGroup = 'rg-ado-auto-approve',
  [string]$StaticWebAppName = 'ado-auto-approve',
  [string]$WorkflowName = 'operations-hub-reconcile',
  [string]$EndpointUri = 'https://mango-wave-09cff3700.7.azurestaticapps.net/api/operations-reconcile',
  [ValidateRange(5, 60)]
  [int]$IntervalMinutes = 10,
  [ValidateRange(1, 250)]
  [int]$MaxItems = 100,
  [switch]$EnableWorkflow
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$templatePath = Join-Path $PSScriptRoot '..\infra\operations-reconcile.bicep'
$tokenBytes = New-Object byte[] 32
$tokenGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $tokenGenerator.GetBytes($tokenBytes)
} finally {
  $tokenGenerator.Dispose()
}
$automationKey = [Convert]::ToBase64String($tokenBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

# The workflow is always deployed disabled first. Enabling requires an explicit
# switch and still does not turn on OPERATIONS_RECONCILIATION_ENABLED.
Write-Host 'Deploying Operations Hub reconciliation in a disabled state...'
$deploymentArgs = @(
  'deployment', 'group', 'create',
  '--resource-group', $ResourceGroup,
  '--template-file', $templatePath,
  '--parameters', "workflowName=$WorkflowName", "endpointUri=$EndpointUri", "automationKey=$automationKey", "intervalMinutes=$IntervalMinutes", "maxItems=$MaxItems", 'workflowState=Disabled',
  '--only-show-errors',
  '--output', 'none'
)
az @deploymentArgs

Write-Host 'Saving the matching Operations Hub automation key...'
$settingsArgs = @(
  'staticwebapp', 'appsettings', 'set',
  '--name', $StaticWebAppName,
  '--resource-group', $ResourceGroup,
  '--setting-names', "OPERATIONS_AUTOMATION_KEY=$automationKey",
  '--only-show-errors',
  '--output', 'none'
)
az @settingsArgs

if ($EnableWorkflow) {
  Write-Warning 'Enabling only the scheduler. The API remains fail-closed unless OPERATIONS_RECONCILIATION_ENABLED and OPERATIONS_SYNC_ENABLED are both true.'
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
}

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
