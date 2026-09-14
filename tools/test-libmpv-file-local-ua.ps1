param([string]$RuntimeName = 'EmbyTheaterEnhanced-0.1.1-cd2-resolver-final-review')
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if ($RuntimeName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw 'Invalid runtime name.' }
$runtime = Join-Path (Join-Path $root 'dist') $RuntimeName
$electron = Join-Path $runtime 'x64/electron/electron.exe'
if (-not (Test-Path -LiteralPath $electron -PathType Leaf)) { throw 'Requested runtime does not exist.' }

$evidence = Join-Path $root ('.work/libmpv-file-local-ua-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $evidence 'profile') -Force | Out-Null
$stdout = Join-Path $evidence 'stdout.log'
$stderr = Join-Path $evidence 'stderr.log'

$info = New-Object Diagnostics.ProcessStartInfo
$info.FileName = $electron
$info.Arguments = '"' + (Join-Path $PSScriptRoot 'libmpv-file-local-ua-probe.cjs') + '"'
$info.WorkingDirectory = $runtime
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.RedirectStandardOutput = $true
$info.RedirectStandardError = $true
$info.EnvironmentVariables['ETE_UA_PROBE_RUNTIME'] = $runtime
$info.EnvironmentVariables['ETE_UA_PROBE_EVIDENCE'] = $evidence
$info.EnvironmentVariables['NO_PROXY'] = '127.0.0.1,localhost'
$info.EnvironmentVariables.Remove('ELECTRON_RUN_AS_NODE')

$process = [Diagnostics.Process]::Start($info)
$outTask = $process.StandardOutput.ReadToEndAsync()
$errTask = $process.StandardError.ReadToEndAsync()
if (-not $process.WaitForExit(55000)) {
    try { $process.Kill($true) } catch { $process.Kill() }
    throw 'File-local User-Agent probe timed out.'
}
[IO.File]::WriteAllText($stdout, $outTask.Result)
[IO.File]::WriteAllText($stderr, $errTask.Result)

$report = Join-Path $evidence 'libmpv-file-local-ua-probe.json'
if (-not (Test-Path -LiteralPath $report -PathType Leaf)) {
    throw 'File-local User-Agent probe produced no evidence.'
}
Get-Content -LiteralPath $report -Raw -Encoding UTF8
Write-Output ('Evidence: ' + $evidence.Substring($root.Length + 1))
if ($process.ExitCode -ne 0) { throw 'File-local User-Agent probe failed.' }
