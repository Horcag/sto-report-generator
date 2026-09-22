param(
    [string]$RequestJson,
    [string]$HashOnlyPath,
    [switch]$ForceHashFallback
)

$ErrorActionPreference = "Stop"

$WdStatisticPages = 2
$WdExportFormatPdf = 17
$WdDoNotSaveChanges = 0
$WdFieldTOC = 13

function Read-Utf8Json([string]$Path) {
    $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    return $text | ConvertFrom-Json
}

function Write-Utf8Json([string]$Path, $Value) {
    $directory = Split-Path -Parent $Path
    if ($directory) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $temporaryPath = "$Path.tmp-$([System.Guid]::NewGuid().ToString('N'))"
    try {
        [System.IO.File]::WriteAllText(
            $temporaryPath,
            (($Value | ConvertTo-Json -Depth 10) + [Environment]::NewLine),
            $utf8NoBom
        )
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    } finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Get-Sha256([string]$Path, [bool]$ForceFallback = $false) {
    if (-not $ForceFallback -and (Get-Command Get-FileHash -ErrorAction SilentlyContinue)) {
        return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
    }
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        $hashBytes = $sha.ComputeHash($stream)
        return (-join ($hashBytes | ForEach-Object { $_.ToString("x2") }))
    } finally {
        $stream.Close()
    }
}

if ($HashOnlyPath) {
    Write-Output (Get-Sha256 $HashOnlyPath $ForceHashFallback)
    exit 0
}
if (-not $RequestJson) {
    throw "RequestJson is required unless HashOnlyPath is used."
}

function Ensure-ParentDirectory([string]$Path) {
    $directory = Split-Path -Parent $Path
    if ($directory) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
}

function Test-FontInstalled([string]$FontName) {
    Add-Type -AssemblyName System.Drawing
    $installedFonts = New-Object System.Drawing.Text.InstalledFontCollection
    return @(
        $installedFonts.Families | Where-Object { $_.Name -eq $FontName }
    ).Count -gt 0
}

function Test-StyleExists($Document, [string]$DisplayName) {
    try {
        $style = $Document.Styles.Item([string]$DisplayName)
        if ($style -ne $null) {
            [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($style) | Out-Null
            return $true
        }
    } catch {
        # Fall through to the built-in heading lookup below.
    }

    if ($DisplayName -match '^heading ([1-9])$') {
        $headingLevel = [int]$Matches[1]
        $builtInStyleId = -($headingLevel + 1)
        try {
            $builtInStyle = $Document.Styles.Item($builtInStyleId)
            $exists = $builtInStyle -ne $null -and [bool]$builtInStyle.BuiltIn
            if ($builtInStyle -ne $null) {
                [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($builtInStyle) | Out-Null
            }
            return $exists
        } catch {
            return $false
        }
    }

    return $false
}

function Get-StyleChecks($Document, $ExpectedStyles) {
    $checks = @()
    foreach ($expected in @($ExpectedStyles)) {
        $checks += [ordered]@{
            styleId = $expected.styleId
            displayName = $expected.displayName
            exists = Test-StyleExists $Document $expected.displayName
        }
    }
    return $checks
}

function Get-DefaultPrinterEvidence {
    $printer = Get-CimInstance Win32_Printer -Filter "Default = TRUE" -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -eq $printer) {
        return $null
    }
    return [ordered]@{
        name = [string]$printer.Name
        driverName = [string]$printer.DriverName
        portName = [string]$printer.PortName
        workOffline = [bool]$printer.WorkOffline
    }
}

function Release-ComObject($Value) {
    if ($null -ne $Value -and [System.Runtime.InteropServices.Marshal]::IsComObject($Value)) {
        [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($Value) | Out-Null
    }
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class StoWordNativeMethods {
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

$request = Read-Utf8Json $RequestJson
if ($request.schemaVersion -ne 2) {
    throw "Unsupported request schemaVersion."
}

$script:diagnostics = [ordered]@{
    schemaVersion = 1
    runId = [string]$request.runId
    status = "running"
    stage = "initializing"
    startedAt = [string]$request.startedAt
    updatedAt = [DateTimeOffset]::Now.ToString("o")
    completedAt = $null
    message = $null
    runnerPid = $PID
    wordPid = $null
    defaultPrinter = $null
    events = @()
}

function Set-DiagnosticStage([string]$Stage, [string]$Message = $null) {
    $now = [DateTimeOffset]::Now.ToString("o")
    $script:diagnostics.status = "running"
    $script:diagnostics.stage = $Stage
    $script:diagnostics.updatedAt = $now
    $script:diagnostics.message = $Message
    $script:diagnostics.events += [ordered]@{
        at = $now
        stage = $Stage
        message = $Message
    }
    Write-Utf8Json $request.diagnostics $script:diagnostics
}

function Set-DiagnosticFinal([string]$Status, [string]$Stage, [string]$Message = $null) {
    $now = [DateTimeOffset]::Now.ToString("o")
    $script:diagnostics.status = $Status
    $script:diagnostics.stage = $Stage
    $script:diagnostics.updatedAt = $now
    $script:diagnostics.completedAt = $now
    $script:diagnostics.message = $Message
    $script:diagnostics.events += [ordered]@{
        at = $now
        stage = $Stage
        message = $Message
    }
    Write-Utf8Json $request.diagnostics $script:diagnostics
}

Ensure-ParentDirectory $request.acceptedDocx
Ensure-ParentDirectory $request.pdf
Ensure-ParentDirectory $request.manifest
Ensure-ParentDirectory $request.diagnostics
[System.IO.File]::WriteAllText($request.runnerPidPath, [string]$PID)
Set-DiagnosticStage "preflight.request"

if (-not (Test-Path -LiteralPath $request.inputDocx)) {
    Set-DiagnosticFinal "failed" "preflight.request" "Input DOCX not found."
    throw "Input DOCX not found: $($request.inputDocx)"
}
if ([System.IO.Path]::GetFullPath($request.inputDocx) -eq [System.IO.Path]::GetFullPath($request.acceptedDocx)) {
    Set-DiagnosticFinal "failed" "preflight.request" "Accepted DOCX path equals input DOCX."
    throw "Accepted DOCX path must be different from input DOCX."
}
foreach ($previousOutput in @($request.acceptedDocx, $request.pdf, $request.manifest)) {
    if (Test-Path -LiteralPath $previousOutput) {
        Remove-Item -LiteralPath $previousOutput -Force
    }
}

$stagingDirectory = $null
$stagedInputDocx = $null
$stagedAcceptedDocx = $null
$stagedPdf = $null
$word = $null
$wordOwned = $false
$document = $null
$reopened = $null
$operationError = $null
$failedStage = $null
$shutdownErrors = @()
$cleanupErrorMessage = $null
$completed = $false

try {
    Set-DiagnosticStage "preflight.staging"
    $stagingDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("sto-word-" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8))
    $stagedInputDocx = Join-Path $stagingDirectory "input.docx"
    $stagedAcceptedDocx = Join-Path $stagingDirectory "accepted.docx"
    $stagedPdf = Join-Path $stagingDirectory "accepted.pdf"
    New-Item -ItemType Directory -Force -Path $stagingDirectory | Out-Null
    Copy-Item -LiteralPath $request.inputDocx -Destination $stagedInputDocx

    Set-DiagnosticStage "preflight.license"
    & (Join-Path $PSScriptRoot "check_word_license.ps1")

    $wordProcessesBefore = @(
        Get-Process WINWORD -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id
    )
    Write-Utf8Json $request.wordPidsBeforePath $wordProcessesBefore
    $script:diagnostics.defaultPrinter = Get-DefaultPrinterEvidence
    Set-DiagnosticStage "word.create"
    $word = New-Object -ComObject Word.Application
    $wordProcessId = [uint32]0
    [StoWordNativeMethods]::GetWindowThreadProcessId([IntPtr]$word.Hwnd, [ref]$wordProcessId) | Out-Null
    if ($wordProcessId -eq 0) {
        throw "Microsoft Word did not expose an automation process ID."
    }
    $wordProcess = Get-Process -Id $wordProcessId -ErrorAction Stop
    if ($wordProcess.ProcessName -ne "WINWORD") {
        throw "Word automation HWND resolved to unexpected process: $($wordProcess.ProcessName)."
    }
    if ($wordProcessId -in $wordProcessesBefore) {
        throw "Microsoft Word reused a pre-existing automation process. Close stale background Word automation before acceptance."
    }
    $wordOwned = $true
    [System.IO.File]::WriteAllText($request.wordPidPath, [string]$wordProcessId)
    $script:diagnostics.wordPid = $wordProcessId
    Set-DiagnosticStage "word.configure"
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $word.AutomationSecurity = 3
    $word.Options.UpdateLinksAtOpen = $false
    $word.Options.SaveNormalPrompt = $false
    $word.Options.BackgroundSave = $false
    $word.Options.PrintBackground = $false

    Set-DiagnosticStage "preflight.font"
    if (-not (Test-FontInstalled $request.requiredFont)) {
        throw "Required font is not installed: $($request.requiredFont)"
    }

    Set-DiagnosticStage "document.open"
    $document = $word.Documents.Open($stagedInputDocx, $false, $false)
    Set-DiagnosticStage "document.fields"
    foreach ($field in @($document.Fields)) {
        if ([int]$field.Type -ne $WdFieldTOC) {
            $field.Update() | Out-Null
        }
        Release-ComObject $field
    }
    Set-DiagnosticStage "document.headers-footers"
    foreach ($section in @($document.Sections)) {
        foreach ($header in @($section.Headers)) {
            foreach ($field in @($header.Range.Fields)) {
                $field.Update() | Out-Null
                Release-ComObject $field
            }
            Release-ComObject $header
        }
        foreach ($footer in @($section.Footers)) {
            foreach ($field in @($footer.Range.Fields)) {
                $field.Update() | Out-Null
                Release-ComObject $field
            }
            Release-ComObject $footer
        }
        Release-ComObject $section
    }
    Set-DiagnosticStage "document.toc"
    foreach ($toc in @($document.TablesOfContents)) {
        $toc.Update() | Out-Null
        Release-ComObject $toc
    }
    Set-DiagnosticStage "document.repaginate"
    $document.Repaginate()
    $pageCountBeforeReopen = [int]$document.ComputeStatistics($WdStatisticPages)

    Set-DiagnosticStage "document.save"
    $document.Save()
    Set-DiagnosticStage "document.pdf-export"
    $document.ExportAsFixedFormat($stagedPdf, $WdExportFormatPdf)

    Set-DiagnosticStage "document.styles"
    $styleChecks = Get-StyleChecks $document $request.expectedStyles
    $missingStyles = @($styleChecks | Where-Object { -not $_.exists })
    if ($missingStyles.Count -gt 0) {
        $missingNames = ($missingStyles | ForEach-Object { $_.displayName }) -join ", "
        throw "Required Word styles are missing: $missingNames"
    }

    Set-DiagnosticStage "document.close"
    $document.Saved = $true
    $document.Close($WdDoNotSaveChanges)
    Release-ComObject $document
    $document = $null
    Copy-Item -LiteralPath $stagedInputDocx -Destination $stagedAcceptedDocx

    Set-DiagnosticStage "reopen.open"
    $reopened = $word.Documents.Open($stagedAcceptedDocx, $false, $true)
    Set-DiagnosticStage "reopen.repaginate"
    $reopened.Repaginate()
    $pageCountAfterReopen = [int]$reopened.ComputeStatistics($WdStatisticPages)
    Set-DiagnosticStage "reopen.close"
    $reopened.Close($WdDoNotSaveChanges)
    Release-ComObject $reopened
    $reopened = $null

    $stable = $pageCountBeforeReopen -eq $pageCountAfterReopen
    if (-not $stable) {
        throw "Word page count changed after reopening accepted DOCX."
    }
    $wordVersion = [string]$word.Version
    $wordBuild = $null
    try {
        $wordBuild = [string]$word.Build
    } catch {
        $wordBuild = $null
    }

    Set-DiagnosticStage "word.quit"
    $word.Quit()
    Release-ComObject $word
    $word = $null
    $wordOwned = $false

    Set-DiagnosticStage "artifacts.copy"
    Copy-Item -LiteralPath $stagedAcceptedDocx -Destination $request.acceptedDocx
    Copy-Item -LiteralPath $stagedPdf -Destination $request.pdf

    $manifest = [ordered]@{
        schemaVersion = 1
        runId = [string]$request.runId
        word = [ordered]@{
            version = $wordVersion
            build = $wordBuild
        }
        defaultPrinter = $script:diagnostics.defaultPrinter
        inputDocx = [ordered]@{
            path = $request.inputDocx
            sha256 = Get-Sha256 $request.inputDocx
        }
        acceptedDocx = [ordered]@{
            path = $request.acceptedDocx
            sha256 = Get-Sha256 $request.acceptedDocx
        }
        pdf = [ordered]@{
            path = $request.pdf
            sha256 = Get-Sha256 $request.pdf
        }
        pageCountBeforeReopen = $pageCountBeforeReopen
        pageCountAfterReopen = $pageCountAfterReopen
        stablePageCount = $stable
        requiredFont = [ordered]@{
            name = $request.requiredFont
            installed = $true
        }
        stylePreset = $request.stylePreset
        styleChecks = $styleChecks
        diagnostics = $request.diagnostics
    }
    Set-DiagnosticStage "manifest.write"
    Write-Utf8Json $request.manifest $manifest
    $completed = $true
} catch {
    $operationError = $_
    $failedStage = [string]$script:diagnostics.stage
} finally {
    if ($reopened -ne $null) {
        try {
            $reopened.Close($WdDoNotSaveChanges)
            Release-ComObject $reopened
        } catch {
            $shutdownErrors += "Failed to close the reopened Word document: $($_.Exception.Message)"
        }
    }
    if ($document -ne $null) {
        try {
            $document.Close($WdDoNotSaveChanges)
            Release-ComObject $document
        } catch {
            $shutdownErrors += "Failed to close the primary Word document: $($_.Exception.Message)"
        }
    }
    if ($word -ne $null -and $wordOwned) {
        try {
            $word.Quit()
            Release-ComObject $word
        } catch {
            $shutdownErrors += "Failed to quit Microsoft Word: $($_.Exception.Message)"
        }
    } elseif ($word -ne $null) {
        Release-ComObject $word
    }
    if ($stagingDirectory -and (Test-Path -LiteralPath $stagingDirectory)) {
        $cleanupError = $null
        for ($attempt = 1; $attempt -le 4; $attempt++) {
            try {
                Remove-Item -LiteralPath $stagingDirectory -Recurse -Force -ErrorAction Stop
                $cleanupError = $null
                break
            } catch {
                $cleanupError = $_
                Start-Sleep -Milliseconds 250
            }
        }
        if (Test-Path -LiteralPath $stagingDirectory) {
            $cleanupErrorMessage = "Failed to remove Word acceptance staging directory after four attempts: $stagingDirectory. $cleanupError"
        }
    }
    if (-not $completed -or $shutdownErrors.Count -gt 0 -or $cleanupErrorMessage) {
        foreach ($output in @($request.acceptedDocx, $request.pdf, $request.manifest)) {
            Remove-Item -LiteralPath $output -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item -LiteralPath $request.wordPidPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $request.runnerPidPath -Force -ErrorAction SilentlyContinue
}

$secondaryErrors = @($shutdownErrors)
if ($cleanupErrorMessage) {
    $secondaryErrors += $cleanupErrorMessage
}
if ($operationError) {
    $message = "Word acceptance failed: $($operationError.Exception.Message)"
    if ($secondaryErrors.Count -gt 0) {
        $message += [Environment]::NewLine + ($secondaryErrors -join [Environment]::NewLine)
    }
    Set-DiagnosticFinal "failed" $failedStage $message
    throw $message
}
if ($secondaryErrors.Count -gt 0) {
    $message = $secondaryErrors -join [Environment]::NewLine
    Set-DiagnosticFinal "failed" "cleanup" $message
    throw $message
}

Set-DiagnosticFinal "succeeded" "complete" "Word acceptance completed."
Write-Output "Word acceptance complete: $($request.manifest)"
Write-Output "Word acceptance diagnostics: $($request.diagnostics)"
