param([string]$RuntimeName = 'EmbyTheaterEnhanced-win-x64', [switch]$TestMedia, [switch]$Visible, [switch]$TestPipeline, [switch]$TestMount, [switch]$TestCd2, [switch]$TestCd2Miss)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if ($RuntimeName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw 'Invalid runtime name.' }
if (($TestCd2 -or $TestCd2Miss) -and -not $TestPipeline) { throw 'CD2 runtime tests require -TestPipeline.' }
$runtime = Join-Path (Join-Path $root 'dist') $RuntimeName
$evidence = Join-Path $root ('.work/runtime-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $evidence 'profile'),(Join-Path $evidence 'appdata') -Force | Out-Null
$info = New-Object Diagnostics.ProcessStartInfo
$info.FileName = Join-Path $runtime 'x64/electron/electron.exe'
$info.Arguments = '"' + (Join-Path $PSScriptRoot 'smoke-electron.cjs') + '" "' + (Join-Path $evidence 'profile') + '"'
$info.WorkingDirectory = $runtime
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
$info.EnvironmentVariables['ETE_TEST_RUNTIME'] = $runtime
$info.EnvironmentVariables['ETE_TEST_EVIDENCE'] = $evidence
$info.EnvironmentVariables['APPDATA'] = Join-Path $evidence 'appdata'
if ($Visible) { $info.EnvironmentVariables['ETE_TEST_VISIBLE'] = '1' }
if ($TestMedia -or $TestPipeline) {
    $fixture = Join-Path $evidence 'fixture.y4m'
    & node (Join-Path $PSScriptRoot 'make-fixture.cjs') $fixture
    if ($LASTEXITCODE -ne 0) { throw 'Fixture generation failed.' }
    $info.EnvironmentVariables['ETE_TEST_MEDIA'] = $fixture
    if ($TestMount) {
        $mountSidecar = Join-Path $evidence 'fixture.y4m.strm'
        [IO.File]::WriteAllText($mountSidecar, "fixture mount test`n")
        $info.EnvironmentVariables['ETE_TEST_MOUNT_SIDECAR'] = $mountSidecar
    }
    New-Item -ItemType Directory -Path (Join-Path $evidence 'appdata/mpv') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $evidence 'appdata/mpv/mpv.conf'), "scale=bilinear`nsub-font=ETE-CONFIG-PROBE`nvo=gpu-next`ngpu-context=d3d11`nhwdec=no`ndemuxer-max-bytes=3072MiB`n")
    # mpv uses Windows Known Folders, not the APPDATA environment override.
    $info.EnvironmentVariables['MPV_HOME'] = Join-Path $evidence 'appdata/mpv'
}
if ($TestPipeline) { $info.EnvironmentVariables['ETE_TEST_PIPELINE'] = '1' }
if ($TestCd2) { $info.EnvironmentVariables['ETE_TEST_CD2_MODE'] = 'hit'; $info.EnvironmentVariables['ETE_TEST_CD2_EXPECT'] = 'hit' }
if ($TestCd2Miss) { $info.EnvironmentVariables['ETE_TEST_CD2_MODE'] = 'miss'; $info.EnvironmentVariables['ETE_TEST_CD2_EXPECT'] = 'miss' }
if ($TestPipeline) {
    foreach ($proxyName in @('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy')) { $info.EnvironmentVariables.Remove($proxyName) }
    $info.EnvironmentVariables['NO_PROXY'] = '127.0.0.1,localhost'
}
$info.EnvironmentVariables.Remove('ELECTRON_RUN_AS_NODE')
$process = [Diagnostics.Process]::Start($info)
$waitMs = if ($info.EnvironmentVariables['ETE_TEST_CD2_EXPECT'] -eq 'real') { 55000 } else { 35000 }
if (-not $process.WaitForExit($waitMs)) { $process.Kill(); throw 'Runtime smoke did not exit within its bounded timeout.' }
$result = Get-Content -LiteralPath (Join-Path $evidence 'electron-smoke.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($result.state -and $result.state.pipeline) {
    [ordered]@{ok=$result.ok;results=$result.state.pipeline.results;next=$result.state.pipeline.next;reportCount=$result.state.pipeline.records.Count} | ConvertTo-Json -Depth 6 | Write-Output
} else { Write-Output ($result | ConvertTo-Json -Depth 8) }
Write-Output ('Evidence: ' + $evidence.Substring($root.Length + 1))
if ($process.ExitCode -ne 0 -or -not $result.ok) { throw 'Runtime smoke failed.' }
