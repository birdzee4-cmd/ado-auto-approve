param(
  [Parameter(Mandatory = $true)]
  [string]$WorkbookPath,

  [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $PSScriptRoot '..\api\shared\production-deployments-2026.json'
}

function Get-CellText {
  param($Sheet, [int]$Row, [int]$Column)
  return [string]$Sheet.Cells.Item($Row, $Column).Text
}

function Convert-SheetRows {
  param(
    $Sheet,
    [string]$Category
  )

  $usedRange = $Sheet.UsedRange
  $columnCount = [int]$usedRange.Columns.Count
  $rowCount = [int]$usedRange.Rows.Count
  $headers = @()

  for ($column = 1; $column -le $columnCount; $column++) {
    $headers += (Get-CellText -Sheet $Sheet -Row 1 -Column $column).Trim()
  }

  $rows = [System.Collections.Generic.List[object]]::new()
  for ($row = 2; $row -le $rowCount; $row++) {
    $jobNo = (Get-CellText -Sheet $Sheet -Row $row -Column 1).Trim()
    $deployDate = (Get-CellText -Sheet $Sheet -Row $row -Column 2).Trim()
    $taskId = (Get-CellText -Sheet $Sheet -Row $row -Column 4).Trim()
    $project = (Get-CellText -Sheet $Sheet -Row $row -Column 8).Trim()
    $labelCode = (Get-CellText -Sheet $Sheet -Row $row -Column 10).Trim()
    if ([string]::IsNullOrWhiteSpace($jobNo) -or (
      [string]::IsNullOrWhiteSpace($deployDate) -and
      [string]::IsNullOrWhiteSpace($taskId) -and
      [string]::IsNullOrWhiteSpace($project) -and
      [string]::IsNullOrWhiteSpace($labelCode)
    )) { continue }

    $source = [ordered]@{}
    for ($column = 1; $column -le $columnCount; $column++) {
      $header = $headers[$column - 1]
      if ([string]::IsNullOrWhiteSpace($header)) { continue }
      $source[$header] = Get-CellText -Sheet $Sheet -Row $row -Column $column
    }

    $rows.Add([ordered]@{
      category = $Category
      sourceSheet = $Sheet.Name
      sourceRow = $row
      jobNo = $source['Job No.']
      deployDate = $source['Deploy DateN']
      deployDateDisplay = $source['Deploy Date']
      taskId = $source['Task ID']
      projectsMainSort = $source['Projects Main Sort']
      projectsSubType = $source['Projects Sub Type']
      deployType = $source['Deploy Type']
      projects = $source['Projects']
      action = $source["Type `r`n(Get/Merge)"]
      labelCode = $source['Label Code']
      durationDeploy = $source['Duration Deploy']
      deployStatus = Get-CellText -Sheet $Sheet -Row $row -Column 12
      documentStatus = $source["Document`r`nStatus"]
      remark = $source['Remark']
      swapBackType = $source['SwapBack Type']
      swapBackDetails = $source['SwapBack Details']
      logSwapBack1 = $source['Log Swap Back 1']
      logSwapBack2 = $source['Log Swap Back 2']
      logSwapBack3 = $source['Log Swap Back 3']
      logSwapBack4 = $source['Log Swap Back 4']
    })
  }

  return $rows
}

$resolvedWorkbook = (Resolve-Path -LiteralPath $WorkbookPath).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $resolvedOutput
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
  $workbook = $excel.Workbooks.Open($resolvedWorkbook, 0, $true)
  try {
    $webServiceRows = Convert-SheetRows -Sheet $workbook.Worksheets.Item('2026') -Category 'web-service'
    $mobileRows = Convert-SheetRows -Sheet $workbook.Worksheets.Item('2026 (APP)') -Category 'mobile-app'
    $allRows = @($webServiceRows) + @($mobileRows)

    $payload = [ordered]@{
      year = 2026
      sourceFile = [System.IO.Path]::GetFileName($resolvedWorkbook)
      sourceLastModified = (Get-Item -LiteralPath $resolvedWorkbook).LastWriteTime.ToString('yyyy-MM-ddTHH:mm:sszzz')
      importedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
      counts = [ordered]@{
        webService = @($webServiceRows).Count
        mobileApp = @($mobileRows).Count
        total = @($allRows).Count
      }
      rows = $allRows
    }

    $json = $payload | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText($resolvedOutput, $json, [System.Text.UTF8Encoding]::new($false))
    Write-Output "Imported $($payload.counts.total) rows to $resolvedOutput"
  }
  finally {
    $workbook.Close($false)
    [Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null
  }
}
finally {
  $excel.Quit()
  [Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
