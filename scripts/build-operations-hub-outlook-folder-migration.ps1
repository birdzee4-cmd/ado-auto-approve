param(
    [Parameter(Mandatory = $true)][ValidatePattern('^Id::')][string]$FolderId
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$artifacts = Join-Path $repo 'artifacts/power-automate'
$work = Join-Path $artifacts '_work/outlook-folder-migration'
$folderName = 'NowAlert_AppService'
$packages = @(
    @{ Source = 'OperationsHub-IncidentAutomationv3.8.44.zip'; Target = 'OperationsHub-IncidentAutomationv3.8.45-NowAlertFolder-Import.zip'; Version = '3.8.45.0'; Label = 'Operations Hub - Incident Automation v3.8.45 NowAlert Folder'; Location = 'trigger' },
    @{ Source = 'OperationsHub-AlertLifecycleReconciliationv1.0.4.zip'; Target = 'OperationsHub-AlertLifecycleReconciliationv1.0.5-NowAlertFolder-Import.zip'; Version = '1.0.5.0'; Label = 'Operations Hub - Alert Lifecycle Reconciliation v1.0.5 NowAlert Folder'; Location = 'action' }
)

foreach ($package in $packages) {
    $source = Join-Path $artifacts $package.Source
    $target = Join-Path $artifacts $package.Target
    if (-not (Test-Path -LiteralPath $source)) { throw "Missing source package: $source" }
    if (Test-Path -LiteralPath $target) { throw "Refusing to overwrite historical package: $target" }
}

if (Test-Path -LiteralPath $work) { throw "Work folder already exists: $work" }
New-Item -ItemType Directory -Path $work | Out-Null
try {
    foreach ($package in $packages) {
        $extract = Join-Path $work ([IO.Path]::GetFileNameWithoutExtension($package.Target))
        Expand-Archive -LiteralPath (Join-Path $artifacts $package.Source) -DestinationPath $extract
        $definitionFile = Get-ChildItem -LiteralPath (Join-Path $extract 'Microsoft.Flow/flows') -Filter definition.json -Recurse -File | Select-Object -First 1
        if (-not $definitionFile) { throw "Missing definition.json in $($package.Source)" }
        $wrapper = Get-Content -LiteralPath $definitionFile.FullName -Raw | ConvertFrom-Json
        $workflow = $wrapper.properties.definition
        if ($package.Location -eq 'trigger') {
            $mail = $workflow.triggers.'When_a_new_email_arrives_(V.B)'
        } else {
            $mail = $workflow.actions.Get_RESOLVED_Emails
        }
        if (-not $mail -or -not $mail.inputs.parameters.folderPath) { throw "Outlook folder binding missing in $($package.Source)" }
        $oldId = $mail.inputs.parameters.folderPath
        $mail.inputs.parameters.folderPath = $FolderId
        if ($mail.metadata) {
            $mail.metadata.PSObject.Properties.Remove($oldId)
            $mail.metadata | Add-Member -NotePropertyName $FolderId -NotePropertyValue $folderName -Force
        }
        $workflow.contentVersion = $package.Version
        $wrapper.properties.displayName = $package.Label
        $manifestFile = Join-Path $extract 'manifest.json'
        $manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
        $manifest.details.displayName = $package.Label
        $manifest.details.description = "Reads Outlook mail from $folderName."
        $manifest.details.createdTime = (Get-Date).ToUniversalTime().ToString('o')
        $assetId = (Get-Content -LiteralPath (Join-Path $extract 'Microsoft.Flow/flows/manifest.json') -Raw | ConvertFrom-Json).flowAssets.assetPaths[0]
        $manifest.resources.$assetId.details.displayName = $package.Label
        $wrapper | ConvertTo-Json -Depth 100 -Compress | Set-Content -LiteralPath $definitionFile.FullName -Encoding utf8NoBOM
        $manifest | ConvertTo-Json -Depth 100 -Compress | Set-Content -LiteralPath $manifestFile -Encoding utf8NoBOM
        $target = Join-Path $artifacts $package.Target
        Compress-Archive -Path (Join-Path $extract '*') -DestinationPath $target
        Write-Output $target
    }
} finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
