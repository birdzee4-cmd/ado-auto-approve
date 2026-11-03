# Preparation only. Execution requires separate user approval.
# Does not read DBeaver settings, secure storage, passwords or token caches.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9.-]*$')][string]$Server,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9_-]{1,128}$')][string]$Database,
    [ValidateRange(1,65535)][int]$Port = 1433,
    [Parameter(Mandatory)][string]$JavaExe,
    [Parameter(Mandatory)][string]$JdbcClasspath,
    [switch]$ConnectApproved,
    [switch]$MetadataApproved,
    [switch]$SemanticsApproved,
    [switch]$LookupMetadataApproved,
    [switch]$ModuleMetadataApproved
)
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $JavaExe -PathType Leaf)) { throw 'Java executable not found.' }
foreach ($classpathEntry in $JdbcClasspath.Split([IO.Path]::PathSeparator)) {
    if ([string]::IsNullOrWhiteSpace($classpathEntry) -or
        !(Test-Path -LiteralPath $classpathEntry -PathType Leaf) -or
        [IO.Path]::GetExtension($classpathEntry) -ne '.jar') {
        throw 'Each classpath entry must be an existing approved JAR file; no wildcard/download.'
    }
}
$probeSource = Join-Path $PSScriptRoot 'UatReadOnlyProbe.java'
$probeArguments = @('--class-path', $JdbcClasspath, $probeSource, $Server, $Database, "$Port")
if ($ConnectApproved) { $probeArguments += '--connect-approved' }
if ($MetadataApproved) { $probeArguments += '--metadata-approved' }
if ($SemanticsApproved) { $probeArguments += '--semantics-approved' }
if ($LookupMetadataApproved) { $probeArguments += '--lookup-metadata-approved' }
if ($ModuleMetadataApproved) { $probeArguments += '--module-metadata-approved' }
# Java source-file mode: no javac command or .class output in the workspace.
# JVM/interactive auth may use OS temporary resources when actually executed.
& $JavaExe @probeArguments
if ($LASTEXITCODE -ne 0) { throw "Probe stopped with exit code $LASTEXITCODE. Do not retry without approval." }
