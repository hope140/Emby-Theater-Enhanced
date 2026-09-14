param([string]$OutputName = 'EmbyTheaterEnhanced-win-x64')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
if ($OutputName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw 'OutputName must be a simple directory name.' }
$sourceCommit = ([string]((& git -C $root rev-parse HEAD 2>$null) | Select-Object -First 1)).Trim()
if ($sourceCommit -notmatch '^[0-9a-fA-F]{40}$') { throw 'Unable to resolve source git commit.' }
$destination = Join-Path (Join-Path $root 'dist') $OutputName
if (Test-Path -LiteralPath $destination) { throw 'Output already exists. Choose a new -OutputName; builds never overwrite prior artifacts.' }
$manifest = Get-Content -LiteralPath (Join-Path $root 'vendor/runtime-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($group in @(@{ Root='vendor/carnival'; Files=$manifest.files }, @{ Root='vendor/patch'; Files=$manifest.patchFiles })) {
    $groupRoot = Join-Path $root $group.Root
    $expectedPaths = @($group.Files | ForEach-Object { $_.path })
    $actualFiles = @(Get-ChildItem -LiteralPath $groupRoot -Recurse -File)
    if ($actualFiles.Count -ne $expectedPaths.Count) { throw "Unexpected vendor file count: $($group.Root)" }
    foreach ($actual in $actualFiles) {
        $relative = $actual.FullName.Substring($groupRoot.Length + 1).Replace('\','/')
        if ($relative -notin $expectedPaths) { throw "Unexpected vendor file: $relative" }
    }
    foreach ($entry in $group.Files) {
        $file = Join-Path (Join-Path $root $group.Root) $entry.path
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Vendor file missing: $($entry.path). Run tools/prepare.ps1." }
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.sha256) { throw "Vendor hash mismatch: $($entry.path)" }
    }
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $root 'vendor/carnival') | Copy-Item -Destination $destination -Recurse
Get-ChildItem -LiteralPath (Join-Path $root 'src/electronapp') | Copy-Item -Destination (Join-Path $destination 'electronapp') -Recurse -Force
# The legacy External Player frontend is intentionally absent from Enhanced runtime.
# Keep vendor/carnival read-only; exclude the copied path from this fresh output.
$externalPlayerPath = Join-Path $destination 'electronapp/www/modules/externalplayer'
if (Test-Path -LiteralPath $externalPlayerPath) {
    Remove-Item -LiteralPath $externalPlayerPath -Recurse -Force
}
if (Test-Path -LiteralPath $externalPlayerPath) { throw 'External Player frontend exclusion failed.' }
& node (Join-Path $root 'tools/copy-runtime-dependencies.cjs') (Join-Path $destination 'electronapp')
if ($LASTEXITCODE -ne 0) { throw 'Runtime dependency copy failed.' }
& node (Join-Path $root 'tools/patch-playbackmanager.cjs') (Join-Path $destination 'electronapp/www/modules/common/playback/playbackmanager.js')
if ($LASTEXITCODE -ne 0) { throw 'PlaybackManager overlay failed.' }
Copy-Item -LiteralPath (Join-Path $root 'vendor/patch/payload/libmpv/mpv-1.dll') -Destination (Join-Path $destination 'electronapp/libmpv/x64/mpv-1.dll') -Force
# Settings remain at the user's existing values; the optional legacy mpv preset is not applied.
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$packagePath = Join-Path $destination 'electronapp/package.json'
$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
$package.name = 'emby-theater-enhanced'
$package.productName = 'Emby Theater Enhanced'
$package.version = $version
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($packagePath, ($package | ConvertTo-Json -Depth 10) + "`n", $utf8)
# Program Files is read-only for normal users. Keep Enhanced data separate from Carnival.
$configPath = Join-Path $destination 'Emby.Theater.exe.config'
$configText = [IO.File]::ReadAllText($configPath)
$configText = $configText.Replace('<add key="ProgramDataPath" value=""/>', '<add key="ProgramDataPath" value="%ApplicationData%\EmbyTheaterEnhanced"/>')
if (-not $configText.Contains('%ApplicationData%\EmbyTheaterEnhanced')) { throw 'ProgramDataPath anchor mismatch.' }
[IO.File]::WriteAllText($configPath, $configText, $utf8)
Copy-Item -LiteralPath (Join-Path $root 'tools/Start-Enhanced.ps1') -Destination $destination
Copy-Item -LiteralPath (Join-Path $root 'tools/Start-Enhanced.cmd') -Destination $destination
& node (Join-Path $root 'tools/runtime-provenance.cjs') write $root $destination $sourceCommit
if ($LASTEXITCODE -ne 0) { throw 'Runtime provenance generation failed.' }
$files = @(Get-ChildItem -LiteralPath $destination -Recurse -File | Sort-Object FullName | ForEach-Object {
    @{ path=$_.FullName.Substring($destination.Length + 1).Replace('\','/'); sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
})
$report = @{ version=$version; baseline=$manifest.baseline; sourceManifestSha256=(Get-FileHash -LiteralPath (Join-Path $root 'vendor/runtime-manifest.json')).Hash.ToLowerInvariant(); files=$files }
[IO.File]::WriteAllText((Join-Path $destination 'build-manifest.json'), ($report | ConvertTo-Json -Depth 10) + "`n", $utf8)
Write-Output "Build complete: dist/$OutputName ($($files.Count) files)"
