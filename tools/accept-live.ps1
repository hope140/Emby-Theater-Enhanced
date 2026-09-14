param(
    [switch]$AuthorizedLivePlayback,
    [switch]$InspectOnly,
    [switch]$SelectOnly,
    [switch]$DirectSmokeOnly,
    [switch]$VisualOnly,
    [switch]$InspectProfile,
    [switch]$LaunchManualLogin,
    [string]$RuntimeName = 'EmbyTheaterEnhanced-0.1.1-readiness-main-20260914'
)
$ErrorActionPreference = 'Stop'
$root=Split-Path -Parent $PSScriptRoot
$repoFull=[IO.Path]::GetFullPath($root).TrimEnd('\')
function Assert-OutsideRepository([string]$candidate) {
    $candidateFull=[IO.Path]::GetFullPath($candidate).TrimEnd('\')
    $repoPrefix=$repoFull+'\'
    if($candidateFull.Equals($repoFull,[StringComparison]::OrdinalIgnoreCase) -or $candidateFull.StartsWith($repoPrefix,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'Acceptance profile must remain outside the repository.'
    }
    return $candidateFull
}
if(@($InspectProfile,$LaunchManualLogin,$InspectOnly,$SelectOnly,$DirectSmokeOnly,$VisualOnly|Where-Object{$_}).Count -gt 1){throw 'Acceptance modes are mutually exclusive.'}
if(-not $InspectProfile -and -not $LaunchManualLogin -and -not $AuthorizedLivePlayback){throw 'User authorization for sample selection/playback/remote control is required.'}
if($RuntimeName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$'){throw 'Invalid runtime name.'}
$runtime=Join-Path (Join-Path $root 'dist') $RuntimeName
if(-not (Test-Path -LiteralPath (Join-Path $runtime 'x64/electron/electron.exe'))){throw 'Requested runtime does not exist.'}
$sourceCommit=([string]((& git -C $root rev-parse HEAD 2>$null)|Select-Object -First 1)).Trim()
if($sourceCommit -notmatch '^[0-9a-fA-F]{40}$'){throw 'Unable to resolve source git commit.'}
$provenanceText=(& node (Join-Path $root 'tools/runtime-provenance.cjs') validate $root $runtime $sourceCommit 2>$null|Out-String)
$provenanceExit=$LASTEXITCODE
$provenance=$null
try{$provenance=$provenanceText|ConvertFrom-Json}catch{}
if($provenanceExit -ne 0 -or $null -eq $provenance -or $provenance.status -ne 'passed'){throw 'runtime-validation-failed'}
$profilePath=Assert-OutsideRepository (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'EmbyTheaterEnhanced-Acceptance')
if(-not $LaunchManualLogin -and @((Get-Process -Name 'Emby.Theater' -ErrorAction SilentlyContinue)).Count){throw 'Close the idle Enhanced host before acceptance; do not interrupt existing playback.'}
$profileExists=Test-Path -LiteralPath $profilePath -PathType Container
if($InspectProfile -and -not $profileExists){
    [ordered]@{path=$profilePath;exists=$false;loggedIn=$false;reason='profile-missing'}|ConvertTo-Json -Compress
    return
}
$output=Join-Path $root ('.work/live-acceptance-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $output -Force | Out-Null
$epoch=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$info=New-Object Diagnostics.ProcessStartInfo
$info.FileName=Join-Path $runtime 'x64/electron/electron.exe'
$info.Arguments='"'+(Join-Path $PSScriptRoot 'acceptance-electron.cjs')+'" "'+$profilePath+'" "'+(Join-Path $runtime 'cec/cec-client.x64.exe')+'"'
$info.WorkingDirectory=$runtime
$info.UseShellExecute=$false
$info.CreateNoWindow=(-not $LaunchManualLogin)
$info.RedirectStandardOutput=(-not $LaunchManualLogin)
$info.RedirectStandardError=(-not $LaunchManualLogin)
$info.EnvironmentVariables['ETE_ACCEPT_RUNTIME']=$runtime
$info.EnvironmentVariables['ETE_ACCEPT_OUTPUT']=$output
$info.EnvironmentVariables['ETE_ACCEPT_EPOCH']=[string]$epoch
if($InspectOnly){$info.EnvironmentVariables['ETE_ACCEPT_INSPECT_ONLY']='1'}
if($SelectOnly){$info.EnvironmentVariables['ETE_ACCEPT_SELECT_ONLY']='1'}
if($DirectSmokeOnly){$info.EnvironmentVariables['ETE_ACCEPT_DIRECT_SMOKE']='1'}
if($VisualOnly){$info.EnvironmentVariables['ETE_ACCEPT_VISUAL']='1'}
if($InspectProfile){$info.EnvironmentVariables['ETE_ACCEPT_PROFILE_INSPECT']='1'}
if($LaunchManualLogin){$info.EnvironmentVariables['ETE_ACCEPT_MANUAL_LOGIN']='1'}
$acceptLocalPrefix=[string]$info.EnvironmentVariables['ETE_CD2_LOCAL_PREFIX']
if($acceptLocalPrefix){$info.EnvironmentVariables['ETE_ACCEPT_CD2_LOCAL_PREFIX']=$acceptLocalPrefix}
$info.EnvironmentVariables.Remove('ELECTRON_RUN_AS_NODE')
$process=[Diagnostics.Process]::Start($info)
if($LaunchManualLogin){
    [ordered]@{launched=$true;exists=$profileExists;processId=$process.Id}|ConvertTo-Json -Compress
    return
}
# Drain output without logging original client URLs, headers or tokens.
$stdout=$process.StandardOutput.ReadToEndAsync()
$stderr=$process.StandardError.ReadToEndAsync()
if(-not $InspectProfile){Write-Output ('Evidence: '+$output.Substring($root.Length+1))}
while(-not $process.WaitForExit(10000)){
    $reportPath=Join-Path $output 'acceptance.json'
    if(Test-Path $reportPath){$r=Get-Content $reportPath -Raw -Encoding UTF8|ConvertFrom-Json;Write-Output ('Stage: '+$r.currentStage)}
}
$reportPath=Join-Path $output 'acceptance.json'
if(-not (Test-Path -LiteralPath $reportPath)){
    if($InspectProfile){
        [ordered]@{exists=$profileExists;loggedIn=$false;reason='inspection-error'}|ConvertTo-Json -Compress
        return
    }
    throw 'Acceptance process ended without an evidence report.'
}
$result=Get-Content $reportPath -Raw -Encoding UTF8|ConvertFrom-Json
[void]$stdout.Result
[void]$stderr.Result
if($InspectProfile){
    [ordered]@{exists=$profileExists;loggedIn=[bool]$result.loggedIn;reason=[string]$result.reason}|ConvertTo-Json -Compress
    return
}
$summary=[ordered]@{completed=$result.completed;error=$result.error;stage=$result.currentStage;steps=@($result.stages|ForEach-Object{[ordered]@{method=$_.method;ok=$_.result.ok}})}
if($null -ne $result.resolver){$summary.resolver=@($result.resolver)}
if($null -ne $result.readinessAssessment){$summary.readinessAssessment=[ordered]@{classification=$result.readinessAssessment.classification;reason=$result.readinessAssessment.reason;playbackSucceeded=$result.readinessAssessment.playbackSucceeded;authoritativeReadinessConfirmed=$result.readinessAssessment.authoritativeReadinessConfirmed;observerOnlyMiss=$result.readinessAssessment.observerOnlyMiss;pepperReadiness=$result.readinessAssessment.pepperReadiness;evidence=$result.readinessAssessment.evidence}}
if($null -ne $result.readiness){
    $summary.readiness=[ordered]@{
        failureClassification=$result.readiness.failureClassification
        failureStage=$result.readiness.failureStage
        playChain=$result.readiness.playChain
        timeline=@($result.readiness.stages|ForEach-Object{[ordered]@{stage=$_.stage;elapsedMs=$_.elapsedMs;status=$_.status}})
    }
}
$summary|ConvertTo-Json -Depth 6
if($process.ExitCode -ne 0 -or -not $result.completed -or $result.error){throw 'Live acceptance did not complete successfully.'}
