param(
    [string]$RuntimeName = 'EmbyTheaterEnhanced-0.1.1-readiness-main-20260914',
    [string]$RunPrefix = 'run',
    [string]$Methods = '',
    [int]$TimeoutMs = 180000,
    [switch]$AuthorizedLivePlayback,
    [switch]$Synthetic,
    [ValidateSet('timeout', 'success', 'failure')]
    [string]$SyntheticResult = 'timeout'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if ($RuntimeName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw 'Invalid runtime name.' }
if ($RunPrefix -notmatch '^[A-Za-z0-9._-]+$') { throw 'Invalid run prefix.' }
if ($Methods -and $Methods -notmatch '^[A-Za-z]+(?:,[A-Za-z]+)*$') { throw 'Methods must be a comma-separated method list.' }
if ($TimeoutMs -lt 250 -or $TimeoutMs -gt 900000) { throw 'TimeoutMs must be between 250 and 900000.' }
if (-not $Synthetic -and -not $AuthorizedLivePlayback) { throw 'Explicit live playback authorization is required.' }

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
    $criticalFiles = @(
        'electronapp/plugins/libmpv.js',
        'electronapp/resolvers/strm-resolver.js',
        'electronapp/resolvers/cd2-resolver.js',
        'electronapp/enhanced/cd2-service.js'
    )
    $rows = @()
    $errors = @()
    $resolverDirectory = Join-Path $runtimePath 'electronapp/resolvers'
    $resolverDirectoryPresent = Test-Path -LiteralPath $resolverDirectory -PathType Container
    if (-not $resolverDirectoryPresent) { $errors += 'resolver-directory-missing' }
    if ($sourceCommit -notmatch '^[0-9a-fA-F]{40}$') { $errors += 'source-commit-unavailable' }

    foreach ($relative in $criticalFiles) {
        $sourcePath = Join-Path $root ('src/' + $relative)
        $runtimeFile = Join-Path $runtimePath $relative
        $sourceExists = Test-Path -LiteralPath $sourcePath -PathType Leaf
        $runtimeExists = Test-Path -LiteralPath $runtimeFile -PathType Leaf
        $sourceHash = $null
        $runtimeHash = $null
        if ($sourceExists) { $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourcePath).Hash }
        if ($runtimeExists) { $runtimeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $runtimeFile).Hash }
        $match = $sourceExists -and $runtimeExists -and ($sourceHash -eq $runtimeHash)
        $rows += [ordered]@{ path = $relative; sourceSha256 = $sourceHash; runtimeSha256 = $runtimeHash; match = $match }
        if (-not $sourceExists) { $errors += 'source-file-missing:' + $relative }
        if (-not $runtimeExists) { $errors += 'runtime-file-missing:' + $relative }
        if ($sourceExists -and $runtimeExists -and -not $match) { $errors += 'hash-mismatch:' + $relative }
    }

    $runtimeLibmpv = Join-Path $runtimePath 'electronapp/plugins/libmpv.js'
    $containsResolveAsyncCall = $false
    $containsResolverResultMarker = $false
    if (Test-Path -LiteralPath $runtimeLibmpv -PathType Leaf) {
        $libmpvText = [IO.File]::ReadAllText($runtimeLibmpv)
        $containsResolveAsyncCall = $libmpvText.Contains('strmResolver.resolveAsync')
        $containsResolverResultMarker = $libmpvText.Contains('STRM resolver: invoked')
    }
    if (-not $containsResolveAsyncCall) { $errors += 'resolveAsync-marker-missing' }
    if (-not $containsResolverResultMarker) { $errors += 'resolver-result-marker-missing' }

    return [ordered]@{
        status = if ($errors.Count -eq 0) { 'passed' } else { 'failed' }
        sourceCommit = $sourceCommit
        runtimeName = $runtimeName
        resolverDirectory = if ($resolverDirectoryPresent) { 'present' } else { 'missing' }
        containsResolveAsyncCall = $containsResolveAsyncCall
        containsResolverResultMarker = $containsResolverResultMarker
        criticalFiles = @($rows)
        errors = @($errors)
    }
}

$sourceCommit = Get-SourceCommit
$runtimeValidation = if ($Synthetic) {
    [ordered]@{ status = 'skipped'; sourceCommit = $sourceCommit; runtimeName = $RuntimeName; resolverDirectory = 'not-checked'; containsResolveAsyncCall = $null; containsResolverResultMarker = $null; criticalFiles = @(); errors = @() }
} else {
    Get-RuntimeValidation -runtimePath $runtime -runtimeName $RuntimeName -sourceCommit $sourceCommit
}

if (-not $Synthetic -and $runtimeValidation.status -ne 'passed') {
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
        residualOwnedProcesses = 0
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

function Get-ProcessSnapshot {
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
        return @()
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
    if ($snapshot.Count -eq 0) { return }
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
    if ($snapshot.Count -eq 0) { return @() }
    $live = @()
    foreach ($ownedId in @($ownedPids)) {
        $expected = $ownedRecords[[int]$ownedId]
        $matches = @($snapshot | Where-Object {
            [int]$_.Id -eq [int]$ownedId -and
            ($null -eq $expected -or [string]::IsNullOrEmpty([string]$expected.CreationDate) -or [string]$_.CreationDate -eq [string]$expected.CreationDate)
        })
        if ($matches.Count -gt 0) { $live += $matches[0] }
    }
    return @($live)
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
    if ($includeRoot -and $null -ne $rootPid) { Stop-ExactProcessTree -targetPid ([int]$rootPid) }
    for ($attempt = 0; $attempt -lt 8; $attempt++) {
        $live = @(Get-LiveOwnedRecords | Where-Object { $includeRoot -or $null -eq $rootPid -or [int]$_.Id -ne [int]$rootPid })
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
    Write-Utf8Text (Join-Path $output 'stdout.txt') $stdout
    Write-Utf8Text (Join-Path $output 'stderr.txt') $stderr

    $liveFinal = @(Get-LiveOwnedRecords)
    $residualPids = @($liveFinal | ForEach-Object { [int]$_.Id })
    $acceptancePresent = Test-Path -LiteralPath $acceptancePath -PathType Leaf
    $elapsedMs = [int]([DateTimeOffset]::UtcNow - $runnerStarted).TotalMilliseconds
    $runnerResult = if ($startError) { 'start-failed' } elseif ($timedOut) { 'timeout' } elseif ($residualPids.Count -gt 0) { 'residual-owned-processes' } elseif ($terminalObserved) { 'completed' } else { 'missing-terminal-result' }
    $runnerExitCode = if ($runnerResult -eq 'completed' -and $terminalClassification -eq 'success') { 0 } elseif ($runnerResult -eq 'timeout') { 124 } else { 1 }
    $result = [ordered]@{
        schemaVersion = 1
        runnerResult = $runnerResult
        runtimeName = $RuntimeName
        sourceCommit = $sourceCommit
        runtimeValidation = $runtimeValidation
        terminalResult = [ordered]@{ observed = $terminalObserved; source = if ($terminalObserved) { 'acceptance.json completed + classification' } else { 'not-observed' }; classification = $terminalClassification; observedElapsedMs = $terminalObservedElapsedMs }
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
        residualOwnedProcesses = $residualPids.Count
        residualOwnedPids = $residualPids
        cleanup = 'exact-root-process-tree'
        output = $output
        error = $startError
    }
    $json = $result | ConvertTo-Json -Depth 8
    Write-Utf8Text (Join-Path $output 'runner-result.json') $json
    Write-Output $json
    $script:finalExitCode = $runnerExitCode
}

exit $finalExitCode
