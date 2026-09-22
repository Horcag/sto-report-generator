param(
    [Parameter(Mandatory = $true)][string]$RequestJson
)

$ErrorActionPreference = "Stop"

function Read-OptionalPid([string]$Path) {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) {
        return $null
    }
    $value = [System.IO.File]::ReadAllText($Path).Trim()
    if ($value -notmatch '^\d+$') {
        throw "Invalid PID file: $Path"
    }
    return [int]$value
}

function Get-ProcessRecord([int]$ProcessId) {
    return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
}

function Stop-VerifiedProcess([int]$ProcessId, [string]$ExpectedName, [string[]]$CommandFragments) {
    $process = Get-ProcessRecord $ProcessId
    if ($null -eq $process) {
        return
    }
    if ($process.Name -ne $ExpectedName) {
        throw "Refusing to stop PID ${ProcessId}: expected $ExpectedName, found $($process.Name)."
    }
    foreach ($fragment in @($CommandFragments)) {
        if ($fragment -and $process.CommandLine -notlike "*$fragment*") {
            throw "Refusing to stop PID ${ProcessId}: command line does not belong to this Word acceptance request."
        }
    }
    Stop-Process -Id $ProcessId -Force -ErrorAction Stop
    Write-Output "Stopped owned $ExpectedName PID $ProcessId."
}

function Find-UnrecordedOwnedWordPid($Request) {
    if (-not (Test-Path -LiteralPath $Request.wordPidsBeforePath)) {
        return $null
    }
    $before = @(
        [System.IO.File]::ReadAllText($Request.wordPidsBeforePath, [System.Text.Encoding]::UTF8) |
            ConvertFrom-Json
    )
    $candidates = @(
        Get-CimInstance Win32_Process -Filter "Name = 'WINWORD.EXE'" -ErrorAction SilentlyContinue |
            Where-Object {
                $_.ProcessId -notin $before -and
                $_.CommandLine -like '*/Automation*' -and
                $_.CommandLine -like '*Embedding*'
            }
    )
    if ($candidates.Count -eq 1) {
        return [int]$candidates[0].ProcessId
    }
    if ($candidates.Count -gt 1) {
        throw "Refusing fallback cleanup: found $($candidates.Count) new Word automation processes."
    }
    return $null
}

$request = [System.IO.File]::ReadAllText($RequestJson, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$runnerPid = Read-OptionalPid $request.runnerPidPath
$wordPid = Read-OptionalPid $request.wordPidPath
if ($null -eq $wordPid) {
    $wordPid = Find-UnrecordedOwnedWordPid $request
}

# Releasing Word first lets a blocked COM call return naturally. The runner is
# still stopped below if it does not terminate after that release.
if ($null -ne $wordPid) {
    Stop-VerifiedProcess $wordPid "WINWORD.EXE" @('/Automation', 'Embedding')
}
if ($null -ne $runnerPid) {
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        if ($null -eq (Get-ProcessRecord $runnerPid)) {
            break
        }
        Start-Sleep -Milliseconds 200
    }
    Stop-VerifiedProcess $runnerPid "powershell.exe" @('word_acceptance.ps1', $RequestJson)
}
