function Invoke-RendererPostBuild($Request, $InputDocx) {
    if (-not $Request.postBuildSourceDir) { return }
    $ownershipDirectory = Split-Path -Parent $Request.runnerPidPath
    $script = Join-Path $PSScriptRoot "word_renderer_post_build.py"
    $pdf = Join-Path (Split-Path -Parent $InputDocx) "post-build.pdf"
    $result = Join-Path $ownershipDirectory "post-build-result.json"
    $uv = (Get-Command uv.exe -ErrorAction Stop).Source
    $previousOwnership = $env:STO_WORD_OWNERSHIP_DIR
    $previousEnvironment = $env:UV_PROJECT_ENVIRONMENT
    $previousMode = $env:STO_WORD_INTERACTION_MODE
    $previousQuality = $env:STO_WORD_PDF_IMAGE_QUALITY
    try {
        Remove-Item -LiteralPath $result -Force -ErrorAction SilentlyContinue
        $env:STO_WORD_OWNERSHIP_DIR = $ownershipDirectory
        $env:STO_WORD_INTERACTION_MODE = $Request.interactionMode
        $env:STO_WORD_PDF_IMAGE_QUALITY = $Request.pdfImageQuality
        # Nested PDF helpers must never try to reuse a Linux checkout's .venv.
        $env:UV_PROJECT_ENVIRONMENT = Join-Path (Split-Path -Parent $InputDocx) 'python-env'
        $arguments = @('run', '--no-project', '--with', 'pywin32>=311', '--with', 'lxml>=6.0.2', '--with', 'defusedxml>=0.7.1', '--with', 'pymupdf==2.0', 'python', $script, $InputDocx, $Request.postBuildSourceDir, $pdf, $result)
        # Quote each path; never interpolate document text or run a shell command.
        $quoted = @($arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' })
        $process = Start-Process -FilePath $uv -ArgumentList $quoted -PassThru -NoNewWindow
        $nativeHandle = $process.Handle
        Write-Utf8Json (Join-Path $ownershipDirectory 'post-build-uv.json') ([ordered]@{
            pid = $process.Id
            startTimeUtcTicks = $process.StartTime.ToUniversalTime().Ticks.ToString()
            executablePath = $process.Path
        })
        [System.IO.File]::WriteAllText((Join-Path $ownershipDirectory 'post-build-uv.pid'), [string]$process.Id)
        $process.WaitForExit()
        Ensure-NativeMethods
        $exitCode = [uint32]0
        if (-not [WordAcceptance.NativeMethods]::GetExitCodeProcess($nativeHandle, [ref]$exitCode)) {
            throw 'Cannot verify native post-build process exit code.'
        }
        if ($exitCode -ne 0) {
            if (Test-Path -LiteralPath $result) {
                $failure = Read-Utf8Json $result
                if ($failure.failureKind -in @('pdf-image-quality', 'preparation')) {
                    throw "Word renderer deterministic failure [$($failure.failureKind)]: $($failure.message)"
                }
            }
            throw "Native Word post-build failed (exit $exitCode)."
        }
        if (-not (Test-Path -LiteralPath $result)) { throw 'Native Word post-build produced no result.' }
        Write-Output 'Word renderer: full source-driven native post-build completed.'
    } finally {
        $env:STO_WORD_OWNERSHIP_DIR = $previousOwnership
        $env:UV_PROJECT_ENVIRONMENT = $previousEnvironment
        $env:STO_WORD_INTERACTION_MODE = $previousMode
        $env:STO_WORD_PDF_IMAGE_QUALITY = $previousQuality
    }
}
