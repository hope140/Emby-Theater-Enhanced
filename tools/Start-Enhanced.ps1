param([switch]$Wait)
$ErrorActionPreference = 'Stop'
$profileRoot = Join-Path $env:APPDATA 'EmbyTheaterEnhanced'
# Seed only missing settings. Avoid legacy host driver installation prompts and auto-update.
foreach ($part in @('config','cec-driver')) { New-Item -ItemType Directory -Path (Join-Path $profileRoot $part) -Force | Out-Null }
$systemConfig = Join-Path $profileRoot 'config/system.xml'
if (-not (Test-Path -LiteralPath $systemConfig)) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'config/system.xml') -Destination $systemConfig }
$cancel = Join-Path $profileRoot 'cec-driver/cancel'
if (-not (Test-Path -LiteralPath $cancel)) { [IO.File]::WriteAllText($cancel, '') }
$process = Start-Process -FilePath (Join-Path $PSScriptRoot 'Emby.Theater.exe') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
if ($Wait) { $process.WaitForExit(); exit $process.ExitCode }
