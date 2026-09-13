param([switch]$AuthorizedLivePlayback,[switch]$InspectOnly,[switch]$VisualOnly)
$ErrorActionPreference = 'Stop'
if(-not $AuthorizedLivePlayback){throw 'User authorization for sample selection/playback/remote control is required.'}
$root=Split-Path -Parent $PSScriptRoot
$runtime=Join-Path $root 'dist/EmbyTheaterEnhanced-0.1.1-final-win-x64'
if(@(Get-Process -Name 'Emby.Theater' -ErrorAction SilentlyContinue).Count){throw 'Close the idle Enhanced host before acceptance; do not interrupt existing playback.'}
$profilePath=Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'EmbyTheaterEnhanced/data/electron'
$output=Join-Path $root ('.work/live-acceptance-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $output -Force | Out-Null
$info=New-Object Diagnostics.ProcessStartInfo
$info.FileName=Join-Path $runtime 'x64/electron/electron.exe'
$info.Arguments='"'+(Join-Path $PSScriptRoot 'acceptance-electron.cjs')+'" "'+$profilePath+'" "'+(Join-Path $runtime 'cec/cec-client.x64.exe')+'"'
$info.WorkingDirectory=$runtime
$info.UseShellExecute=$false
$info.CreateNoWindow=$true
$info.RedirectStandardOutput=$true
$info.RedirectStandardError=$true
$info.EnvironmentVariables['ETE_ACCEPT_RUNTIME']=$runtime
$info.EnvironmentVariables['ETE_ACCEPT_OUTPUT']=$output
if($InspectOnly){$info.EnvironmentVariables['ETE_ACCEPT_INSPECT_ONLY']='1'}
if($VisualOnly){$info.EnvironmentVariables['ETE_ACCEPT_VISUAL']='1'}
$info.EnvironmentVariables.Remove('ELECTRON_RUN_AS_NODE')
$process=[Diagnostics.Process]::Start($info)
# Drain output without logging original client URLs, headers or tokens.
$stdout=$process.StandardOutput.ReadToEndAsync()
$stderr=$process.StandardError.ReadToEndAsync()
Write-Output ('Evidence: '+$output.Substring($root.Length+1))
while(-not $process.WaitForExit(10000)){
    $reportPath=Join-Path $output 'acceptance.json'
    if(Test-Path $reportPath){$r=Get-Content $reportPath -Raw -Encoding UTF8|ConvertFrom-Json;Write-Output ('Stage: '+$r.currentStage)}
}
$result=Get-Content (Join-Path $output 'acceptance.json') -Raw -Encoding UTF8|ConvertFrom-Json
[ordered]@{completed=$result.completed;error=$result.error;stage=$result.currentStage;steps=@($result.stages|ForEach-Object{[ordered]@{method=$_.method;ok=$_.result.ok}})}|ConvertTo-Json -Depth 6
