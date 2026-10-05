[CmdletBinding()]
param(
  [string]$Hostname = 'buzzebees.sharepoint.com',
  [string]$SitePath = '/sites/ADOAuto-Approve',
  [string]$ListName = 'Operations Hub Alert Events'
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

$site = az rest --method get --url "https://graph.microsoft.com/v1.0/sites/$Hostname`:$SitePath" --output json | ConvertFrom-Json
$lists = az rest --method get --url "https://graph.microsoft.com/v1.0/sites/$($site.id)/lists?`$select=id,displayName" --output json | ConvertFrom-Json
$existing = $lists.value | Where-Object { $_.displayName -eq $ListName } | Select-Object -First 1
if ($existing) {
  Write-Host "List already exists: $ListName ($($existing.id))"
  exit 0
}

$textColumns = @('EventType','IncidentId','AlertName','Resource','RawSubject','ProcessingStatus','MatchedIncidentId','MatchMethod','ErrorCode','ErrorDetail')
$dateColumns = @('FirstSeenAt','ResolvedAt','ReceivedAt','ProcessedAt')
$columns = @()
foreach ($name in $textColumns) { $columns += @{ name = $name; text = @{} } }
$columns += @{ name = 'EventId'; indexed = $true; enforceUniqueValues = $true; text = @{ maxLength = 255 } }
$columns += @{ name = 'MessageId'; indexed = $true; enforceUniqueValues = $true; text = @{ maxLength = 255 } }
foreach ($name in $dateColumns) { $columns += @{ name = $name; dateTime = @{ format = 'dateTime'; displayAs = 'default' } } }
$columns += @{ name = 'AttemptCount'; number = @{ decimalPlaces = 'none' } }

$body = @{
  displayName = $ListName
  list = @{ template = 'genericList' }
  columns = $columns
} | ConvertTo-Json -Depth 8 -Compress

$created = az rest --method post --url "https://graph.microsoft.com/v1.0/sites/$($site.id)/lists" --headers 'Content-Type=application/json' --body $body --output json | ConvertFrom-Json
Write-Host "Created list: $($created.displayName) ($($created.id))"
