$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$prefix = 'pid-reuse-descendant-selftest'
$audit = $null
try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'tests/readiness-acceptance.ps1') -Synthetic -SyntheticResult pid-reuse-descendant -TimeoutMs 60000 -RunPrefix $prefix | Out-Null
    $runnerExit = $LASTEXITCODE
    $run = Get-ChildItem -LiteralPath (Join-Path $root '.work/readiness-runs') -Directory |
        Where-Object { $_.Name -like ($prefix + '-*') } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($null -eq $run) { throw 'PID reuse descendant run output is missing.' }
    $result = Get-Content -LiteralPath (Join-Path $run.FullName 'runner-result.json') -Raw | ConvertFrom-Json
    $audit = $result.syntheticOwnershipAudit
    if ($runnerExit -ne 1) { throw "Expected runner exit 1, got $runnerExit." }
    if ($result.runnerResult -ne 'cleanup-unverified') { throw 'PID reuse must fail closed as cleanup-unverified.' }
    if ($result.cleanupStatus -ne 'unverified' -or $result.ownershipVerified -ne $false) { throw 'PID reuse cleanup verification state is unsafe.' }
    if ($null -ne $result.residualOwnedProcesses) { throw 'PID reuse must not report residual=0 or another numeric residual.' }
    if ($result.terminalResult.classification -ne 'success') { throw 'Synthetic acceptance should reach terminal success before cleanup.' }
    if ($null -eq $audit -or $audit.rootAliveAfterCleanup -ne $true -or $audit.registeredOwned -ne $false -or $audit.aliveAfterCleanup -ne $true) {
        throw 'Reused root descendant was registered or killed unexpectedly.'
    }
    if (@($result.ownershipIssues) -notcontains 'pid-reused') { throw 'PID reuse issue was not recorded.' }
    Write-Output 'pid-reuse descendant self-test: PASS'
}
finally {
    if ($null -ne $audit -and $audit.descendantPid -gt 0) {
        $descendant = Get-Process -Id ([int]$audit.descendantPid) -ErrorAction SilentlyContinue
        if ($null -ne $descendant) {
            try { $descendant.Kill() } catch { }
            try { $descendant.WaitForExit(2000) } catch { }
        }
    }
}
