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

function Read-Utf8Json($Path) {
    $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    return $text | ConvertFrom-Json
}

function Write-Utf8Json($Path, $Value) {
    $directory = Split-Path -Parent $Path
    if ($directory) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $temporaryPath = "$Path.tmp-$([System.Guid]::NewGuid().ToString('N'))"
    try {
        [System.IO.File]::WriteAllText(
            $temporaryPath,
            (($Value | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
            $utf8NoBom
        )
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    } finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Get-Sha256($Path, [bool]$ForceFallback = $false) {
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

function Ensure-ParentDirectory($Path) {
    $directory = Split-Path -Parent $Path
    if ($directory) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
}

function Test-FontInstalled($FontName) {
    Add-Type -AssemblyName System.Drawing
    $installedFonts = New-Object System.Drawing.Text.InstalledFontCollection
    return @(
        $installedFonts.Families | Where-Object { $_.Name -eq $FontName }
    ).Count -gt 0
}

function Update-DocumentForAcceptance($Document) {
    foreach ($field in @($Document.Fields)) {
        # A table of contents is also present in Document.Fields. Updating it
        # here and again through TablesOfContents can leave Word's fixed-format
        # exporter spinning indefinitely, so update every TOC exactly once.
        if ([int]$field.Type -ne $WdFieldTOC) {
            $field.Update() | Out-Null
        }
    }
    foreach ($section in @($Document.Sections)) {
        foreach ($header in @($section.Headers)) {
            foreach ($field in @($header.Range.Fields)) {
                $field.Update() | Out-Null
            }
        }
        foreach ($footer in @($section.Footers)) {
            foreach ($field in @($footer.Range.Fields)) {
                $field.Update() | Out-Null
            }
        }
    }
    foreach ($toc in @($Document.TablesOfContents)) {
        $toc.Update() | Out-Null
    }
    $Document.Repaginate()
}

function Test-StyleExists($Document, $DisplayName) {
    try {
        $style = $Document.Styles.Item([string]$DisplayName)
        if ($style -ne $null) {
            return $true
        }
    } catch {
        # Fall through to the built-in heading lookup below.
    }

    # Word localizes built-in heading names in the COM model even when OOXML
    # stores the canonical DOTM name (for example, "heading 5"). Resolve that
    # case through WdBuiltinStyle: Heading 1 is -2, Heading 9 is -10.
    if ($DisplayName -match '^heading ([1-9])$') {
        $headingLevel = [int]$Matches[1]
        $builtInStyleId = -($headingLevel + 1)
        try {
            $builtInStyle = $Document.Styles.Item($builtInStyleId)
            return $builtInStyle -ne $null -and [bool]$builtInStyle.BuiltIn
        } catch {
            return $false
        }
    }

    return $false
}

function Get-StyleChecks($Document, $ExpectedStyles) {
    $checks = @()
    foreach ($expected in @($ExpectedStyles)) {
        $exists = Test-StyleExists $Document $expected.displayName
        $checks += [ordered]@{
            styleId = $expected.styleId
            displayName = $expected.displayName
            exists = $exists
        }
    }
    return $checks
}

$request = Read-Utf8Json $RequestJson
if ($request.schemaVersion -ne 1) {
    throw "Unsupported request schemaVersion."
}
if (-not (Test-Path -LiteralPath $request.inputDocx)) {
    throw "Input DOCX not found: $($request.inputDocx)"
}
if ([System.IO.Path]::GetFullPath($request.inputDocx) -eq [System.IO.Path]::GetFullPath($request.acceptedDocx)) {
    throw "Accepted DOCX path must be different from input DOCX."
}

Ensure-ParentDirectory $request.acceptedDocx
Ensure-ParentDirectory $request.pdf
Ensure-ParentDirectory $request.manifest
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
$document = $null
$reopened = $null
$operationError = $null
$shutdownErrors = @()
$cleanupErrorMessage = $null
try {
    $stagingDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("sto-word-" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8))
    $stagedInputDocx = Join-Path $stagingDirectory "input.docx"
    $stagedAcceptedDocx = Join-Path $stagingDirectory "accepted.docx"
    $stagedPdf = Join-Path $stagingDirectory "accepted.pdf"
    New-Item -ItemType Directory -Force -Path $stagingDirectory | Out-Null
    Copy-Item -LiteralPath $request.inputDocx -Destination $stagedInputDocx
    Write-Output "Word acceptance: staged input in a short local path."

    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    Write-Output "Word acceptance: Microsoft Word COM started."

    if (-not (Test-FontInstalled $request.requiredFont)) {
        throw "Required font is not installed: $($request.requiredFont)"
    }
    Write-Output "Word acceptance: required font is installed."

    # Word retains legacy path-length constraints even when the host and Git
    # support long paths. Work from a short local staging directory, then copy
    # the accepted artifacts to the caller's requested destinations.
    $document = $word.Documents.Open($stagedInputDocx, $false, $false)
    Write-Output "Word acceptance: staged DOCX opened."
    Update-DocumentForAcceptance $document
    Write-Output "Word acceptance: fields, TOC, and pagination updated."
    $pageCountBeforeReopen = [int]$document.ComputeStatistics($WdStatisticPages)

    $document.Save()
    $document.ExportAsFixedFormat($stagedPdf, $WdExportFormatPdf)
    Write-Output "Word acceptance: DOCX and PDF exported."

    # Querying Word styles creates additional COM proxies. Keep those lookups
    # after fixed-format export so they cannot interfere with Word's PDF path.
    $styleChecks = Get-StyleChecks $document $request.expectedStyles
    $missingStyles = @($styleChecks | Where-Object { -not $_.exists })
    if ($missingStyles.Count -gt 0) {
        $missingNames = ($missingStyles | ForEach-Object { $_.displayName }) -join ", "
        throw "Required Word styles are missing: $missingNames"
    }
    Write-Output "Word acceptance: required styles verified."

    $document.Close($WdDoNotSaveChanges)
    $document = $null
    Copy-Item -LiteralPath $stagedInputDocx -Destination $stagedAcceptedDocx

    $reopened = $word.Documents.Open($stagedAcceptedDocx, $false, $true)
    Update-DocumentForAcceptance $reopened
    $pageCountAfterReopen = [int]$reopened.ComputeStatistics($WdStatisticPages)
    $reopened.Close($WdDoNotSaveChanges)
    $reopened = $null

    Copy-Item -LiteralPath $stagedAcceptedDocx -Destination $request.acceptedDocx
    Copy-Item -LiteralPath $stagedPdf -Destination $request.pdf
    Write-Output "Word acceptance: accepted artifacts copied to requested paths."

    $stable = $pageCountBeforeReopen -eq $pageCountAfterReopen
    $wordBuild = $null
    try {
        $wordBuild = [string]$word.Build
    } catch {
        $wordBuild = $null
    }

    $manifest = [ordered]@{
        schemaVersion = 1
        word = [ordered]@{
            version = [string]$word.Version
            build = $wordBuild
        }
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
    }
    if (-not $stable) {
        throw "Word page count changed after reopening accepted DOCX."
    }
    Write-Utf8Json $request.manifest $manifest

} catch {
    $operationError = $_
} finally {
    if ($reopened -ne $null) {
        try {
            $reopened.Close($WdDoNotSaveChanges)
        } catch {
            $shutdownErrors += "Failed to close the reopened Word document: $($_.Exception.Message)"
        }
    }
    if ($document -ne $null) {
        try {
            $document.Close($WdDoNotSaveChanges)
        } catch {
            $shutdownErrors += "Failed to close the primary Word document: $($_.Exception.Message)"
        }
    }
    if ($word -ne $null) {
        try {
            $word.Quit()
        } catch {
            $shutdownErrors += "Failed to quit Microsoft Word: $($_.Exception.Message)"
        }
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
    throw $message
}
if ($secondaryErrors.Count -gt 0) {
    throw ($secondaryErrors -join [Environment]::NewLine)
}

Write-Output "Word acceptance complete: $($request.manifest)"
