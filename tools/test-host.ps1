param([string]$RuntimeName = 'EmbyTheaterEnhanced-win-x64')
$ErrorActionPreference = 'Stop'
if ($RuntimeName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw 'Invalid runtime name.' }
if (@(Get-Process -Name 'Emby.Theater' -ErrorAction SilentlyContinue).Count) { throw 'An Emby Windows host is already running. Leave it untouched and test later.' }
$root = Split-Path -Parent $PSScriptRoot
$evidence = Join-Path $root ('.work/host-test-' + [guid]::NewGuid().ToString('N'))
$runtime = Join-Path $evidence 'runtime'
$testProfile = Join-Path $evidence 'profile'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
Copy-Item -LiteralPath (Join-Path (Join-Path $root 'dist') $RuntimeName) -Destination $runtime -Recurse
New-Item -ItemType Directory -Path (Join-Path $testProfile 'config'),(Join-Path $testProfile 'cec-driver') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $runtime 'config/system.xml') -Destination (Join-Path $testProfile 'config/system.xml')
[IO.File]::WriteAllText((Join-Path $testProfile 'cec-driver/cancel'), '')
$configPath = Join-Path $runtime 'Emby.Theater.exe.config'
[xml]$config = [IO.File]::ReadAllText($configPath)
$config.configuration.appSettings.add | Where-Object { $_.key -eq 'ProgramDataPath' } | ForEach-Object { $_.SetAttribute('value', [string]$testProfile) }
$config.Save($configPath)
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = Join-Path $runtime 'Emby.Theater.exe'
$startInfo.WorkingDirectory = $runtime
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.EnvironmentVariables['APPDATA'] = $testProfile
$startInfo.EnvironmentVariables['LOCALAPPDATA'] = $testProfile
$process = [System.Diagnostics.Process]::Start($startInfo)
try {
    Start-Sleep -Seconds 10
    $children = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($runtime + '\', [StringComparison]::OrdinalIgnoreCase) })
$logPath = Join-Path $testProfile 'EmbyTheaterEnhanced/logs/ete-client.jsonl'
    $result = [ordered]@{ hostAlive=(-not $process.HasExited); electronProcesses=@($children | Where-Object { $_.Name -eq 'electron.exe' }).Count; diagnosticLog=(Test-Path -LiteralPath $logPath) }
    $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence 'host-smoke.json') -Encoding UTF8
    $result | ConvertTo-Json
    Write-Output ('Evidence: ' + $evidence.Substring($root.Length + 1))
    if (-not $result.hostAlive -or $result.electronProcesses -lt 1 -or -not $result.diagnosticLog) { throw 'Windows host smoke failed.' }
} finally {
    # Only processes whose executable is inside this unique disposable test copy.
    Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($runtime + '\', [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
}
