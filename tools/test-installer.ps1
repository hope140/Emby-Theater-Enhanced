param([switch]$AuthorizedInstallTest)
$ErrorActionPreference = 'Stop'
if (-not $AuthorizedInstallTest) { throw 'Installation requires explicit user authorization. Supply -AuthorizedInstallTest only after approval.' }
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'test-output\\installer'
$key = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{868314CE-1253-46A3-A4EA-55CDE71BCF0A}_is1'
$testData = Join-Path $root ('.work/installer-test-' + [guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $target) { throw 'Test directory already exists; preserve it and inspect manually.' }
if (Test-Path -LiteralPath $key) { throw 'Existing Enhanced installation record; do not replace another install.' }
if (@(Get-Process -Name 'Emby.Theater' -ErrorAction SilentlyContinue).Count) { throw 'An existing host is running; do not interrupt it.' }
$profileRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'EmbyTheaterEnhanced'
if (Test-Path -LiteralPath $profileRoot) { throw 'Existing Enhanced profile must not be used for the automated installation test.' }
$desktopLink = Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Emby Theater Enhanced.lnk'
$menuLink = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Emby Theater Enhanced/Emby Theater Enhanced.lnk'
foreach ($link in @($desktopLink,$menuLink)) { if (Test-Path -LiteralPath $link) { throw 'Existing Enhanced shortcut; preserve it.' } }
New-Item -ItemType Directory -Path $testData -Force | Out-Null
$result = [ordered]@{ target='E:/Emby Theater Enhanced Test'; steps=@(); uninstall=$false }
function Write-Result { $result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $testData 'installer-test.json') -Encoding UTF8 }
function Assert-Payload {
    $build = Get-Content -LiteralPath (Join-Path $target 'build-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($entry in $build.files) {
        if ((Get-FileHash -LiteralPath (Join-Path $target $entry.path)).Hash -ne $entry.sha256) { throw "Installed file mismatch: $($entry.path)" }
    }
    return $build.files.Count
}
try {
    foreach ($version in @('0.1.0','0.1.1')) {
        $installer = Join-Path $root "dist/EmbyTheaterEnhanced-$version-win-x64-setup.exe"
        $arguments = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /TASKS="desktopicon" /DIR="' + $target + '" /LOG="' + (Join-Path $testData "install-$version.log") + '"'
        $setupProcess = Start-Process -FilePath $installer -ArgumentList $arguments -WindowStyle Hidden -PassThru
        if (-not $setupProcess.WaitForExit(60000)) { throw 'Installation did not finish in 60 seconds; inspect installer process before further operations.' }
        if ($setupProcess.ExitCode -ne 0) { throw "Installer failed: $($setupProcess.ExitCode)" }
        $record = Get-ItemProperty -LiteralPath $key
        if ([IO.Path]::GetFullPath($record.InstallLocation).TrimEnd('\') -ne $target -or $record.DisplayVersion -ne $version) { throw 'Installed registry metadata mismatch.' }
        $fileCount = Assert-Payload
        if (-not (Test-Path -LiteralPath $desktopLink) -or -not (Test-Path -LiteralPath $menuLink)) { throw 'Installation shortcuts missing.' }
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($menuLink)
        if ([IO.Path]::GetFullPath($shortcut.TargetPath) -ne [IO.Path]::GetFullPath((Join-Path $target 'Emby.Theater.exe')) -or [string]$shortcut.Arguments -ne '' -or $shortcut.WorkingDirectory -ne $target) { throw 'Shortcut does not point directly to Emby.Theater.exe.' }
        $result.steps += [ordered]@{version=$version;exitCode=$setupProcess.ExitCode;payloadFiles=$fileCount;registry=$true;desktopShortcut=$true;startMenuShortcut=$true}
        Write-Result
        Write-Output "Installed and verified $version ($fileCount files)."
    }
    # Execute exactly the installed shortcut's target/arguments, without shell association ambiguity.
    $launcher = Start-Process -FilePath $shortcut.TargetPath -ArgumentList $shortcut.Arguments -WorkingDirectory $shortcut.WorkingDirectory -WindowStyle Hidden -PassThru
    if (-not $launcher.WaitForExit(15000)) { throw 'Shortcut launcher did not exit.' }
    Start-Sleep -Seconds 8
    $processes = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($target + '\',[StringComparison]::OrdinalIgnoreCase) })
    $diag = Join-Path $profileRoot 'logs/ete-client.jsonl'
    $result.launch = [ordered]@{launcherExitCode=$launcher.ExitCode;hostCount=@($processes|Where-Object {$_.Name -eq 'Emby.Theater.exe'}).Count;electronCount=@($processes|Where-Object {$_.Name -eq 'electron.exe'}).Count;diagnosticLog=(Test-Path -LiteralPath $diag)}
    Write-Result
    if ($result.launch.hostCount -lt 1 -or $result.launch.electronCount -lt 1 -or -not $result.launch.diagnosticLog) { throw 'Installed shortcut launch failed.' }
    Write-Output 'Installed shortcut launched the Windows host and Electron successfully.'
} finally {
    # Only this authorized installation directory; existing clients cannot match the boundary.
    Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($target + '\',[StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
    $uninstaller = Join-Path $target 'unins000.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        $uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -WindowStyle Hidden -PassThru
        if (-not $uninstallProcess.WaitForExit(60000)) { throw 'Uninstall did not finish; inspect preserved state.' }
        Start-Sleep -Seconds 2
        $result.uninstall = [ordered]@{exitCode=$uninstallProcess.ExitCode;registryRemoved=(-not(Test-Path -LiteralPath $key));desktopRemoved=(-not(Test-Path -LiteralPath $desktopLink));menuRemoved=(-not(Test-Path -LiteralPath $menuLink));targetRemoved=(-not(Test-Path -LiteralPath $target));profilePreserved=(Test-Path -LiteralPath $profileRoot)}
    }
    Write-Result
    Write-Output ('Evidence: ' + $testData.Substring($root.Length + 1))
}
$result | ConvertTo-Json -Depth 10
if (-not $result.uninstall -or $result.uninstall.exitCode -ne 0 -or -not $result.uninstall.registryRemoved -or -not $result.uninstall.desktopRemoved -or -not $result.uninstall.menuRemoved -or -not $result.uninstall.targetRemoved) { throw 'Uninstall acceptance failed; inspect evidence and remaining files.' }
