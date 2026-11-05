[CmdletBinding()]
param(
  [string]$ResourceGroup = 'rg-ado-auto-approve',
  [string]$StaticWebAppName = 'ado-auto-approve',
  [switch]$EnableCollector
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$settings = az staticwebapp appsettings list --name $StaticWebAppName --resource-group $ResourceGroup --only-show-errors -o json | ConvertFrom-Json
$collectorSecret = $settings.properties.COMPANY_MONITOR_COLLECT_KEY
if (-not $collectorSecret) {
  $collectorSecret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
  az staticwebapp appsettings set --name $StaticWebAppName --resource-group $ResourceGroup --setting-names "COMPANY_MONITOR_COLLECT_KEY=$collectorSecret" --only-show-errors -o none
}
$targetState = if ($EnableCollector) { 'Enabled' } else { 'Disabled' }
$template = Join-Path $PSScriptRoot '../infra/company-monitor-collector.bicep'
az deployment group create --name company-monitor-collector --resource-group $ResourceGroup --template-file $template --parameters "collectorKey=$collectorSecret" "workflowState=$targetState" --only-show-errors -o none
Write-Output "Company monitor collector: $targetState (every 1 minute)"
