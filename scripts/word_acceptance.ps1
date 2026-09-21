param(
    [string]$RequestJson,
    [string]$HashOnlyPath,
    [switch]$ForceHashFallback
)

$ErrorActionPreference = "Stop"

$WdStatisticPages = 2
$WdFormatXmlDocument = 16
$WdExportFormatPdf = 17
$WdDoNotSaveChanges = 0

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
    [System.IO.File]::WriteAllText(
        $Path,
        (($Value | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
        $utf8NoBom
    )
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

function Test-FontInstalled($Word, $FontName) {
    for ($index = 1; $index -le $Word.FontNames.Count; $index++) {
        if ($Word.FontNames.Item($index) -eq $FontName) {
            return $true
        }
    }
    return $false
}

function Update-DocumentForAcceptance($Document) {
    foreach ($field in @($Document.Fields)) {
        $field.Update() | Out-Null
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
    foreach ($style in @($Document.Styles)) {
        if ($style.NameLocal -eq $DisplayName -or $style.Name -eq $DisplayName) {
            return $true
        }
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
if (Test-Path -LiteralPath $request.pdf) {
    Remove-Item -LiteralPath $request.pdf -Force
}

$word = $null
$document = $null
$reopened = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0

    if (-not (Test-FontInstalled $word $request.requiredFont)) {
        throw "Required font is not installed: $($request.requiredFont)"
    }

    $document = $word.Documents.Open($request.inputDocx, $false, $false)
    Update-DocumentForAcceptance $document
    $pageCountBeforeReopen = [int]$document.ComputeStatistics($WdStatisticPages)
    $styleChecks = Get-StyleChecks $document $request.expectedStyles
    $missingStyles = @($styleChecks | Where-Object { -not $_.exists })
    if ($missingStyles.Count -gt 0) {
        $missingNames = ($missingStyles | ForEach-Object { $_.displayName }) -join ", "
        throw "Required Word styles are missing: $missingNames"
    }

    $document.SaveAs2($request.acceptedDocx, $WdFormatXmlDocument)
    $document.ExportAsFixedFormat($request.pdf, $WdExportFormatPdf)
    $document.Close($WdDoNotSaveChanges)
    $document = $null

    $reopened = $word.Documents.Open($request.acceptedDocx, $false, $true)
    Update-DocumentForAcceptance $reopened
    $pageCountAfterReopen = [int]$reopened.ComputeStatistics($WdStatisticPages)
    $reopened.Close($WdDoNotSaveChanges)
    $reopened = $null

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
    Write-Utf8Json $request.manifest $manifest

    if (-not $stable) {
        throw "Word page count changed after reopening accepted DOCX."
    }

    Write-Output "Word acceptance complete: $($request.manifest)"
} finally {
    if ($reopened -ne $null) {
        try {
            $reopened.Close($WdDoNotSaveChanges)
        } catch {}
    }
    if ($document -ne $null) {
        try {
            $document.Close($WdDoNotSaveChanges)
        } catch {}
    }
    if ($word -ne $null) {
        try {
            $word.Quit()
        } catch {}
    }
}
