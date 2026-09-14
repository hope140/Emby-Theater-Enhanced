param([string]$RuntimeName = 'EmbyTheaterEnhanced-win-x64', [string]$Compiler = '', [switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if ($RuntimeName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw 'Invalid runtime name.' }
$runtime = Join-Path (Join-Path $root 'dist') $RuntimeName
$sourceCommit = ([string]((& git -C $root rev-parse HEAD 2>$null) | Select-Object -First 1)).Trim()
if ($sourceCommit -notmatch '^[0-9a-fA-F]{40}$') { throw 'Unable to resolve source git commit.' }
$provenanceText = (& node (Join-Path $root 'tools/runtime-provenance.cjs') validate $root $runtime $sourceCommit 2>$null | Out-String)
$provenanceExit = $LASTEXITCODE
$provenance = $null
try { $provenance = $provenanceText | ConvertFrom-Json } catch { }
if ($provenanceExit -ne 0 -or $null -eq $provenance -or $provenance.status -ne 'passed') { throw 'Runtime provenance validation failed before packaging.' }
$build = Get-Content -LiteralPath (Join-Path $runtime 'build-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$expectedPaths = @($build.files | ForEach-Object { $_.path }) + @('build-manifest.json')
$actualFiles = @(Get-ChildItem -LiteralPath $runtime -Recurse -File)
if ($actualFiles.Count -ne $expectedPaths.Count) { throw 'Unexpected runtime files; rebuild before packaging.' }
foreach ($actual in $actualFiles) {
    $relative = $actual.FullName.Substring($runtime.Length + 1).Replace('\','/')
    if ($relative -notin $expectedPaths) { throw "Unexpected runtime file: $relative" }
}
foreach ($file in $build.files) {
    if ((Get-FileHash -LiteralPath (Join-Path $runtime $file.path) -Algorithm SHA256).Hash -ne $file.sha256) { throw "Runtime changed since build: $($file.path)" }
}
if ($VerifyOnly) { Write-Output "Runtime payload verified: $($build.files.Count) files"; return }
if (-not $Compiler) {
    $localCompiler = Join-Path $root '.work/toolchain/inno/{app}/ISCC.exe'
    if (Test-Path -LiteralPath $localCompiler) { $Compiler = $localCompiler }
    else { $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue; if ($command) { $Compiler = $command.Source } }
}
if (-not $Compiler -or -not (Test-Path -LiteralPath $Compiler)) { throw 'Inno Setup 6 compiler missing. Provide -Compiler path/to/ISCC.exe; no software is installed automatically.' }
$output = Join-Path $root "dist/EmbyTheaterEnhanced-$($build.version)-win-x64-setup.exe"
if (Test-Path -LiteralPath $output) { throw 'Installer already exists; preserve it before packaging again.' }
& $Compiler '/Q' "/DAppVersion=$($build.version)" "/DRuntimeDir=$runtime" "/DOutputDir=$(Join-Path $root 'dist')" (Join-Path $root 'installer/EmbyTheaterEnhanced.iss')
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $output)) { throw 'Installer compilation failed.' }
Get-FileHash -LiteralPath $output -Algorithm SHA256
