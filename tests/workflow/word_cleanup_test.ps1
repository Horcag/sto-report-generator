$ErrorActionPreference = "Stop"

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("sto-word-cleanup-test-" + [System.Guid]::NewGuid().ToString("N"))
$requestDirectory = Join-Path $testRoot "request"
$stagingDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("sto-word-" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8))
$requestPath = Join-Path $requestDirectory "request.json"
$runnerPidPath = Join-Path $requestDirectory "runner.pid"
$wordPidPath = Join-Path $requestDirectory "word.pid"
$stagingPathFile = Join-Path $requestDirectory "staging.path"

try {
    New-Item -ItemType Directory -Force -Path $requestDirectory, $stagingDirectory | Out-Null
    [System.IO.File]::WriteAllText($runnerPidPath, "999999", [System.Text.Encoding]::UTF8)
    [System.IO.File]::WriteAllText($wordPidPath, "999998", [System.Text.Encoding]::UTF8)
    [System.IO.File]::WriteAllText($stagingPathFile, $stagingDirectory, [System.Text.Encoding]::UTF8)
    $request = [ordered]@{
        runnerPidPath = $runnerPidPath
        wordPidPath = $wordPidPath
        printerStatePath = (Join-Path $requestDirectory "missing-printer-state.json")
    }
    [System.IO.File]::WriteAllText(
        $requestPath,
        (($request | ConvertTo-Json) + [Environment]::NewLine),
        [System.Text.Encoding]::UTF8
    )

    & (Join-Path $PSScriptRoot "../../scripts/stop_word_acceptance.ps1") -RequestJson $requestPath

    if (Test-Path -LiteralPath $stagingDirectory) {
        throw "Cleanup did not remove the verified staging directory."
    }
    if ((Test-Path -LiteralPath $runnerPidPath) -or (Test-Path -LiteralPath $wordPidPath)) {
        throw "Cleanup did not remove stale owned PID files."
    }
    if (Test-Path -LiteralPath $stagingPathFile) {
        throw "Cleanup did not remove the verified staging receipt."
    }
    Write-Output "Word cleanup test passed."
} finally {
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $stagingDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
