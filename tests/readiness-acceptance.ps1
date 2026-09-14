param(
    [string]$RuntimeName = 'EmbyTheaterEnhanced-0.1.1-readiness-main-20260914',
    [string]$RunPrefix = 'run',
    [string]$Methods = '',
    [int]$TimeoutMs = 180000,
    [switch]$AuthorizedLivePlayback,
    [switch]$ValidationOnly,
    [switch]$Synthetic,
    [switch]$SyntheticCimUnavailable,
    [ValidateSet('timeout', 'success', 'failure', 'identity-mismatch', 'cim-unavailable')]
    [string]$SyntheticResult = 'timeout'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if ($RuntimeName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw 'Invalid runtime name.' }
if ($RunPrefix -notmatch '^[A-Za-z0-9._-]+$') { throw 'Invalid run prefix.' }
if ($Methods -and $Methods -notmatch '^[A-Za-z]+(?:,[A-Za-z]+)*$') { throw 'Methods must be a comma-separated method list.' }
if ($TimeoutMs -lt 250 -or $TimeoutMs -gt 900000) { throw 'TimeoutMs must be between 250 and 900000.' }
if ($SyntheticCimUnavailable -and -not $Synthetic) { throw 'SyntheticCimUnavailable requires Synthetic.' }
if (-not $Synthetic -and -not $ValidationOnly -and -not $AuthorizedLivePlayback) { throw 'Explicit live playback authorization is required.' }

$runtime = Join-Path $root ('dist\' + $RuntimeName)
if (-not $Synthetic -and -not (Test-Path -LiteralPath (Join-Path $runtime 'x64\electron\electron.exe') -PathType Leaf)) {
    throw 'Requested runtime does not exist.'
}

$runRoot = Join-Path $root '.work\readiness-runs'
$runId = $RunPrefix + '-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssfff') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 8))
$output = Join-Path $runRoot $runId
New-Item -ItemType Directory -Path $output -Force | Out-Null
$acceptancePath = Join-Path $output 'acceptance.json'

$runnerStarted = [DateTimeOffset]::UtcNow
$rootPid = $null
$processExitCode = $null
$timedOut = $false
$terminalObserved = $false
$terminalClassification = $null
$terminalObservedElapsedMs = $null
$startError = $null
$ownershipInspection = 'unavailable'
$ownershipIssues = New-Object 'System.Collections.Generic.HashSet[string]'
$cimUnavailable = $false
$cleanupStatus = 'not-started'
$ownershipVerified = $false
$ownedPids = New-Object 'System.Collections.Generic.HashSet[int]'
$ownedRecords = @{}
$stdoutTask = $null
$stderrTask = $null
$process = $null
$finalExitCode = 1

function Write-Utf8Text([string]$path, [string]$value) {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($path, ($value | Out-String), $utf8)
}

function Get-SourceCommit {
    try {
        return ([string]((& git -C $root rev-parse HEAD 2>$null) | Select-Object -First 1)).Trim()
    } catch {
        return ''
    }
}

function Get-RuntimeValidation([string]$runtimePath, [string]$runtimeName, [string]$sourceCommit) {
    $tool = Join-Path $root 'tools/runtime-provenance.cjs'
    $text = (& node $tool validate $root $runtimePath $sourceCommit 2>$null | Out-String)
    $exitCode = $LASTEXITCODE
    try {
        $result = $text | ConvertFrom-Json
        if ($exitCode -ne 0 -and $result.status -eq 'passed') { $result.status = 'failed' }
        return $result
    } catch {
        return [ordered]@{
            schemaVersion = 1
            status = 'failed'
            sourceCommit = $sourceCommit
            runtimeName = $runtimeName
            manifest = 'runtime-provenance.json'
            baselineIdentity = $null
            validatedProductScope = $null
            files = @()
            errors = @('runtime-provenance-validator-failed')
        }
    }
}

$sourceCommit = Get-SourceCommit
$runtimeValidation = if ($Synthetic) {
    [ordered]@{ status = 'skipped'; sourceCommit = $sourceCommit; runtimeName = $RuntimeName; resolverDirectory = 'not-checked'; containsResolveAsyncCall = $null; containsResolverResultMarker = $null; criticalFiles = @(); errors = @() }
} else {
    Get-RuntimeValidation -runtimePath $runtime -runtimeName $RuntimeName -sourceCommit $sourceCommit
}

if (-not $Synthetic -and -not $ValidationOnly -and $runtimeValidation.status -ne 'passed') {
    Write-Utf8Text (Join-Path $output 'stdout.txt') ''
    Write-Utf8Text (Join-Path $output 'stderr.txt') ''
    $elapsedMs = [int]([DateTimeOffset]::UtcNow - $runnerStarted).TotalMilliseconds
    $failureResult = [ordered]@{
        schemaVersion = 1
        runnerResult = 'runtime-validation-failed'
        runtimeName = $RuntimeName
        sourceCommit = $sourceCommit
        runtimeValidation = $runtimeValidation
        rootPid = $null
        elapsedMs = $elapsedMs
        deadlineMs = $TimeoutMs
        processExitCode = $null
        runnerExitCode = 1
        acceptanceReportPresent = $false
        stdoutPresent = $true
        stderrPresent = $true
        ownershipInspection = 'not-started'
        cleanupStatus = 'not-started'
        ownershipVerified = $false
        residualOwnedProcesses = $null
        residualOwnedProcessesKnown = $false
        residualOwnedPids = @()
        cleanup = 'not-started'
        output = $output
        error = 'runtime-validation-failed'
    }
    $failureJson = $failureResult | ConvertTo-Json -Depth 12
    Write-Utf8Text (Join-Path $output 'runner-result.json') $failureJson
    Write-Output $failureJson
    exit 1
}

if ($ValidationOnly) {
    $validationPassed = $runtimeValidation.status -eq 'passed'
    Write-Utf8Text (Join-Path $output 'stdout.txt') ''
    Write-Utf8Text (Join-Path $output 'stderr.txt') ''
    $validationResult = [ordered]@{
        schemaVersion = 1
        runnerResult = if ($validationPassed) { 'runtime-validation-passed' } else { 'runtime-validation-failed' }
        runtimeName = $RuntimeName
        sourceCommit = $sourceCommit
        runtimeValidation = $runtimeValidation
        terminalResult = [ordered]@{ observed = $true; source = 'runtime-validation'; classification = if ($validationPassed) { 'runtime-validation-passed' } else { 'runtime-validation-failed' }; observedElapsedMs = [int]([DateTimeOffset]::UtcNow - $runnerStarted).TotalMilliseconds }
        rootPid = $null
        elapsedMs = [int]([DateTimeOffset]::UtcNow - $runnerStarted).TotalMilliseconds
        deadlineMs = $TimeoutMs
        timedOut = $false
        processExitCode = $null
        runnerExitCode = if ($validationPassed) { 0 } else { 1 }
        acceptanceReportPresent = $false
        stdoutPresent = $true
        stderrPresent = $true
        ownershipInspection = 'not-started'
        ownershipIssues = @()
        cleanupStatus = 'not-started'
        ownershipVerified = $false
        residualOwnedProcesses = $null
        residualOwnedProcessesKnown = $false
        residualOwnedPids = @()
        cleanup = 'not-started'
        output = $output
        error = if ($validationPassed) { $null } else { 'runtime-validation-failed' }
    }
    $validationJson = $validationResult | ConvertTo-Json -Depth 12
    Write-Utf8Text (Join-Path $output 'runner-result.json') $validationJson
    Write-Output $validationJson
    exit $validationResult.runnerExitCode
}

function Get-ProcessSnapshot {
    if ($SyntheticCimUnavailable) {
        $script:cimUnavailable = $true
        $script:ownershipInspection = 'unavailable'
        Add-OwnershipIssue 'cim-unavailable'
        return $null
    }
    try {
        return @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop | ForEach-Object {
            [pscustomobject]@{
                Id = [int]$_.ProcessId
                ParentId = [int]$_.ParentProcessId
                Name = [string]$_.Name
                CreationDate = [string]$_.CreationDate
            }
        })
    } catch {
        $script:cimUnavailable = $true
        $script:ownershipInspection = 'unavailable'
        Add-OwnershipIssue 'cim-unavailable'
        return $null
    }
}

function Get-OwnedTree([object[]]$snapshot, [int]$ownerPid) {
    $tree = @{}
    if ($ownerPid -gt 0) { $tree[$ownerPid] = $true }
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($row in @($snapshot)) {
            if ($tree.ContainsKey([int]$row.ParentId) -and -not $tree.ContainsKey([int]$row.Id)) {
                $tree[[int]$row.Id] = $true
                $changed = $true
            }
        }
    }
    return @($tree.Keys | ForEach-Object { [int]$_ })
}

function Observe-OwnedTree {
    if ($null -eq $rootPid) { return }
    $snapshot = Get-ProcessSnapshot
    if ($null -eq $snapshot) { return }
    $tree = Get-OwnedTree -snapshot $snapshot -ownerPid $rootPid
    $script:ownershipInspection = 'ok'
    foreach ($ownedId in $tree) {
        [void]$ownedPids.Add([int]$ownedId)
        if (-not $ownedRecords.ContainsKey([int]$ownedId)) {
            $match = @($snapshot | Where-Object { [int]$_.Id -eq [int]$ownedId } | Select-Object -First 1)
            if ($match.Count -gt 0) { $ownedRecords[[int]$ownedId] = $match[0] }
        }
    }
}

function Get-LiveOwnedRecords {
    $snapshot = Get-ProcessSnapshot
    if ($null -eq $snapshot) { return @() }
    $script:ownershipInspection = 'ok'
    $live = @()
    foreach ($ownedId in @($ownedPids)) {
        $expected = $ownedRecords[[int]$ownedId]
        if ($null -eq $expected -or [string]::IsNullOrEmpty([string]$expected.CreationDate)) {
            Add-OwnershipIssue 'ownership-mismatch'
            continue
        }
        $matches = @($snapshot | Where-Object {
            [int]$_.Id -eq [int]$ownedId -and
            [string]$_.CreationDate -eq [string]$expected.CreationDate
        })
        if ($matches.Count -gt 0) { $live += $matches[0] }
    }
    return @($live)
}

function Add-OwnershipIssue([string]$issue) {
    if ($issue) { [void]$ownershipIssues.Add($issue) }
}

function Get-RootOwnership {
    if ($null -eq $rootPid) { return [pscustomobject]@{ status = 'no-root' } }
    $snapshot = Get-ProcessSnapshot
    if ($null -eq $snapshot) { return [pscustomobject]@{ status = 'unavailable' } }
    $script:ownershipInspection = 'ok'
    $current = @($snapshot | Where-Object { [int]$_.Id -eq [int]$rootPid } | Select-Object -First 1)
    if ($current.Count -eq 0) { return [pscustomobject]@{ status = 'exited' } }
    $expected = $ownedRecords[[int]$rootPid]
    if ($null -eq $expected -or [string]::IsNullOrEmpty([string]$expected.CreationDate)) {
        Add-OwnershipIssue 'ownership-mismatch'
        return [pscustomobject]@{ status = 'mismatch' }
    }
    if ([string]$current[0].CreationDate -ne [string]$expected.CreationDate) {
        Add-OwnershipIssue 'pid-reused'
        Add-OwnershipIssue 'ownership-mismatch'
        return [pscustomobject]@{ status = 'pid-reused'; expectedCreationDate = [string]$expected.CreationDate; currentCreationDate = [string]$current[0].CreationDate }
    }
    return [pscustomobject]@{ status = 'owned' }
}

function Stop-OwnedRoot {
    $ownership = Get-RootOwnership
    if ($ownership.status -eq 'owned') { Stop-ExactProcessTree -targetPid ([int]$rootPid) }
    return $ownership.status
}

function Get-TerminalAcceptance([string]$reportPath) {
    if (-not (Test-Path -LiteralPath $reportPath -PathType Leaf)) { return $null }
    try {
        $report = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($report.completed -ne $true) { return $null }
        $classification = [string]$report.acceptanceResult
        if ([string]::IsNullOrWhiteSpace($classification)) { $classification = [string]$report.error }
        if ([string]::IsNullOrWhiteSpace($classification)) { $classification = [string]$report.reason }
        if ($classification -notmatch '^[A-Za-z0-9._-]+$') { return $null }
        return [pscustomobject]@{ completed = $true; classification = $classification }
    } catch {
        return $null
    }
}

function Stop-ExactProcessTree([int]$targetPid) {
    if ($targetPid -le 0) { return }
    try { & taskkill.exe /PID ([string]$targetPid) /T /F 2>$null | Out-Null } catch { }
}

function Stop-OwnedProcesses([bool]$includeRoot) {
    Observe-OwnedTree
    if ($cimUnavailable) { return }
    if ($includeRoot -and $null -ne $rootPid) { [void](Stop-OwnedRoot) }
    for ($attempt = 0; $attempt -lt 8; $attempt++) {
        $live = @(Get-LiveOwnedRecords | Where-Object { $null -eq $rootPid -or [int]$_.Id -ne [int]$rootPid })
        if ($live.Count -eq 0) { break }
        foreach ($row in $live) { Stop-ExactProcessTree -targetPid ([int]$row.Id) }
        Start-Sleep -Milliseconds 200
    }
}

function Read-AsyncText($task) {
    if ($null -eq $task) { return '' }
    try {
        if (-not $task.Wait(5000)) { return '<stream-drain-timeout>' }
        return [string]$task.Result
    } catch {
        return '<stream-read-error>'
    }
}

function New-StartInfo {
    $info = New-Object Diagnostics.ProcessStartInfo
    if ($Synthetic) {
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        $info.FileName = $node
        $child = Join-Path $root 'tests\synthetic-acceptance-child.cjs'
        $info.Arguments = '"' + $child + '" "' + $output + '" "' + $SyntheticResult + '"'
        $info.WorkingDirectory = $root
    } else {
        $harness = Join-Path $root 'tools\acceptance-electron.cjs'
        $profile = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'EmbyTheaterEnhanced-Acceptance'
        $cec = Join-Path $runtime 'cec\cec-client.x64.exe'
        $info.FileName = Join-Path $runtime 'x64\electron\electron.exe'
        # Keep the proven ProcessStartInfo argument shape: quoted script, profile and CEC path.
        $info.Arguments = '"' + $harness + '" "' + $profile + '" "' + $cec + '"'
        $info.WorkingDirectory = $runtime
    }
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    if (-not $Synthetic) {
        $info.EnvironmentVariables['ETE_ACCEPT_RUNTIME'] = $runtime
        $info.EnvironmentVariables['ETE_ACCEPT_OUTPUT'] = $output
        $info.EnvironmentVariables['ETE_ACCEPT_EPOCH'] = [string][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $info.EnvironmentVariables['ETE_ACCEPT_RUNTIME_NAME'] = $RuntimeName
        $info.EnvironmentVariables['ETE_ACCEPT_SOURCE_COMMIT'] = $sourceCommit
        $info.EnvironmentVariables['ETE_ACCEPT_RUNTIME_VALIDATED'] = '1'
        foreach ($name in @('ETE_ACCEPT_METHODS', 'ETE_ACCEPT_INSPECT_ONLY', 'ETE_ACCEPT_SELECT_ONLY', 'ETE_ACCEPT_DIRECT_SMOKE', 'ETE_ACCEPT_VISUAL', 'ETE_ACCEPT_PROFILE_INSPECT', 'ETE_ACCEPT_MANUAL_LOGIN')) {
            $info.EnvironmentVariables.Remove($name)
        }
        if ($Methods) { $info.EnvironmentVariables['ETE_ACCEPT_METHODS'] = $Methods }
    }
    $info.EnvironmentVariables.Remove('ELECTRON_RUN_AS_NODE')
    return $info
}

try {
    $info = New-StartInfo
    $process = [Diagnostics.Process]::Start($info)
    if ($null -eq $process) { throw 'Process start returned no process.' }
    $rootPid = [int]$process.Id
    [void]$ownedPids.Add($rootPid)
    Observe-OwnedTree
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()

    $deadline = [DateTimeOffset]::UtcNow.AddMilliseconds($TimeoutMs)
    $exited = $false
    while (-not $exited) {
        Observe-OwnedTree
        $terminal = Get-TerminalAcceptance -reportPath $acceptancePath
        if ($null -ne $terminal) {
            $terminalObserved = $true
            $terminalClassification = $terminal.classification
            $terminalObservedElapsedMs = [int]([DateTimeOffset]::UtcNow - $runnerStarted).TotalMilliseconds
            if ($Synthetic -and $SyntheticResult -eq 'identity-mismatch') {
                $expectedRoot = $ownedRecords[[int]$rootPid]
                if ($null -ne $expectedRoot) {
                    $ownedRecords[[int]$rootPid] = [pscustomobject]@{ Id = $expectedRoot.Id; ParentId = $expectedRoot.ParentId; Name = $expectedRoot.Name; CreationDate = 'synthetic-pid-reused' }
                } else {
                    Add-OwnershipIssue 'ownership-mismatch'
                }
            }
            # Let the final JSON write and stdout/stderr flush settle, then own the cleanup.
            Start-Sleep -Milliseconds 300
            Stop-OwnedProcesses -includeRoot $true
            if ($process.HasExited) { $processExitCode = $process.ExitCode }
            $exited = $true
            break
        }
        $remaining = [int][Math]::Max(1, ($deadline - [DateTimeOffset]::UtcNow).TotalMilliseconds)
        if ($remaining -le 1) {
            if ($process.HasExited) { $exited = $true; break }
            $timedOut = $true
            break
        }
        $exited = $process.WaitForExit([Math]::Min(250, $remaining))
        if ($exited) {
            $processExitCode = $process.ExitCode
            $terminal = Get-TerminalAcceptance -reportPath $acceptancePath
            if ($null -ne $terminal) {
                $terminalObserved = $true
                $terminalClassification = $terminal.classification
                $terminalObservedElapsedMs = [int]([DateTimeOffset]::UtcNow - $runnerStarted).TotalMilliseconds
            }
        }
        if (-not $exited -and [DateTimeOffset]::UtcNow -ge $deadline) {
            if ($process.HasExited) { $exited = $true } else { $timedOut = $true }
        }
    }
    Observe-OwnedTree
    if ($timedOut) {
        Stop-OwnedProcesses -includeRoot $true
        if ($process.HasExited) { $processExitCode = $process.ExitCode }
    } elseif ($terminalObserved) {
        if (-not $process.HasExited) { Stop-OwnedProcesses -includeRoot $true }
        if ($process.HasExited -and $null -eq $processExitCode) { $processExitCode = $process.ExitCode }
    } else {
        if (-not $exited) { $process.WaitForExit(); $processExitCode = $process.ExitCode }
        # A naturally exited root may still have left a child holding stdout/stderr.
        Stop-OwnedProcesses -includeRoot $false
    }
} catch {
    $startError = [string]$_.Exception.Message
    if ($null -ne $process -and $null -ne $rootPid) { Stop-OwnedProcesses -includeRoot $true }
} finally {
    $stdout = Read-AsyncText $stdoutTask
    $stderr = Read-AsyncText $stderrTask
    if ($null -ne $process -and $process.HasExited -and $null -eq $processExitCode) { $processExitCode = $process.ExitCode }
    Write-Utf8Text (Join-Path $output 'stdout.txt') $stdout
    Write-Utf8Text (Join-Path $output 'stderr.txt') $stderr

    $liveFinal = @(Get-LiveOwnedRecords)
    $cleanupUnverified = $cimUnavailable -or $ownershipInspection -ne 'ok' -or @($ownershipIssues).Count -gt 0 -or $null -eq $rootPid
    if ($cleanupUnverified) {
        $cleanupStatus = 'unverified'
        $ownershipVerified = $false
        $residualPids = @()
        $residualCount = $null
    } elseif ($liveFinal.Count -gt 0) {
        $cleanupStatus = 'verified-residual'
        $ownershipVerified = $true
        $residualPids = @($liveFinal | ForEach-Object { [int]$_.Id })
        $residualCount = $residualPids.Count
    } else {
        $cleanupStatus = 'verified-clean'
        $ownershipVerified = $true
        $residualPids = @()
        $residualCount = 0
    }
    $acceptancePresent = Test-Path -LiteralPath $acceptancePath -PathType Leaf
    $elapsedMs = [int]([DateTimeOffset]::UtcNow - $runnerStarted).TotalMilliseconds
    $runnerResult = if ($startError) { 'start-failed' } elseif ($timedOut) { 'timeout' } elseif ($cleanupStatus -eq 'unverified') { 'cleanup-unverified' } elseif ($residualPids.Count -gt 0) { 'residual-owned-processes' } elseif ($terminalObserved) { 'completed' } else { 'missing-terminal-result' }
    $runnerExitCode = if ($runnerResult -eq 'completed' -and $terminalClassification -eq 'success') { 0 } elseif ($runnerResult -eq 'timeout') { 124 } else { 1 }
    $result = [ordered]@{
        schemaVersion = 1
        runnerResult = $runnerResult
        runtimeName = $RuntimeName
        sourceCommit = $sourceCommit
        runtimeValidation = $runtimeValidation
        terminalResult = [ordered]@{ observed = $terminalObserved; source = if ($terminalObserved) { 'acceptance.json completed + classification' } else { 'not-observed' }; classification = $terminalClassification; observedElapsedMs = $terminalObservedElapsedMs }
        ownershipIssues = @($ownershipIssues)
        cleanupStatus = $cleanupStatus
        ownershipVerified = $ownershipVerified
        rootPid = $rootPid
        elapsedMs = $elapsedMs
        deadlineMs = $TimeoutMs
        timedOut = $timedOut
        processExitCode = $processExitCode
        runnerExitCode = $runnerExitCode
        acceptanceReportPresent = $acceptancePresent
        stdoutPresent = (Test-Path -LiteralPath (Join-Path $output 'stdout.txt') -PathType Leaf)
        stderrPresent = (Test-Path -LiteralPath (Join-Path $output 'stderr.txt') -PathType Leaf)
        ownershipInspection = $ownershipInspection
        residualOwnedProcesses = $residualCount
        residualOwnedProcessesKnown = $ownershipVerified
        residualOwnedPids = $residualPids
        cleanup = if ($cleanupStatus -eq 'unverified') { 'not-verified' } else { 'exact-root-process-tree' }
        output = $output
        error = $startError
    }
    $json = $result | ConvertTo-Json -Depth 8
    Write-Utf8Text (Join-Path $output 'runner-result.json') $json
    Write-Output $json
    $script:finalExitCode = $runnerExitCode
}

exit $finalExitCode
