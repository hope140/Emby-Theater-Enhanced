param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $root 'vendor/runtime-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($archive in $manifest.archives) {
    $file = Join-Path $root $archive.pattern
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $archive.sha256) { throw 'Input archive SHA256 mismatch.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules/node-unrar-js'))) { throw 'Run npm ci --ignore-scripts first.' }
$staging = Join-Path $root ('.work/prepare-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging -Force | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $root 'vendor/carnival'))) {
    & node (Join-Path $PSScriptRoot 'extract-carnival.cjs') (Join-Path $root $manifest.archives[0].pattern) (Join-Path $staging 'carnival')
    if ($LASTEXITCODE -ne 0) { throw 'Carnival extraction failed.' }
    Copy-Item -LiteralPath (Join-Path $staging 'carnival/Emby Theater') -Destination (Join-Path $root 'vendor/carnival') -Recurse
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'vendor/patch'))) {
    Expand-Archive -LiteralPath (Join-Path $root $manifest.archives[1].pattern) -DestinationPath (Join-Path $root 'vendor/patch')
}
& node (Join-Path $PSScriptRoot 'prepare-preload.cjs') $root
if ($LASTEXITCODE -ne 0) { throw 'Prepared preload generation failed.' }
Write-Output 'Vendor inputs and prepared workspace artifacts are ready. build.ps1 checks every input before building.'
